# LIGTAS — Build Plan

Companion to [LIGTAS-PRD.md](../LIGTAS-PRD.md). The PRD says *what* the system is; this says *what gets built when, by whom, and in what order*. Written 2 September 2026, at the start of Stage 3.

---

## 1. Status

**Built and proven:**

| Package | State |
|---|---|
| `packages/core` | Packet codec (`DataView`, big-endian), SEP-53 sign/verify, `ReplayGuard`, alert bundle types (`AlertBundle`), `emit-alert` / `verify-alert` CLI bridges. 29 Vitest tests, typecheck clean. |
| `packages/mesh-sim` | Track A proof: 9/9 checks against a live Meshtasticator instance — multi-hop delivery, relay killed mid-run with the kill independently verified, forged and replayed packets propagating through the mesh but rejected at verification. `bridge_to_hub.py` additionally proven live against a real running hub (below), not just against `verify-alert.ts`. |
| `packages/hub` | Express + SQLite (WAL, `synchronous=FULL`). `POST /alert` verifies via `@ligtas/core` and stores; `GET /alerts` serves a live `AlertBundle`, schema-validated against `docs/alert-bundle.schema.json`. Proven against a real mesh-sim run: genuine alert accepted, forged alert crosses the mesh and is rejected at the hub. |
| `apps/pwa` | Vite + React + Tailwind v4, against `@ligtas/core` directly. Loads a bundle, runs every entry through real `decodePacket`/`verifyBody`/`ReplayGuard` in the browser. Verified visually: instruction card, "not affected" card, purok persistence across reload. |

**Not started:** `packages/stellar`, `apps/sensor-wokwi`.

**Dependencies verified working on this machine**, so none of them is an unknown when the stage that needs them starts:

| Dependency | Verified |
|---|---|
| `better-sqlite3` 13.0.3 | Installs from prebuild — no native compile — loads, WAL mode and BLOB round-trip both confirmed against Node 24 (ABI 137) |
| `@stellar/stellar-sdk` 17.0.1 | `Memo.hash`, `Operation.createClaimableBalance`, `Operation.claimClaimableBalance`, `Claimant` and all three predicate builders, `Horizon.Server` — all present |
| Horizon testnet | Reachable; stellar-core 28.0.1 |
| Meshtasticator + Docker | Proven by Track A |

---

## 2. How the mesh reaches the application

The hub is TypeScript and cannot talk to Meshtastic directly — that is the GPL boundary set out in PRD §5.5. So `mesh-sim` is not only a test harness; it is the bridge between the radio layer and everything above it.

```
Meshtasticator hub node  (TCP 4404 + nodeId)
        |  observes                         [Python, GPL-safe separate process]
        v
   packages/mesh-sim  --POST /alert {packetHex}-->  packages/hub   [Node/TS]
                                                        |  verify via packages/core
                                                        |  store in SQLite outbox
                                                        |  fire siren
                                                        v
                                                   GET /alerts  -->  apps/pwa
```

`POST /alert` carrying the raw 84 bytes as hex is the last piece of the wire contract that PRD §5.5 left open on the application side. Nothing above the radio layer re-encodes the packet: what the hub verifies is byte-for-byte what the sensor signed.

---

## 3. Stage 3 — Forge · closes 19 September 2026

### Day one, before the work splits

Freeze the **alert bundle JSON schema**. It is the contract in three places at once: hub → PWA, live hub → captured file, and Track A → Track B. Define it first and the two tracks below run independently for the rest of the stage instead of blocking on each other.

### Tracks

| Dates | Track A | Track B |
|---|---|---|
| 3 Sep | *Both:* agree and freeze the bundle schema | |
| 3–7 Sep | `packages/hub` — `POST /alert`, verify via `core`, SQLite outbox, siren event, `GET /alerts` | `apps/pwa` scaffold — Vite + Tailwind, purok selection persisted, running against a hand-written sample bundle |
| 8–11 Sep | `mesh-sim` → hub POST bridge; capture a real bundle (genuine + forged + replayed) from a live simulator run | Alert display, purok bitmap matching, explicit "your purok is not affected" state, in-browser verification via `core` |
| 12–14 Sep | `apps/sensor-wokwi` — **designated first cut** | Wire the PWA to the real captured bundle; deploy to Vercel |
| 15–19 Sep | Buffer. Target submission ~17 Sep, not the 19th. | |

