# apps/sensor-wokwi

The L1 sensor node (PRD Section 5.1/9) — ESP32, Arduino C++, simulated entirely in
[Wokwi](https://wokwi.com). No physical hardware anywhere (CLAUDE.md hard constraint).
This is Stage 3's "designated first cut": nothing else in the build depends on it —
`packages/mesh-sim` already owns the real signed-packet-crosses-the-mesh proof — so
this piece is decoupled and safe to drop without ceremony if time runs short. See
`docs/BUILD-PLAN.md` Section 3.

## What it does

A potentiometer stands in for a river gauge. The sketch reads it, debounces the
reading against three severity thresholds so a fluctuating value doesn't emit a
burst of alerts (PRD Section 5.1), and on a confirmed tier change builds and signs
a real 84-byte LIGTAS alert packet — byte-for-byte the same wire format
`packages/core` encodes and `packages/hub`/`apps/pwa` verify. The packet is printed
to Serial as hex, LED lights while a tier is active. This sketch does not attempt to
also simulate a LoRa radio: `packages/mesh-sim` (real Meshtasticator, Track A) already
owns the mesh-propagation proof, and faking a second radio path here would only blur
which proof is actually being demonstrated.

## Why this is real signing, not a placeholder

Stellar's `Keypair.signMessage` (SEP-53, used by `packages/core/src/sign.ts`) is:

```
signature = Ed25519_sign(seed, SHA256("Stellar Signed Message:\n" + body))
```

On the ESP32 this sketch does the same two steps for real:

1. **SHA-256** via ESP32's built-in `mbedtls` (already part of the Arduino-ESP32
   core — no extra library).
2. **Ed25519** via [Monocypher](https://monocypher.org) 4.0.3's `monocypher-ed25519`
   module — real RFC 8032 Ed25519 with SHA-512, *not* Monocypher's default EdDSA
   variant (which uses BLAKE2b and would produce a different, non-Stellar-compatible
   signature — see the comment in `sensor-wokwi.ino` and the "Verified" section
   below for why the extra module matters).

The result is a signature `packages/core`'s `verifyBody` — the same function the hub
and PWA call — actually accepts. `packages/hub/config/issuers.json` needs this
sketch's public key added (with its own `issuerIndex`) before a real hub would accept
its packets; out of the box this is a standalone artifact, per the "nothing depends
on it" framing above.

## Verified, and how to reproduce it

Neither `arduino-cli` nor a live Wokwi run is available in every environment, so
this was checked in a throwaway `gcc` Docker container during development, cross-checked
against a real `@stellar/stellar-sdk` signature:

1. Generated a random Stellar keypair and a 20-byte body via `packages/core`'s
   `encodeBody`.
2. Computed `SHA256("Stellar Signed Message:\n" + body)` — matched `openssl dgst
   -sha256` byte-for-byte.
3. Called Monocypher's `crypto_ed25519_key_pair` + `crypto_ed25519_sign` (the exact
   functions this sketch calls) on that seed and hash, compiled with `gcc` — the
   resulting signature and derived public key matched `Keypair.signMessage` /
   `rawPublicKey()` **exactly**, byte-for-byte.

The sketch itself compiles clean (`arduino-cli compile --fqbn esp32:esp32:esp32`,
zero errors, zero warnings with `--warnings all`) against the real Arduino-ESP32 core
3.3.11.

**Wokwi runtime — since verified.** Opened this exact project in a live wokwi.com
session (anonymous, no `arduino-cli`/`wokwi-cli` needed): compiled clean on Wokwi's
own build server, booted, connected to `Wokwi-GUEST`, and the LED reacted correctly
to the potentiometer's default position (river level already above tier 1). This run
caught one real bug the throwaway-container check above could never have caught:
`diagram.json` used `"wokwi-potentiometer-rotary"` as the part type, which is not a
registered Wokwi part — the correct id is `"wokwi-potentiometer"`. Fixed here. This
is exactly why the gap below was worth closing rather than waiving: a `diagram.json`
typo compiles fine and only ever shows up at Wokwi-runtime.

What's still **not** verified in this pass: full Serial output text (the packet hex,
tier-change logging) was never captured — this session's anonymous Wokwi project had
no Serial Monitor panel available (likely gated behind sign-in), so the sketch's
correctness beyond "it boots and the LED responds to GPIO34" is unconfirmed by this
run. A signed-in session or the Wokwi VS Code extension would close that remainder.

To reproduce the cross-check yourself:

```bash
# 1. From packages/core, generate a test vector (seed, body, expected signature)
#    using @stellar/stellar-sdk directly — see git history for the exact script
#    used during development if you want the precise commands.
# 2. Compile a tiny C program linking monocypher.c + monocypher-ed25519.c that
#    calls crypto_ed25519_key_pair() then crypto_ed25519_sign() on that seed/body.
# 3. Compare its output to the expected signature.
```

## Wire format

Must match `packages/core/src/codec.ts` exactly — this file can't import that one
(different language), so keep both in sync by hand:

| Bytes | Field | Type |
|---|---|---|
| 0 | version | u8 |
| 1 | hazard | u8 |
| 2 | severity | u8 |
| 3 | issuerIndex | u8 |
| 4–7 | purokBitmap | u32 BE |
| 8–11 | issuedAt | u32 BE, unix seconds |
| 12–15 | sequence | u32 BE |
| 16–17 | waterLevelCm | u16 BE |
| 18–19 | reserved | 0 |
| 20–83 | signature | 64-byte Ed25519 |

## Thresholds

| Water level | Tier |
|---|---|
| < 150 cm | none |
| 150–199 cm | 1 |
| 200–249 cm | 2 |
| ≥ 250 cm | 3 |

A reading must hold for 3 seconds (`DEBOUNCE_MS`) before a tier change is treated as
real and a packet is emitted — see PRD Section 5.1's debounce requirement.

## Wiring (diagram.json)

| ESP32 pin | Part | Purpose |
|---|---|---|
| D34 (ADC1_CH6, input-only) | Potentiometer SIG | Simulated river level, 0–4095 → 0–400 cm |
| 3V3 / GND | Potentiometer VCC / GND | Power |
| D25 → 220Ω resistor → LED anode | LED | Lit while any tier is active |
| GND | LED cathode | — |

## Known limitations (out of scope for this simulated cut)

- **Sequence is RAM-only.** A real field node must persist `nextSequence` in NVS —
  a reboot resetting it to 1 would reopen the replay window
  (`packages/core/src/replay.ts` is the sole replay defence). A Wokwi restart is a
  demo restart, not a field power-cycle, so this is left as a documented gap, not
  fixed here.
- **No cancellation packet.** When the river recedes below tier 1 the sketch logs it
  and clears the LED, but does not emit a packet — the wire format has no
  "all clear" semantics defined anywhere else in this repo either.
- **`issuedAt` is best-effort.** Real NTP when Wokwi's simulated network is up,
  otherwise a placeholder clock. Fine either way: PRD Section 5.4 says no verifier in
  this repo ever trusts `issuedAt` for ordering — sequence is the only replay
  defence — so a wrong wall-clock value can't cause an alert to be wrongly accepted
  or rejected. It only affects the cosmetic timestamp shown in Serial output.
- **The demo keypair is hardcoded** in `sensor-wokwi.ino` (`DEMO_SEED`) — Testnet
  only, never a real secret, and intentionally a different keypair than
  `packages/hub`'s own demo issuer (this sketch is standalone). Regenerate with
  `node packages/core/scripts/emit-alert.js --sequence 1` and take
  `expectedIssuerSecret`'s raw seed bytes.
