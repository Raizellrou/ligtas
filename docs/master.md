# LIGTAS — Master Reference

Longer-form reference doc. Not auto-loaded — see [CLAUDE.md](../CLAUDE.md) for the lean per-session context, and [README.md](../README.md) for the pitch this expands on.

---

## Architecture layers

**1. Sensor node (river).** Water-level sensor + LoRa radio, solar-powered. Detects threshold crossing, builds the alert packet (hazard, severity tier, affected puroks, timestamp, sequence number), signs it with its Stellar keypair, transmits.

**2. Relay nodes (rooftops, 2–3 per barangay).** Pure LoRa repeaters. Verify the incoming signature offline against a cached list of authorised issuer public keys; drop anything with a bad signature or a reused sequence number; rebroadcast valid packets. No internet dependency at this layer — `packages/core` (the packet + verification logic) must never import Horizon or RPC, since this is exactly the code that has to run correctly with zero connectivity.

**3. Hub (barangay hall).** Node + Express + `better-sqlite3`. Receives the verified alert over LoRa, fires the siren, and serves a local-only WiFi network + PWA showing purok-specific evacuation instructions (no internet required — the PWA is served from the hub's own memory/cache). Simultaneously writes the alert into a store-and-forward outbox table.

**4. Reconnection layer.** When the hub regains internet connectivity, the outbox drains: each queued alert hash gets anchored to Stellar (`MEMO_HASH`, Testnet for now), and matching claimable balances are created for households in the affected puroks.

**5. Registry (off-chain, pre-disaster).** Household ID → purok → Stellar address. Built: lives in the hub's SQLite DB (`packages/hub/src/households.ts`, seeded from `config/households.json` on startup, same pattern as the issuer list). Still open: how it syncs across hubs if a barangay needs more than one (see "WiFi range" limitation in README, and PRD §12 open question #5) — each hub currently has its own independent copy, with no reconciliation between them.

---

## Threat model

| Threat | Mitigation | Status |
|---|---|---|
| Forged evacuation alert broadcast by an attacker with a cheap LoRa radio | Ed25519 signature verification, fully offline, against a cached authorised-issuer list | Core design principle |
| Replay of a previously-valid alert | Sequence number check at every relay node | Core design principle |
| Post-disaster dispute over whether/when a warning was issued | Alert hash anchored to Stellar — neutral, timestamped, held by no single party | Core design principle |
| Compromise of the signing key (barangay captain's Stellar account) | TODO — README notes payouts route through a multisig relief account, but doesn't specify multisig or key-rotation policy for the *alert-signing* key itself | **Open** |
| Physical tampering with a river/relay node | TODO — not addressed in README | **Open** |
| Radio jamming / RF interference | TODO — not addressed in README | **Open** |
| Sensor failure / false negative (river rises, node doesn't report) | TODO — not addressed in README | **Open** |
| Regulatory: unlicensed frequency use | Uses 915–918 MHz (AS923-3) under NTC MC 03-05-2007 as amended, not the unlicensed-elsewhere 433/868 MHz bands | Addressed in README |

---

## Hardware costs (real deployment, not the hackathon build)

- **~₱20,000 per barangay**: roughly 5 nodes at ~₱4,000 each (LoRa board, sensors, solar panel, battery, enclosure, siren).
- Explicitly **not** one radio per household — at 200+ households that's ~₱300,000 and unfundable. The radio mesh covers kilometres *across* the barangay; the hub's siren + WiFi cover only the last 50–100 m to nearby households.
- **Field validation pilot**: ₱4,300 budgeted for a two-node real-world RF test, since simulation (Meshtasticator) proves protocol/routing/signing/settlement but not real terrain propagation.
- A spread-out barangay may need 3–4 hubs (WiFi range ceiling), multiplying the ₱20,000 baseline. TODO: no per-hub incremental cost breakdown in README — assume roughly linear in node count.

---

## September timeline

- **Development cost this September: ₱0** — the mesh runs entirely in Meshtasticator's simulator (real firmware, simulated radio), and the sensor node runs in Wokwi in-browser. No physical hardware purchased at this stage.
- Hackathon stage mapping (from project tracking, not README):
  - Stage 1 — Ideation: done, submitted.
  - Stage 2 — Blueprint/PRD: in progress.
  - Stage 3 — Forge (Version 0): signed packet format + replay protection + multi-hop propagation w/ node-failure rerouting, in simulation. No PWA, no Stellar yet.
  - Stage 4 — Refine (Version 1): offline PWA, store-and-forward queue, Stellar anchoring.
  - Stage 5 — Launch (MVP): claimable-balance payout flow + full end-to-end demo.
- TODO: no specific calendar dates for these stages are in README — fill in once the hackathon schedule is confirmed.

---

## Known limitations (from README, unchanged)

- Simulation validates protocol/routing/signing/settlement, not real RF propagation through terrain.
- WiFi hub range (50–100 m) is much shorter than LoRa range (kilometres) — one hub per house cluster.
- Parametric payouts are imprecise by design: location + threshold triggers a flat payout, not verified per-household damage.
- Wallet onboarding at the household level is unsolved — MVP routes payouts to a barangay relief multisig account, not to 200 individual households.