### Exit criteria

A signed alert crosses the mesh, the hub verifies and stores it, and the PWA shows the correct purok its instruction. On the published URL, a judge can alter a byte and watch verification fail in front of them.

### Why Wokwi is the designated cut

Nothing depends on it — `mesh-sim` can generate the trigger. It is a strong visual for judges and worth building if the hub and PWA are on schedule by 12 September, and worth dropping without ceremony if they are not.

---

## 4. Stage 4 — Refine (Version 1)

Closing date not yet published. Sequenced by dependency; roughly two weeks of work.

1. **`packages/stellar`** — Horizon Testnet client, Friendbot funding helper, and anchoring: a minimal payment from the hub account to itself carrying `MEMO_HASH = alertHash`. The hash is 32 bytes and `MEMO_HASH` takes exactly 32, so it fits with no encoding loss.
2. **Hub drain worker** — drains the outbox when connectivity returns. Records the transaction hash *before* awaiting confirmation, so an interrupted run reconciles rather than resubmitting blindly. Exponential backoff on failure, every step keyed on `alert_hash` and re-entrant.
3. **PWA offline hardening** — `vite-plugin-pwa` service worker, `idb` persistence for cached alerts, verified with a real device in airplane mode rather than with devtools throttling.
4. **Proof capture** — Stellar Expert screenshots, with the on-chain hash checked against the locally recomputed one.

**Exit:** a phone in airplane mode shows the correct purok instruction; an alert hash appears on Stellar Expert and matches.

---

## 5. Stage 5 — Launch (MVP)

Closing date not yet published.

1. **Payout flow** — one `createClaimableBalance` per matched household, flat amount by severity tier (see §6).
2. **Registry wiring** — households table populated ahead of time; purok bitmap filtered to matching Stellar addresses.
3. **Idempotency hardening** — PRD §7 names this the highest-risk correctness surface in the system. Dedicated tests: run the drain, interrupt it, re-run it, assert no double payment.
4. **Demo recording** — the README's full definition of done, start to finish, uncut.

The hub's own paying account must be Friendbot-funded before this stage — each claimable balance it creates raises *its own* reserve requirement, and Friendbot's 10,000 XLM covers a demo comfortably. Household/claimant accounts do **not** need to exist or be funded beforehand: verified live, three claimable balances created for three fresh, never-funded demo addresses (`packages/hub/README.md`). This corrects an earlier version of this note, which wrongly implied the household side needed funding first.

---

## 6. Decisions recorded here

**Payout denomination — closes PRD §12 open question #8.** Native XLM on Testnet, flat per severity tier:

| Tier | Payout |
|---|---|
| 1 | 10 XLM |
| 2 | 25 XLM |
| 3 | 50 XLM |

Native XLM rather than a peso-pegged test asset: no issuer account, no trustline setup per household, and Friendbot funding works immediately. The real-world peso figure is a policy decision a barangay sets against its own DRRM fund allocation — it is deliberately not hardcoded into the demo, and saying so is more honest than inventing a number and presenting it as designed.

**Reclaim window — closes PRD §12 open question #7.** 30 days. An unclaimed
claimable balance becomes reclaimable by the hub's own account 30 days after
it was created (`Claimant.predicateNot(predicateBeforeRelativeTime(2592000))`),
so a payout nobody ever claims eventually returns to the pool rather than
sitting outstanding forever. Verified live against real Testnet: the
predicate fetched back from Horizon reads `rel_before: "2592000"` exactly
(`packages/hub/README.md`).

**Wokwi sensor node** — kept in Stage 3 scope, designated first cut.

---

## 7. Risks

- **Stage 3 carries the most unplanned work.** Both the hub and the PWA start from zero, in the same 17 days. Stages 4 and 5 build on foundations that will exist by then. Front-load effort accordingly and treat the 15–19 September window as real buffer, not spare capacity.
- **Both PRD open questions that blocked Stage 5 are now resolved** (§6 above): reclaim window (§12 #7) and payout denomination (§12 #8).
- **Stage 4 and 5 dates are unpublished.** The sequencing above holds regardless, but the calendar cannot be committed to until they are.
- **The hosted build proves the packet format, the signature scheme, and the rejection rules. It does not prove live radio propagation.** That distinction is stated in PRD §11 and should stay in any demo narration — claiming otherwise is the kind of overclaim the PRD was written to avoid.
