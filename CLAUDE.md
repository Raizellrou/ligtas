# LIGTAS

*LoRa-Integrated Grassroots Typhoon Alert System*

Offline LoRa flood warning mesh for Philippine barangays. Signed alerts propagate over LoRa with no internet; once connectivity returns, alert records anchor to Stellar and parametric payouts release automatically. See [README.md](README.md) for full pitch.

## Stack

TypeScript monorepo, pnpm workspaces:

- `packages/core` — alert packet encode/decode (`DataView`), signing via `@stellar/stellar-sdk/base`. Pure, offline-only.
- `packages/mesh-sim` — **Python** (the one non-TS package), talks to Meshtasticator over TCP. Python because the Meshtastic JS libs are GPL-3.0 and would relicense this MIT repo; a separate process keeps that boundary clean.
- `packages/hub` — Node + Express + `better-sqlite3` outbox (store-and-forward queue).
- `packages/stellar` — `@stellar/stellar-sdk`, Horizon Testnet client for anchoring + payouts.
- `apps/pwa` — React + Vite + Tailwind + `vite-plugin-pwa` + `idb`.
- `apps/sensor-wokwi` — Arduino C++, runs in Wokwi.

## Simulation

Meshtasticator (via Docker) simulates the LoRa mesh. Wokwi (in-browser) simulates the ESP32 sensor node. No physical hardware at any stage of this project.

## Key design rule

Stellar keypairs ARE the alert signing identity. `Keypair.signMessage` / `verifyMessage` per SEP-53 — no separate PKI. The same public key that verifies a field alert also disburses funds.

## Testing

Vitest, run from the repo root (`pnpm test`) across `packages/core`, `packages/hub` and `apps/pwa`. `packages/core` is where a bug is most consequential, so it gets the most coverage.

## HARD CONSTRAINTS

- **No Rust, no Soroban.** Stellar Classic only — `MEMO_HASH` for anchoring, claimable balances for payouts.
- **No physical hardware.** Everything simulated (Meshtasticator, Wokwi).
- **Testnet only**, unless explicitly told otherwise.
- **Out of scope:** multi-barangay federation, native mobile app, PAGASA API integration, LGU enrollment workflow.
- **`packages/core` must never import Horizon or RPC.** Field nodes verify signatures fully offline — any network dependency here breaks the threat model.
- **Never add a GPL dependency.** This repo is MIT. The Meshtastic client libraries (`@meshtastic/*`) are GPL-3.0-only — reach for the Python tooling in a separate process instead.
