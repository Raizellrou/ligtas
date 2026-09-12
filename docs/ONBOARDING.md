# LIGTAS — Onboarding & Handoff Guide

For **Juniene** (or anyone picking this repo up on a fresh machine). Written 4 September 2026,
after Stage 3's build work landed on `development-branch`.

Read this top to bottom once before running anything. §0 is a copy-paste block that hands the
setup to Claude Code. Sections 1–4 get you running by hand;
5–7 are the audit of what actually exists versus what the older docs claim; 8–11 are how
we work from here (branching, PRs, rules that must not be broken).

Companion docs — read in this order after this one:

1. [`../README.md`](../README.md) — the pitch. What the system is and why.
2. [`../LIGTAS-PRD.md`](../LIGTAS-PRD.md) — the spec. Packet format, hub design, threat model, milestones.
3. [`BUILD-PLAN.md`](BUILD-PLAN.md) — what gets built when. **Its §1 status table is stale — see §6 below.**
4. Each package's own `README.md` — these are the most accurate docs in the repo.

---

## 0. The shortcut: let Claude Code do the setup

You can hand most of §2–§3 to Claude Code. Open a terminal in an **empty folder** where you
want the project to live, start `claude`, and paste the block below verbatim.

Be clear about what this does and does not do. It **will** clone the repo, check out the
right branch, install, build in the right order, run the tests, smoke-test the hub and the
PWA, and then read the docs and tell you where to start. It **will not** install Node, pnpm,
Docker, or Python for you (§1 — do that first), and it cannot get you the secrets in §5 —
only Charles can.

If anything below fails, do not let it improvise a fix. Come back to §9.

````text
Set up the LIGTAS project on this machine and then brief me on it. Work step by step and
stop at the first failure rather than improvising around it.

1. Check my toolchain and REPORT versions before doing anything else: node (need 20+,
   24.x preferred), pnpm (need 9+), git, python (3.11+), and whether Docker is running.
   Do NOT install or upgrade any of these yourself — if one is missing or too old, stop
   and tell me what to install.

2. Clone https://github.com/Raizellrou/ligtas.git into the current directory and check
   out the branch `development-branch`. This is important: `main` is 14 commits behind
   and is NOT where the work is. Confirm `git log --oneline -1` shows 12c4a4f or newer.

3. Read docs/ONBOARDING.md in full. It is the handoff guide written for me. Follow its
   sections 3, 6 and 7. Also read CLAUDE.md at the repo root before writing any code —
   it holds hard constraints that must not be broken.

4. Run `pnpm install`. Then build in this exact order, because these packages depend on
   each other's compiled dist/ and not their sources:
     pnpm --filter @ligtas/core build
     pnpm --filter @ligtas/stellar build
     pnpm --filter @ligtas/hub build

5. Run `pnpm test`. Expect 5 test files, 30 tests passing. Report the actual number.

6. Smoke-test the hub: start it on port 3001 (build output only — `node
   packages/hub/dist/index.js`, never `src/index.ts`, it has no direct-run path), then
   curl /health and /alerts. An empty alerts array and a log line saying
   "drain: disabled" are both CORRECT on a fresh setup — do not try to "fix" either.
   Stop the hub when done.

7. Start the PWA dev server (`pnpm --filter @ligtas/pwa dev`) and confirm it serves on
   localhost:5173 without import errors. Leave it running and tell me the URL.

8. Then brief me, in plain language and without me having to read the whole PRD:
   - What this project is and what each package does.
   - What is already built and proven, versus what is still missing. Use
     docs/ONBOARDING.md section 6 — do NOT trust docs/BUILD-PLAN.md section 1, it is
     stale and says two finished packages are unstarted.
   - Exactly where I should start work. Per section 7 that should be item 4.3, PWA
     offline hardening (vite-plugin-pwa service worker + idb persistence), on a branch
     named `stage4/pwa-offline` cut from `development-branch`.
   - Anything that failed above, or that I need from Charles before I can proceed
     (section 5 lists the secrets).

Do not create any branch, commit anything, or push anything yet. Just set up, verify,
and brief me.
````

When it is done and you are ready to actually start coding, that is §8.

---

## 1. Prerequisites

Install these before touching the repo. The middle column is what the code was built and
verified against; the right column is the real floor.

