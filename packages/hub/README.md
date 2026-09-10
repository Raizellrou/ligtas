# @ligtas/hub

The verifying endpoint per PRD Section 5.4/5.5/9. Receives raw alert packet hex from `packages/mesh-sim`, verifies it with the same `@ligtas/core` logic the PWA and `verify-alert.ts` use, stores accepted alerts in SQLite, and serves them back as an `AlertBundle` (see `docs/alert-bundle.schema.json`).

## Setup

```bash
cd packages/hub
cp config/issuers.example.json config/issuers.json
# edit issuers.json with real issuer public keys, or generate a demo one:
#   node ../core/dist/scripts/emit-alert.js --sequence 1
# and put its expectedIssuerPublicKey (not the secret) in issuers.json
```

`config/issuers.json` holds only public keys — safe to commit, needed for a reproducible demo. Never put a secret key in it.

`config/households.json` is the same idea for the payout registry (PRD Section 4, layer L5): household ID, purok, and Stellar address — no secrets, since households only ever receive funds here, never sign anything.

## Running

```bash
pnpm --filter @ligtas/core build   # if not already built
pnpm --filter @ligtas/hub build    # tsc has no direct .ts execution path here -- see Known limitation below
PORT=3001 node packages/hub/dist/index.js
```

Env vars: `PORT` (default 3001), `LIGTAS_DB_PATH` (default `packages/hub/hub.sqlite`), `LIGTAS_ISSUERS_PATH` (default `packages/hub/config/issuers.json`), `LIGTAS_HOUSEHOLDS_PATH` (default `packages/hub/config/households.json`).

**Drain worker** (PRD Section 6.2, `@ligtas/stellar`) is optional and off unless configured:

- `LIGTAS_HUB_STELLAR_SECRET` — the hub's *own* Stellar Testnet account secret (distinct from the field issuer keys in `issuers.json`, which only ever verify signatures, never hold funds here). Without this set, the hub runs exactly as before; `POST /drain` returns 503.
- `LIGTAS_DRAIN_INTERVAL_MS` (default 60000) — how often the worker automatically drains the outbox when the secret is set.

## API

- `POST /alert` — body `{ "packetHex": "<168 hex chars>" }`. Returns `{ decision, alertHash? }`. `decision` is one of `accepted`, `rejected_signature`, `rejected_unknown_issuer`, `rejected_replay`, `duplicate`, `malformed`.
- `GET /alerts` — a live `AlertBundle` (`source: "live"`), same shape `apps/pwa` consumes from a captured file.
- `POST /drain` — manually triggers an outbox drain: anchors every `pending` alert to Stellar Testnet (reconciling anything stuck `submitted` from an interrupted run first), then, for each now-`confirmed` alert with `payout_status = 'none'`, creates one claimable balance per matched household (PRD Section 7) — flat by severity tier (`@ligtas/stellar`'s `PAYOUT_TIER_AMOUNT_XLM`), reconciling anything stuck `pending` from an interrupted run first, the same way anchoring does. Returns `{ anchors: [{ alertHash, outcome }], payouts: [{ alertHash, outcome, matchedHouseholds? }] }`. 503 if `LIGTAS_HUB_STELLAR_SECRET` isn't set.
- `GET /health` — liveness check.

## Verified live, not just unit tested

`packages/mesh-sim/bridge_to_hub.py` drives the full chain for real: Docker-simulated LoRa mesh → a packet arriving at the hub node's own client interface → HTTP POST to this server → real signature verification → SQLite → `GET /alerts`. Run it (with the hub already running) to see a genuine alert accepted and a forged one — which the mesh forwards exactly like a real packet, per PRD Section 5.5 — rejected here instead.

The drain worker was run for real against Stellar Testnet during development, not mocked: posted a genuine alert, confirmed it sat at `anchor_status = 'pending'`, called `POST /drain`, and:

1. It came back `confirmed`, with a real `anchor_tx` — fetched independently from Horizon and decoded the memo myself: matched the hub's own `alertHash` exactly.
2. Re-running `POST /drain` with nothing new pending returned `{ anchors: [], payouts: [] }` — no double-anchor.
3. Manually reset that same row back to `anchor_status = 'submitted'` (simulating a crash between recording the tx hash and confirming it) and ran `POST /drain` again — it reconciled against Horizon and marked it `confirmed` **without** creating a second transaction (`anchor_tx` unchanged).

Payout (PRD Section 7 / Stage 5 item 5.1) was verified the same way, in the same session — full loop, real Testnet:

1. Seeded `config/households.json`'s three demo households (real generated Testnet public keys, two in purok 3, one in purok 4 — none pre-funded).
2. Posted a genuine tier-2 alert targeting puroks 3 and 4. `POST /drain` anchored it, then in that **same** call created one `createClaimableBalance` per matched household (3 total, 25 XLM each — tier 2's amount) — none of the destination accounts needed to exist beforehand; only the hub's own paying account needs the reserve.
3. Fetched the operations back from Horizon directly and confirmed each claimant's predicate: unconditional for the household, `NOT(before 2,592,000s)` for the hub account — exactly 30 days (PRD open question #7, resolved), not asserted.
4. Re-running `POST /drain` with nothing new returned empty arrays again — no double-pay.
5. Manually reset that alert's `payout_status` back to `'pending'` (simulating a crash right after submission) and ran `POST /drain` again — reconciled to `'created'` against Horizon **without** creating a second transaction (`payout_tx` unchanged, `attempts` stayed `0`).

Not yet built (Stage 5 item 5.3): the extra defense-in-depth check PRD Section 7 describes for the *ambiguous* case — querying Horizon for existing claimable balances when `payout_status` itself can't be trusted — plus dedicated automated tests for all of this. What's here is idempotent by construction (steps 4-5 above prove it manually); 5.3 is about proving it automatically and covering the harder edge cases.

## Known limitation

Node's native TypeScript execution can't resolve this package's own `.ts` sources directly (its `@ligtas/core` import expects compiled `.js`), so `packages/hub` has to be compiled with `tsc` before running — there's no `tsx`-style direct-run path yet. `pnpm --filter @ligtas/hub build` followed by `node dist/index.js`, not `node src/index.ts`.
