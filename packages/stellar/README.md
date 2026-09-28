# @ligtas/stellar

Horizon Testnet client, Friendbot funding, and anchoring (PRD Section 7 / Stage 4).
This is the one package in the repo allowed to import Horizon — see CLAUDE.md's
"`packages/core` must never import Horizon or RPC" for why that boundary exists:
`packages/core` has to run correctly with zero connectivity, this package is the
opposite, the reconnection-layer code that only runs once connectivity is back.

Stellar Classic only. No Soroban, no Rust (CLAUDE.md hard constraint).

## API

- `horizonClient()` — a `Horizon.Server` pointed at Testnet.
- `fundTestnetAccount(publicKey)` — Friendbot funding for a fresh Testnet account.
- `anchorAlertHash(account, alertHash)` — a minimal payment (1 stroop) from
  `account` to itself, memo `MEMO_HASH = alertHash`. `alertHash` is meant to be
  `packages/core`'s own `alertHash()` output fed straight in, 32 bytes, no
  re-encoding — the memo field takes it exactly, no loss (PRD Section 7).
- `preparePayoutTransaction(account, severity, claims)` — one
  `createClaimableBalance` operation per claim, flat amount by severity tier
  (`PAYOUT_TIER_AMOUNT_XLM`: 10/25/50 XLM), unconditionally claimable by the
  household and reclaimable by `account` after `RECLAIM_WINDOW_SECONDS` (30
  days — PRD open question #7, resolved). Same two-phase
  prepare-then-`submit()` shape as `prepareAnchorTransaction`, for the same
  durability reason.

## Verified against real Testnet, not mocked

Ran for real during development, anchoring the actual hash of the genuine alert
captured in `apps/pwa/public/alert-bundle.json` (the same hash `packages/hub`
computed and returned as `alertHash` when that packet was accepted):

```
node packages/stellar/scripts/anchor-alert.js \
  --alert-hash fd36f3cf2486a9ca4fd090efa752429aea46caaa95d199e8901fafe1d479121b \
  --fund
```

Result — a real, confirmed Testnet transaction:

- Tx hash: `997c83743104357a17d27dbd2feb890a400e164ce39b2bf438b51767da2e78b1`
- https://stellar.expert/explorer/testnet/tx/997c83743104357a17d27dbd2feb890a400e164ce39b2bf438b51767da2e78b1
- Fetched independently from Horizon (`GET /transactions/{hash}`) and decoded the
  memo myself, rather than trusting the submit response: `memo_type: hash`,
  memo (base64 → hex) = `fd36f3cf2486a9ca4fd090efa752429aea46caaa95d199e8901fafe1d479121b`
  — **matches the locally recomputed hash exactly**. This is PRD Goal G5 ("alert
  hash visible on Stellar Expert, matches locally recomputed hash"), demonstrated
  end to end, not just asserted. Screenshot and a from-scratch re-verification of
  this same match: `docs/proof/`.

## Built since this README was first written

- **Hub drain worker** — `packages/hub/src/drain.ts` now calls `anchorAlertHash`
  automatically for `pending` outbox rows, following PRD Section 6.2's sequence
  (submit → record tx hash before awaiting confirmation → mark confirmed).
  Idempotent and re-entrant — verified live including a simulated mid-drain
  crash, which reconciled without double-anchoring.
- **Claimable balances / payout** — built (`payout.ts`) and verified live against
  real Testnet: three real claimable balances created for real (unfunded) demo
  household addresses, predicates fetched back from Horizon and checked, and an
  interrupted-run reconciliation proven the same way the anchor one was. Full
  writeup: `packages/hub/README.md`'s "Verified live, not just unit tested"
  section, since the proof runs through the hub's drain worker end to end.