| Tool | Verified on | Minimum | Notes |
|---|---|---|---|
| Node.js | 24.7.0 | 20 (`package.json` engines) | **Use 24.x.** `better-sqlite3` 13.0.3 ships a prebuilt binary per Node ABI; 24 is the one proven here, so you avoid a native compile. |
| pnpm | 11.25.0 | 9 | `corepack enable`, then `corepack prepare pnpm@latest --activate`. Or `npm i -g pnpm`. **Never use npm or yarn in this repo** — it is a pnpm workspace and the lockfile is `pnpm-lock.yaml`. |
| Git | 2.53 | any recent | — |
| Python | 3.13.7 | 3.11 | Only for `packages/mesh-sim`. And even there you run *Meshtasticator's own venv Python*, not this one — see §4.3. |
| Docker Desktop | — | — | Only for `packages/mesh-sim`. Must be **running**, not just installed. |

Optional, only if you touch `apps/sensor-wokwi`:

- A [Wokwi](https://wokwi.com) account (browser), or the Wokwi VS Code extension.
- `arduino-cli` plus the `esp32:esp32` core 3.3.11, if you want to compile the sketch locally.

You do **not** need: Rust, any Stellar CLI, Soroban tooling, or any physical hardware.
See §10 — several of those are hard-prohibited.

---

## 2. Getting the code

The repo is `https://github.com/Raizellrou/ligtas.git`.

```bash
git clone https://github.com/Raizellrou/ligtas.git
```

```bash
cd ligtas && git checkout development-branch
```

### Read this before you do anything else

**`main` is 14 commits behind and is NOT where the work is.** `main` is the
submission/stable branch — it stops at "Add LIGTAS PRD". Every package built so far lives
on `development-branch`.

| Branch | Commit | What it is | Use it? |
|---|---|---|---|
| `development-branch` | `12c4a4f` | **The real trunk.** All Stage 3 work. | Yes — branch from here, PR back into here. |
| `main` | `2e05adf` | Submission branch, 14 commits behind. | No. Never commit here, never branch from here. |
| `stage3/core-packet-codec` | `4e6af48` | Dead feature branch, already merged forward and superseded. | No. Ignore it. |

Point your local branch at the right remote so you cannot drift:

```bash
git branch --set-upstream-to=origin/development-branch development-branch
```

Confirm you are in the right place — this must print `12c4a4f` or newer:

```bash
git log --oneline -1
```

### Two files that live only on this branch

`CLAUDE.md` and `docs/master.md` are on `development-branch` but **not on `main`**. They
were removed from the submission repo in commit `d100ccd` and restored here in `1b8dd63`,
deliberately, on the dev branch only.

- `CLAUDE.md` is the per-session context file Claude Code auto-loads. It holds the hard
  constraints in §10. Without it, Claude on your machine does not know they exist and
  *will* suggest breaking them (Soroban, GPL Meshtastic libraries, network calls inside
  `packages/core`).
- `docs/master.md` is the longer-form architecture and threat-model reference.

Practical consequence: this is one more reason a clone of `main` is useless to you. Check
out `development-branch` and you get both automatically — nothing to ask for.

---

## 3. First-run setup (about 10 minutes)

From the repo root, on `development-branch`:

```bash
pnpm install
```

If pnpm asks to approve build scripts, approve `better-sqlite3` and `esbuild`
(`pnpm approve-builds`). Both are already allowlisted in `pnpm-workspace.yaml`, so normally
it will not ask.

### Build order matters

The packages depend on each other's **compiled `dist/`**, not their sources. Build in this
exact order or you will get module-not-found errors:

```bash
pnpm --filter @ligtas/core build && pnpm --filter @ligtas/stellar build && pnpm --filter @ligtas/hub build
```

Why: `@ligtas/hub` imports `@ligtas/stellar` (in `src/drain.ts`) and `@ligtas/core`, and
both resolve through their `dist/index.js`. `@ligtas/core` is the root of the dependency
graph — build it first, always.

### Verify the install

```bash
pnpm test
```

Expected: **5 test files, 30 tests passing** (Vitest, all in `packages/core`). If you see
29, you are on an older commit — pull.

Then confirm the hub actually starts. PowerShell:

```powershell
$env:PORT=3001; node packages/hub/dist/index.js
```

bash / macOS / Linux:

```bash
PORT=3001 node packages/hub/dist/index.js
```

You should see:

```
hub listening on :3001 (db: ...hub.sqlite, 1 issuer(s) loaded, drain: disabled -- no LIGTAS_HUB_STELLAR_SECRET)
```

In another terminal:

```bash
curl http://localhost:3001/health && curl http://localhost:3001/alerts
```

`/health` returns `{"ok":true}`. `/alerts` returns an `AlertBundle` with an empty `alerts`
array — empty is correct on a fresh database. **`drain: disabled` is also correct** and
expected until you set a Stellar secret (§4.4).

### Run the PWA

```bash
pnpm --filter @ligtas/pwa dev
```

Opens on http://localhost:5173. It runs against the captured bundle at
`apps/pwa/public/alert-bundle.json` — real signed packets recorded from an actual
Meshtasticator run, including a forged and a replayed one — and verifies every entry in the
browser through the real `@ligtas/core`. Three role tabs: Resident, Tester, How it works.

`@ligtas/core` must be built first (it is a workspace dependency of the PWA). If the PWA
throws on import, that is what you forgot.

---

## 4. Running each piece

### 4.1 `packages/core` — the pure offline layer

Nothing to run; it is a library plus two CLI bridges used by the Python mesh scripts.

```bash
node packages/core/dist/scripts/emit-alert.js --sequence 1
```

```bash
node packages/core/dist/scripts/verify-alert.js --packet-hex <168 hex chars> --issuer-public-key <G...> --last-seq -1
```

`emit-alert.js` options: `--hazard`, `--severity`, `--purok-bitmap`, `--sequence`,
`--water-level`, `--issuer-index`, `--issuer-secret`, `--mode <genuine|forged|tampered>`.
The `forged` and `tampered` modes are how you produce packets a verifier *should* reject —
use them rather than hand-corrupting bytes.

**Gotcha:** `emit-alert --mode genuine` **with no `--issuer-secret` signs with a fresh
random keypair**, which the hub will correctly reject. This already bit us once — it is
bug #3 in `packages/mesh-sim/README.md`. A "genuine" packet is only genuine if it is signed
by the secret matching the public key the hub has configured for that `issuerIndex`.
`issuerIndex` in the packet body is just a config value; it does not tie the packet to any
keypair.

### 4.2 `packages/hub` — Express + SQLite outbox

Full docs: [`../packages/hub/README.md`](../packages/hub/README.md).

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `LIGTAS_DB_PATH` | `packages/hub/hub.sqlite` | SQLite file (gitignored) |
| `LIGTAS_ISSUERS_PATH` | `packages/hub/config/issuers.json` | Authorised issuer public keys |
| `LIGTAS_HUB_STELLAR_SECRET` | *(unset)* | The hub's own Testnet secret. Unset means the drain worker is off and `POST /drain` returns 503. |
| `LIGTAS_DRAIN_INTERVAL_MS` | `60000` | Auto-drain interval, when the secret is set |

Routes: `POST /alert` (body `{ "packetHex": "..." }`), `GET /alerts`, `POST /drain`,
`GET /health`. `POST /alert` returns a `decision` of `accepted`, `rejected_signature`,
`rejected_unknown_issuer`, `rejected_replay`, `duplicate`, or `malformed`.

**Known limitation, do not fight it:** there is no `tsx`-style direct-run path. You must
`pnpm --filter @ligtas/hub build` and run `node packages/hub/dist/index.js`. Running
`node packages/hub/src/index.ts` will fail — its `@ligtas/core` import expects compiled JS.

`packages/hub/config/issuers.json` is committed and holds **only public keys**. That is
safe and deliberate: a reproducible demo needs it. Never put a secret key in it.

### 4.3 `packages/mesh-sim` — the LoRa mesh simulation (Python)

Full docs: [`../packages/mesh-sim/README.md`](../packages/mesh-sim/README.md). Read its
"Two real bugs found building this" section before changing the topology or driver logic.

Setup:

1. Docker Desktop running.
2. Clone [Meshtasticator](https://github.com/meshtastic/Meshtasticator) **as a sibling of
   this repo's parent folder** (`../../../Meshtasticator` relative to `packages/mesh-sim`).
   Set `MESHTASTICATOR_PATH` if you put it elsewhere.
3. Set up Meshtasticator's own venv per its README: `pip install -r requirements.txt`, plus
   `pip install docker`.
4. `packages/core` must be compiled.

Run with **Meshtasticator's venv Python**, not yours — the scripts import its
`lib.interactive` module directly rather than reimplementing radio propagation:

```bash
cd packages/mesh-sim && <path-to-meshtasticator>/.venv/Scripts/python.exe run_relay_test.py
```

| Script | What it does |
|---|---|
| `run_relay_test.py` | The Track A proof: multi-hop delivery, relay killed mid-run (kill independently verified), forged and replayed packets rejected. 9/9 checks. |
| `bridge_to_hub.py` | Mesh to live hub over HTTP. Needs the hub already running, and `LIGTAS_DEMO_ISSUER_SECRET` set. |
| `debug_propagation.py` | Sends one packet and dumps everything observed. Use this when something breaks. |
| `topology.yaml` | The 4-node layout. Coordinates are tuned against the simulator's real antenna-range model — do not casually retune them. |

`bridge_to_hub.py` environment: `LIGTAS_HUB_URL` (default `http://localhost:3001`),
`LIGTAS_DEMO_ISSUER_SECRET` (**required**), `LIGTAS_CAPTURE_OUTPUT` (defaults to writing
`apps/pwa/public/alert-bundle.json` — note that a run overwrites the committed demo bundle
the PWA ships with, so check `git diff` afterwards).

### 4.4 `packages/stellar` — Horizon Testnet anchoring

Full docs: [`../packages/stellar/README.md`](../packages/stellar/README.md).

This is **the only package in the repo allowed to import Horizon.** See §10.

```bash
node packages/stellar/dist/scripts/anchor-alert.js --alert-hash <64 hex chars> --fund
```

`--fund` calls Friendbot first (needed for a fresh account). `--secret <S...>` reuses an
existing one. Already proven live: transaction `997c8374…e78b1` on Testnet, with the memo
fetched independently from Horizon and matched against the locally recomputed hash exactly.

### 4.5 `apps/sensor-wokwi` — ESP32 sensor node

Full docs: [`../apps/sensor-wokwi/README.md`](../apps/sensor-wokwi/README.md).

Open the folder in Wokwi (`diagram.json` + `wokwi.toml` + `sensor-wokwi.ino`). A
potentiometer stands in for the river gauge; the sketch does **real** SHA-256 (ESP32
mbedtls) plus Ed25519 (Monocypher's RFC 8032 module, deliberately *not* Monocypher's
BLAKE2b default, which would produce a non-Stellar-compatible signature) and prints a real
84-byte signed packet as hex.

Verified: the signature matches `@stellar/stellar-sdk` byte-for-byte, and the sketch
compiles clean against Arduino-ESP32 core 3.3.11. **Wokwi runtime — since verified**
too: a live anonymous wokwi.com session booted this exact project, connected WiFi,
and the LED reacted to the potentiometer. That run caught a real bug —
`diagram.json` used the part id `wokwi-potentiometer-rotary`, which doesn't exist;
fixed to `wokwi-potentiometer`. **Still not verified:** full Serial output (the
anonymous session had no Serial Monitor panel available, likely gated behind
sign-in) — a signed-in session or the Wokwi VS Code extension would close that
remainder. See `apps/sensor-wokwi/README.md` for detail.

The `DEMO_SEED` in the sketch is hardcoded and Testnet-only. It is intentionally a
*different* keypair from the hub's demo issuer — this app is standalone by design.

### 4.6 `apps/pwa` — the resident PWA

Deployed on Vercel from Charles's account. `.vercel/` is gitignored, so you will not have
the project link. If you need to deploy, ask Charles to add you to the Vercel project, then
`vercel link`. Do **not** create a second project.

Build config lives in `vercel.json` at the repo root:
`pnpm --filter @ligtas/core build && pnpm --filter @ligtas/pwa build`, output directory
`apps/pwa/dist`.

---

## 5. Secrets you need from Charles

None of these are in the repo, and none of them ever should be. Get them over a private
channel, keep them in your shell environment or a local `.env` (already gitignored) —
**never commit them, and never paste them into an issue or PR.**

| Secret | Needed for | Note |
|---|---|---|
| `LIGTAS_DEMO_ISSUER_SECRET` | `bridge_to_hub.py` | Must match `issuerPublicKey` `GDOOR3ZR…LRCF` in `packages/hub/config/issuers.json`, or the hub correctly rejects everything as `rejected_signature`. |
| `LIGTAS_HUB_STELLAR_SECRET` | The hub drain worker | The hub's own Testnet account. You can also just generate your own and Friendbot-fund it — nothing depends on reusing his. |
| Vercel project access | Deploying the PWA | Only if you need to deploy. |

All Stellar work is **Testnet only**. Generating your own keypairs with `Keypair.random()`
plus Friendbot is free and encouraged for local work.

---

## 6. Audit: what is actually built (originally as of `12c4a4f`; Stage 4/5 rows updated since)

I checked the code against the docs. **`docs/BUILD-PLAN.md` §1 is out of date** — it was
written 2 September and many commits landed after it. Trust this table over that one (and see
§7 below for the fuller Stage 4/5 picture, which has moved further still).

| Package | Real state | Evidence |
|---|---|---|
| `packages/core` | **Done.** Packet codec (`DataView`, big-endian, 84 bytes), SEP-53 sign/verify, `ReplayGuard`, `AlertBundle` types, `emit-alert` / `verify-alert` CLIs. 36 Vitest tests passing across 6 files, typecheck clean. | `pnpm test` |
| `packages/mesh-sim` | **Done.** 9/9 checks against a live Meshtasticator: multi-hop delivery, relay killed mid-run with the kill independently verified, forged and replayed packets crossing the mesh and rejected at verification. `bridge_to_hub.py` proven against a real running hub, and since extended to read a configurable demo issuer index (`82c831d`). | `55c52b7`, `4e6af48`, `82c831d` |
| `packages/hub` | **Done**, and grown well past the original Stage 3 scope. Express + SQLite (WAL, `synchronous=FULL`). `POST /alert` verifies via `@ligtas/core`; `GET /alerts` serves a schema-validated live bundle; `POST /drain` anchors the outbox and runs the payout flow. Drain now serializes concurrent callers onto one in-flight run — a real double-payment race was caught live and fixed (`c6d6127`). | `4e6af48`, `041c137`, `c6d6127` |
| `packages/stellar` | **Done.** Horizon Testnet client, Friendbot funding, `anchorAlertHash` with `MEMO_HASH`, and `preparePayoutTransaction`. Proven live on Testnet with the memo decoded independently from Horizon. | `ab5a6b5` |
| **Hub drain worker** | **Done.** Reconciles `submitted`/`pending` rows before picking up new work; records the transaction hash before awaiting confirmation; falls back to querying existing claimable balances when a transaction-hash lookup itself is ambiguous (PRD §7's "where uncertain" case). Verified live including a simulated mid-drain crash, which reconciled without double-anchoring or double-paying. | `041c137`, `packages/hub/src/drain.ts` |
| `apps/sensor-wokwi` | **Done.** Real on-device Ed25519 signing cross-checked against the Stellar SDK, sketch compiles clean, and the Wokwi runtime itself has been run live (booted, WiFi connected, LED reacted to the potentiometer). One remaining gap: full Serial output was never captured — the anonymous Wokwi session had no Serial Monitor panel available. | `be9ad22`, `23dd7c0` |
| `apps/pwa` | **Stage 3 and Stage 4 both done.** Vite + React 19 + Tailwind v4, three roles (Resident / Tester / How it works), real in-browser verification, deployed to Vercel, `vite-plugin-pwa` service worker + `idb` persistence in place. | `f99b056`, `82caa0d`, and Stage 4's `apps/pwa` offline-hardening PR |

### Doc drift — resolved

These were wrong at the time this section was first written; all are now fixed in the repo
(most recently as part of finishing off Stage 5 item 5.3 and this audit):

- ~~`docs/BUILD-PLAN.md` §1 — "Not started: `packages/stellar`, `apps/sensor-wokwi`" was
  false.~~ Fixed: §1 now carries an explicit "this table is stale, see here instead" pointer
  rather than a status claim that will drift again.
- ~~`packages/stellar/README.md` "Not yet built" for the hub drain worker.~~ Fixed — the
  README's own "Built since this README was first written" section covers it.
- ~~`CLAUDE.md` describing `apps/pwa` as using `vite-plugin-pwa` and `idb` before either was
  a dependency.~~ Fixed — both are in `apps/pwa/package.json` now.
- ~~`apps/pwa/README.md` was stock Vite template boilerplate.~~ Replaced with a real README.
- `LIGTAS-PRD.md` §11 still says 29 tests — cosmetic, low-priority, left as-is; the real
  count lives in this file and in CI, not in a spec doc that predates the code.

---

## 7. What is left to build — your actual runway

Sourced from `docs/BUILD-PLAN.md` §4–5 and `LIGTAS-PRD.md` §11–12, corrected against what
is really in the tree. Roughly in dependency order.

### Stage 4 · Refine (Version 1)

Exit criterion: *a phone in airplane mode shows the correct purok instruction; an alert hash
appears on Stellar Expert and matches the locally recomputed hash.*

| # | Work | State | Notes |
|---|---|---|---|
| 4.1 | `packages/stellar` anchoring | Done | — |
| 4.2 | Hub drain worker | Done | — |
| 4.3 | PWA offline hardening | Done | `vite-plugin-pwa` (service worker) + `idb` (persist cached alerts). Verified by killing the serving process entirely after a normal load and reloading — app shell and the last-known alert bundle both still rendered, served from the service worker cache. Not verified on a real device in actual airplane mode. |
| 4.4 | Proof capture | Done | Screenshot and a from-scratch re-verification (on-chain memo decoded and checked against the locally recomputed hash, redone rather than trusted) in `docs/proof/`. |

Stage 4's exit criterion is met: a service worker keeps the correct purok instruction available
with the origin unreachable, and an alert hash is visible on Stellar Expert matching the locally
recomputed hash. See `docs/proof/` and item 4.3's PR for how each was verified.

### Stage 5 · Launch (MVP)

| # | Work | State | Notes |
|---|---|---|---|
| 5.1 | **Payout flow** | Done | One `createClaimableBalance` per matched household. Flat by severity tier — **tier 1 = 10 XLM, tier 2 = 25 XLM, tier 3 = 50 XLM**, native XLM on Testnet (decided in BUILD-PLAN §6). `payout_status`/`payout_tx` drive the same two-phase durability pattern anchoring already used. Verified live end to end — see `packages/hub/README.md`. |
| 5.2 | **Registry wiring** | Done | `households` table (household ID → purok → Stellar address) lives in the hub's SQLite DB, seeded from `config/households.json` on startup. `docs/master.md`'s TODO on where it lives is resolved; syncing it across multiple hubs is still genuinely open (PRD §12 #5). |
| 5.3 | **Idempotency hardening** | Done | Dedicated Vitest coverage: crash-before-confirmation reconciled as confirmed without resubmitting, crash-before-network-receipt resubmitted exactly once, an already-created payout never re-queried, and concurrent overlapping `drainOutbox` calls collapsed onto one in-flight run (a real double-payment race, caught live and fixed — `c6d6127`). The Horizon-query fallback for when `payout_status` itself is ambiguous is now built too: `reconcilePayoutByExistingBalances` in `packages/hub/src/drain.ts` checks existing claimable balances for the affected households before ever resubmitting. `packages/hub/test/drain.test.ts`. |
| 5.4 | Demo recording | In progress | The README's full definition of done, start to finish, uncut. A live mesh-to-hub-to-PWA rehearsal run is what surfaced and fixed the 5.1–5.3 bugs above (`556ca0c`…`c6d6127`), so this is actively underway rather than not started — but the recording itself isn't finished, and `apps/pwa/public/alert-bundle.json` has an uncommitted fresh capture pending a decision on whether to keep it. **Last item blocking v0.** |

Prerequisite: **the hub's own paying account** must be Friendbot-funded before this stage —
each claimable balance it creates raises *its own* reserve requirement. Household/claimant
accounts do **not** need to exist or be funded first — verified live, three claimable
balances created for three fresh, never-funded demo addresses. (An earlier version of this
note wrongly implied the household side needed funding too.)

### Blocking open questions

`LIGTAS-PRD.md` §12 carries eight open questions. Two mattered for Stage 5's runway, and both are now resolved:

- **#7 Reclaim window** — 30 days. Verified live: the claimable balance predicate fetched back
  from Horizon reads `rel_before: "2592000"` exactly. Recorded in `BUILD-PLAN.md` §6.
- **#8 Payout denomination** — native XLM, 10/25/50. Recorded in `BUILD-PLAN.md` §6.

The other six (duty cycle, sensor trust, key lifecycle, threshold ownership, pool
replenishment, registry synchronisation, deployment partner) are documented-not-blocking.
Do not invent answers — the PRD's stance is that carrying them forward honestly beats
fabricating a resolution.

### Also worth doing

- ~~Close the doc drift listed in §6.~~ Done — see §6's "Doc drift — resolved".
- ~~Replace `apps/pwa/README.md`'s template boilerplate with something real.~~ Done.
- ~~Run `apps/sensor-wokwi` in an actual Wokwi session to close its one honest gap.~~ Done (`23dd7c0`) — one narrower gap remains: capturing full Serial output needs a signed-in Wokwi session or the VS Code extension, neither available in an anonymous session.
- When `development-branch` is next merged into `main` for a submission, decide what to do
  with `CLAUDE.md` and `docs/master.md`. They were removed from the submission repo once
  already (`d100ccd`) and restored here (`1b8dd63`) so both machines share the same
  constraints. Whether they belong in a submission is Charles's call, not a default.

---

## 8. How we work: branching and PRs

**Everything goes to `development-branch`. Nothing goes to `main`.**

### Starting a feature

Always branch from an up-to-date `development-branch`:

```bash
git checkout development-branch && git pull origin development-branch && git checkout -b stage4/pwa-offline
```

Naming convention, matching the existing `stage3/core-packet-codec`:
`stage<N>/<short-kebab-description>`.

| Planned work | Branch name |
|---|---|
| PWA service worker + idb (4.3) | `stage4/pwa-offline` |
| Proof capture (4.4) | `stage4/proof-capture` |
| Claimable-balance payouts (5.1) | `stage5/payout-flow` |
| Household registry (5.2) | `stage5/registry` |
| Idempotency tests (5.3) | `stage5/idempotency-tests` — done directly on `development-branch` instead (`3e672d8`), skipping the branch/PR step this table recommends |
| Doc drift fixes (§6) | `docs/status-drift` |

### While working

Commit in small, self-describing steps. Match the existing commit style — imperative mood,
one line, saying what changed and why it matters:

> `Add hub drain worker: outbox to Stellar Testnet, verified live`
>
> `Add tester + how-it-works roles to the PWA; fix hashing outside secure contexts`

Push early so the branch exists on the remote and Charles can see it:

```bash
git push -u origin stage4/pwa-offline
```

### Before you open a PR — the checklist

Run all of it. Every item.

```bash
pnpm test && pnpm --filter @ligtas/core build && pnpm --filter @ligtas/stellar build && pnpm --filter @ligtas/hub build && pnpm --filter @ligtas/pwa build && pnpm --filter @ligtas/pwa lint
```

Then:

- [ ] `pnpm test` shows 30 passing.
- [ ] Lint is clean apart from one **pre-existing** warning
      (`src/lib/useSimulation.ts:48` — `react(use-memo)`). That one is not yours; a warning
      is not an error and oxlint still exits 0. Do not add new ones.
- [ ] `git status` is clean — no stray `dist/`, `*.sqlite`, `.env`, or `__pycache__`. All
      are gitignored, but check anyway.
- [ ] **No secret keys anywhere in the diff.** Search for them:
      `git diff development-branch | grep -iE "S[A-Z2-7]{55}"` — should return nothing.
- [ ] If you ran `bridge_to_hub.py`, check whether it overwrote
      `apps/pwa/public/alert-bundle.json`. Committing a fresh capture is fine and sometimes
      right — committing one by accident is not.
- [ ] If you touched `packages/core`, you added tests. It is the only tested package and it
      must stay that way.
- [ ] If you touched the wire format in `packages/core/src/codec.ts`, you **also** updated
      `apps/sensor-wokwi/sensor-wokwi.ino` and the byte-layout table in its README —
      different languages, no shared type, kept in sync by hand.
- [ ] If a claim in a README is now false, you fixed that README in the same PR.
- [ ] You did not add a GPL dependency (§10).

### Opening the PR

```bash
gh pr create --base development-branch --head stage4/pwa-offline
```

**`--base development-branch` — never omit it.** GitHub will default the base to `main`,
which is wrong. To protect against that permanently, the repo's default branch can be
changed — but that affects both of you, so **ask Charles first**:

```bash
gh repo edit Raizellrou/ligtas --default-branch development-branch
```

A PR description should say three things: what changed, how you verified it *for real*, and
what you did **not** verify. That last part is the house style throughout this repo — see
any package README. Claiming more than you proved is the specific failure mode the PRD was
written to avoid.

### Staying in sync

Before starting anything new, and on any day Charles has pushed:

```bash
git checkout development-branch && git pull origin development-branch
```

If your feature branch has drifted behind:

```bash
git checkout stage4/pwa-offline && git rebase development-branch
```

Prefer `rebase` while the branch is unpushed or only yours. Once someone else has pulled it,
use `git merge development-branch` instead so you do not rewrite shared history.

### Who owns what (suggested, to avoid collisions)

Stage 3 ran as two parallel tracks and that worked. Same idea:

- **Juniene** — `apps/pwa` (4.3, 4.4). Self-contained, frontend, unblocked today.
- **Charles** — `packages/hub` and `packages/stellar` (5.1–5.3).

If either of you needs to touch `packages/core`, say so before starting — it is the one
package everything else depends on.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@ligtas/core'` | Not built, or built out of order | Build core first, then stellar, then hub (§3) |
| `node packages/hub/src/index.ts` fails | Known limitation — no direct-run path | Build first, run `dist/index.js` |
| Hub logs `drain: disabled` | `LIGTAS_HUB_STELLAR_SECRET` unset | Expected. Set it only when working on anchoring. |
| `POST /drain` returns 503 | Same as above | Same as above |
| Hub returns `rejected_signature` for a "genuine" packet | Signed with a fresh random keypair | Pass `--issuer-secret` matching the configured `issuerPublicKey`. See §4.1. |
| `pnpm test` shows 29 tests | Stale checkout | `git pull origin development-branch` |
| `better-sqlite3` tries to compile from source | Node version with no matching prebuild | Switch to Node 24.x |
| Mesh: `ModuleNotFoundError: lib.interactive` | Using your Python, not Meshtasticator's venv | Run with `<meshtasticator>/.venv/Scripts/python.exe` |
| Mesh: cannot find Meshtasticator | Not checked out as a sibling directory | Set `MESHTASTICATOR_PATH` |
| Mesh: relays forward nothing | Nodes defaulting to `CLIENT_MUTE` | `isRepeater: true` on relay nodes — bug #1 in `packages/mesh-sim/README.md` |
| Mesh: `kill` fails with exit 127 | No standalone `kill` binary in the meshtasticd image | `exec_run(["sh","-c",f"kill -9 {pid}"])` — bug #2, same README |
| PWA hashing fails on a phone over LAN | `crypto.subtle` needs a secure context | Already fixed in `12c4a4f` — pull if you hit it |
| Claude Code suggests Soroban or a Rust contract | `CLAUDE.md` not loaded | You are probably on `main`. Check out `development-branch` — see §2 |

When something in the mesh breaks, reach for `debug_propagation.py` and **read the real
output**. All three of the mesh bugs on record were found that way, not by reasoning about
what should have happened.

---

## 10. Hard constraints — do not break these

From `CLAUDE.md`. These are not preferences; breaking one damages the project.

1. **No Rust, no Soroban.** Stellar Classic only — `MEMO_HASH` for anchoring, claimable
   balances for payouts.
2. **No physical hardware, at any stage.** Everything simulated (Meshtasticator, Wokwi).
   Development cost this September is ₱0, and that is part of the pitch.
3. **Testnet only**, unless explicitly told otherwise.
4. **`packages/core` must never import Horizon or RPC.** Field nodes verify signatures fully
   offline — any network dependency there breaks the threat model. `packages/stellar` is the
   *only* package allowed to touch Horizon.
5. **Never add a GPL dependency.** This repo is MIT. `@meshtastic/*` is GPL-3.0-only — that
   is the entire reason `packages/mesh-sim` is a separate Python process instead of
   TypeScript. Check the licence before adding anything.
6. **Out of scope, do not build it:** multi-barangay federation, native mobile app, PAGASA
   API integration, LGU enrollment workflow.
7. **Never commit a secret key.** `issuers.json` holds public keys only.
8. **Do not overclaim** in docs, commits, or the demo. The hosted build proves the packet
   format, the signature scheme and the rejection rules. It does **not** prove live radio
   propagation. That distinction stays in every piece of narration.

---

## 11. One-page quickstart

```bash
git clone https://github.com/Raizellrou/ligtas.git && cd ligtas && git checkout development-branch && pnpm install
```

```bash
pnpm --filter @ligtas/core build && pnpm --filter @ligtas/stellar build && pnpm --filter @ligtas/hub build && pnpm test
```

```bash
pnpm --filter @ligtas/pwa dev
```

```powershell
$env:PORT=3001; node packages/hub/dist/index.js
```

```bash
git checkout development-branch && git pull origin development-branch && git checkout -b stage4/pwa-offline
```

```bash
git push -u origin stage4/pwa-offline && gh pr create --base development-branch
```

Ask Charles for `LIGTAS_DEMO_ISSUER_SECRET` — only needed when you run the mesh bridge
(§4.3). Everything else in this quickstart works without it.

Or skip the manual path entirely and paste §0 into Claude Code.
