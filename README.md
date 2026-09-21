# LIGTAS

*LoRa-Integrated Grassroots Typhoon Alert System*

**Flood warnings that work when the internet doesn't — and disaster cash that arrives in days, not weeks.**

Track: Climate Resilience and Hydrometeorological Disaster Management
Stage 1 · Ideation

---

## The problem

The Philippines takes about twenty tropical cyclones a year. When a severe one hits, three things fail at once:

1. **The warning channel dies.** Cell towers and internet go down, so cloud-based early warning becomes unreachable exactly when it is needed. The existing free cell-broadcast system mandated by RA 10639 dies with the towers.
2. **National data isn't local action.** A resident cannot turn "orange rainfall warning over the province" into "leave now, go to the elementary school, avoid the riverside road."
3. **There's no affordable local sensing.** Commercial river gauges are far outside a barangay budget, so most barangays have no real-time water data at all.

There's a fourth problem nobody lists. After every disaster there's a dispute over whether warnings were issued and when — and the records are held by the same parties being questioned about them.

---

## The idea

Put about five cheap, solar-powered LoRa radio boxes around a barangay. One at the river with water sensors, two or three on rooftops as relays, one at the barangay hall.

They talk to each other by radio — kilometres of range, no phone company involved. That's why they survive the storm.

When the river rises past a threshold, the river box announces it, the rooftop boxes repeat it, and it reaches the hall in seconds. There, a horn siren sounds so everyone within earshot knows. The hall box also broadcasts its own WiFi network — connect to it and a page opens showing your purok's specific evacuation instruction. There is no internet on that network; the box serves the page from its own memory.

When connectivity returns, every warning issued gets permanently anchored to Stellar, and pre-funded barangay disaster money is released automatically to affected households.

---

## How it works

1. Water crosses a threshold at the river node.
2. The node builds a compact alert packet — hazard, severity tier, affected puroks, timestamp, sequence number — and **signs it**.
3. Relay nodes verify the signature offline against a cached list of authorised issuers, then rebroadcast. Bad signature or reused sequence number, dropped.
4. The hub fires the siren and updates the page it serves over its own WiFi.
5. Residents see a purok-specific instruction. As a PWA, it caches on their phone and stays readable out of range.
6. The hub queues the alert. When connectivity returns, it anchors the alert hash to Stellar and releases the payout.

---

## What the blockchain does and doesn't do

Worth being exact, because this is where similar projects overclaim.

**It does not deliver warnings.** It can't — there's no internet during the storm. Real-time trust comes from Ed25519 signatures verified on-device, offline, in milliseconds. That's what stops someone with a ₱1,500 radio broadcasting a fake evacuation order.

**It is the receipt book and the payment rail.** Once connectivity returns, every alert hash is anchored to Stellar: a permanent, neutral, timestamped record no party to a later dispute can alter. And it moves the money.

Short version: **the radio saves lives, the signature stops fakes, the chain keeps the receipt and pays out.**

---

## Why Stellar

**Parametric payouts.** The barangay pre-funds a resilience pool. When a verified alert crosses an agreed threshold, a fixed payout releases automatically — no adjuster, no assessment, no paperwork. Reserve Bank of Fiji, UNDP and local insurers already run micro-parametric disaster payouts on this exact logic. The Philippine funding source exists in law: the 5% Local Disaster Risk Reduction and Management Fund under RA 10121.

**72-hour cash instead of six-week cash.**

**Stellar keypairs are the alert identity.** Stellar accounts *are* Ed25519 keypairs, and the SDK signs arbitrary messages per SEP-53. So the barangay captain's Stellar account is also the key that signs radio alerts — the same public key verifies the packet and disburses the funds. One identity, no separate PKI. The SDK even ships an offline-only subpath so field nodes can verify signatures with no network at all.

**And practically:** sub-five-second settlement, fees at a fraction of a cent, native primitives (`MEMO_HASH`, claimable balances, multisig) that do this without a smart contract, and a real Philippine off-ramp ecosystem so a payout is actually spendable locally.

---

## Who gets the money

The chain knows nothing about houses. All the knowing happens *before* the disaster.

Households are registered ahead of time: household ID, purok, Stellar address. The alert carries a purok bitmap — "puroks 3 and 4, tier 3", four bytes, no names. After reconnection the hub filters the registry to matching puroks and creates one claimable balance per account.

**The registry already exists.** Barangays maintain the legally mandated Record of Barangay Inhabitants, and DSWD's Listahanan and 4Ps lists cover the same population for cash transfers. This adds one column, not a new database.

No names or addresses go on chain — only account addresses. Stellar is a public ledger.

---

## Cost

About **₱20,000 per barangay** — roughly five nodes at ~₱4,000 each (LoRa board, sensors, solar panel, battery, enclosure, siren).

Not one radio per household. At 200+ households that would be ₱300,000 and would never be funded. The radio carries the warning kilometres *across* the barangay; the siren and hub WiFi cover the last 50 metres.

Development this September costs **₱0** — the mesh runs in Meshtastic's own simulator, which executes the real device firmware with a simulated radio, and the sensor node runs in Wokwi in-browser.

---

## Known limitations

Named deliberately rather than discovered later.

- **Simulation can't validate RF range.** Protocol, routing, signature verification and settlement are genuinely proven; propagation through real terrain is not. Field validation is the next milestone, budgeted at ₱4,300 for a two-node pilot.
- **WiFi reaches 50–100 m, LoRa reaches kilometres.** One hub covers one cluster of houses, so a spread-out barangay needs three or four hubs. Still cheap, but real.
- **Parametric means imprecise by design.** Payout is by location and threshold, not verified damage. Some households get money who weren't badly hit; the worst-hit get the same flat amount. That's the accepted trade — speed bought with precision.
- **Wallet onboarding is unsolved at scale.** For now, payouts route to a barangay relief account under multisig rather than to 200 individual households.
- **Regulatory.** 433 MHz and 868 MHz are not licence-free in the Philippines. This uses 915–918 MHz (AS923-3) under NTC MC 03-05-2007 as amended.
- **The evacuation map is a demo snapshot.** Roads, waterways and the barangay outline of Nangka, Marikina City are real, © OpenStreetMap contributors (ODbL), baked into the app so the map works with no connection; regenerate with `pnpm --filter @ligtas/pwa map:build`. The purok positions are a generated demo layout and the evacuation centers are places OpenStreetMap names, not LGU-confirmed. From Alert Tier 2 up, routes avoid streets near rivers, streams and canals — a demo stand-in derived from OpenStreetMap, not a flood survey, so it is not live conditions. A resident can also show their own position on the map (phone GPS works offline; the location never leaves the phone). Streets closed by the barangay in real time, sent as signed messages over the same LoRa channel, are future work.

---

## Scope for this hackathon

**Version 0 (Forge).** Signed alert packet format with replay protection · multi-hop propagation with node-failure rerouting, in simulation · simulated sensor and siren. Mesh and signature verification only — no PWA, no Stellar.

**Version 1 (Refine).** Offline PWA with purok-level evacuation instructions · store-and-forward queue · alert anchoring on Stellar.

**MVP (Launch).** Claimable-balance payout flow, plus the full end-to-end scenario below.

**Definition of done:** trip the sensor, watch a signed warning hop five nodes with the internet off, see a phone show the right route for the right purok, reject a forged copy of that same alert, then restore connectivity and watch the record and payout land on Stellar.

---

## Team

Juniene Gwyneth M. Basilio

Charles Erick S. Ramos
