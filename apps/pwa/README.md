# @ligtas/pwa

The resident-facing PWA (PRD Section 8 / Stage 3–4). React + Vite + Tailwind v4 against
`@ligtas/core` directly — every alert is decoded and its signature verified in the browser
with the real codec, not a mock of it.

Served two ways: from the hub's own WiFi during a real deployment (no internet on that
network), and hosted on Vercel for this build, where it runs against a captured bundle
instead of a live hub (see "Where the data comes from" below).

## Roles

Three tabs, persisted in `localStorage` (`ligtas.role`):

- **Resident** — the real UI. Shows the alert for the resident's own purok (or an explicit
  "your purok is not affected" state, never a blank screen — PRD Section 8), the nearest
  evacuation center on an offline map, and an optional household check-in. Purok selection
  persists across reloads (`usePersistedPurok.ts`). See "Resident experience" and
  "Evacuation map and routing" below.
- **Tester** — broadcasts a synthetic alert through the same verification path the Resident
  view uses, for demoing the reject cases (forged signature, replayed sequence) without a
  live mesh. Uses a reserved issuer index (255, `apps/pwa/src/lib/simulation.ts`) so it can
  never collide with a real committed demo issuer — see "Two real bugs" in
  `docs/ONBOARDING.md` §6 for why that boundary matters. Also has a "Live mesh demo" panel
  (`src/views/LiveMeshPanel.tsx`) that click-drives the real `packages/mesh-sim` scripts
  through a local hub, and a walk simulator that stands in for the phone's GPS — see
  "Talking to a local hub" and "Evacuation map and routing" below.
- **How it works** — static explainer, no live state.

## Resident experience

**Alert tiers.** A severity maps to one of three levels (`alertLevel` in
`src/lib/instructions.ts`), and the level decides how loud the screen is:

| Tier | Level | What the resident sees |
|---|---|---|
| 1 | watch | a quiet note on the home screen |
| 2 | prepare | a marigold card on the home screen |
| 3 | evacuate | a full-screen takeover naming the nearest center and the way there |

Only Tier 3 interrupts. The newest accepted alert for the resident's purok wins, so a later
lower-tier alert reads as de-escalation (`latestRelevantAlert` in `src/lib/evaluateBundle.ts`).

**The Tier 3 takeover** (`src/views/EmergencyNotice.tsx`) is a real modal: it renders outside
`#root`, and `#root` is made `inert` while it is up, so keyboard focus and screen readers
cannot reach the page behind it. It cannot be dismissed with Escape; the resident leaves it
with "Show my route", which is remembered per alert (a hash, in `sessionStorage`) so the same
alert does not return. A phone opened cold during an evacuation skips the splash and lands on
it, whichever tab was saved — one rule, `activeEvacuation` in `src/lib/activeEvacuation.ts`,
shared by `App` and `ResidentView` so they cannot disagree. Tester tab users are left where
they are.

**Vibration, not sound.** The takeover vibrates once (`src/lib/alertFeedback.ts`). It makes no
sound: browsers block autoplay audio. Limits, all unverified on a real phone: Chrome only lets
a page vibrate after the user has tapped it, and iPhone browsers do not support vibration
at all.

**Household check-in is optional.** Alerts and the map need only a purok, so a resident can skip
joining. Joining (a join code, then a name) unlocks "I'm safe" / "I need help" and the family's
statuses. A tap is written to IndexedDB on the phone first and sent to the hub when it can be
(`src/lib/checkinQueue.ts`), so it survives a reload or a dropped connection. While a household
has a live alert against it, a relief pill reads the household's claimable balance straight from
Stellar Testnet.

**How old is this?** (`src/lib/freshness.ts`.) An offline phone can show hours-old information, so
the app says how old each claim is:

- an alert shows when it was issued ("Issued 25 min ago · 3:42 PM"), and after 12 h adds
  "this alert is old" (`ALERT_OLD_AFTER_S`). The time is the alert's signed `issuedAt`, shown
  only; it is never used to accept, reject or order an alert (PRD 5.4);
- the alert list shows when this phone last got it ("Alerts checked 4 min ago"). After 3 h
  (`CHECK_STALE_AFTER_S`), or 10 min when the feed is a live hub (`CHECK_STALE_LIVE_AFTER_S`),
  it becomes a warning that the phone may have missed newer alerts, so "not affected" is never
  shown bare from a phone that is out of touch;
- each household member shows how long ago the hub recorded their status. That is when the hub
  heard it, not when the person tapped: a check-in made offline reaches the hub later;
- a timestamp ahead of the phone's clock shows only the clock time, never an invented age.

**Readability.** Text colours are tuned to WCAG AA on the backgrounds they sit on, primary
buttons use dark ink on the marigold accent, and `test/contrast.test.ts` reads the tokens out of
`src/index.css` and fails if a change breaks that (or puts white text on the marigold fill).
Colour-blindness and the phone's larger-text setting have not been tested.

## Evacuation map and routing

The map is a **one-time snapshot of a real barangay, Nangka in Marikina City, baked into the
app**, so it draws with no connection.

- Three committed files in `src/data/`: `nangka-map.json` (geometry to draw), `nangka-graph.json`
  (the walking road network) and `nangka-routes.json` (centers, purok anchors, projection).
  The two big ones load as separate chunks and are precached by the service worker.
- `pnpm --filter @ligtas/pwa map:build` regenerates them from OpenStreetMap through the
  Overpass API (`scripts/build-barangay-map.mjs`, configured by `scripts/nangka.config.json`).
  It needs a network, caches queries in the OS temp directory, and retries across mirrors. It
  is not part of `pnpm build`, so normal builds never touch the network.
- **What is real and what is not.** Roads, waterways, the barangay outline and the names and
  places of the evacuation centers are OpenStreetMap data. The **12 purok positions are a
  generated demo layout** (OpenStreetMap has no purok boundaries), the centers are places
  OpenStreetMap names and are **not confirmed by the LGU**, and the map says "Demo layout, not
  official". The map data is © OpenStreetMap contributors under the ODbL; see
  `src/data/DATA-LICENCE.md`.

**Routing** runs in the browser (`src/lib/routing.ts`, `roadGraph.ts`, `useEvacuationRoute.ts`):
one Dijkstra distance field per center per alert severity, so a route from anywhere is a walk
back along the chain. Walking time is real distance at walking pace. One hook answers for every
surface (takeover, alert card, map header, pill), so they cannot disagree.

**Flood model — a demo stand-in, not a survey.** Each street segment gets a flood tier from how
close it is to a river, stream, canal or water body in OpenStreetMap: within 20 m it floods from
Alert Tier 2, within 50 m only at Tier 3, and bridges never (`floodDistanceMeters` in the
config). A street is avoided when its tier is at or below the alert's severity, so Tier 1 and
"no alert" avoid nothing. If every route from where the resident is looks flooded, the app says
so, still shows the ordinary route as a warning, and tells them to follow barangay officials.
The screen says this is not live conditions. Closing streets in real time (for example signed
messages over the same LoRa channel) is future work.

**Live location** (`src/lib/useLiveLocation.ts`). A resident can show their own position: the
browser's geolocation works with no connection, needs HTTPS (or `localhost`) and the resident's
permission, which is asked only when they tap. The location is used on the phone to reroute and
is never sent anywhere. The Tester tab has a walk simulator that feeds the same pipeline a fake
position walking from the resident's purok to the nearest center, and lets the tester raise the
river mid-walk to watch the route change. Real GPS has not been tested on a device.

## Talking to a local hub

`VITE_LIGTAS_HUB_URL` (default `http://localhost:3001`, `src/lib/hubUrl.ts`) points the app at a
hub. Three things use it:

- **Alert polling** (below);
- the **household routes** (`/household/*`: join, status, check-in — `packages/hub/README.md`);
- the Tester tab's "Live mesh demo" panel, which calls `/demo/mesh-test/*`
  (`docs/ONBOARDING.md` §4.3). Those routes only exist on a hub started with
  `LIGTAS_ENABLE_MESH_ORCHESTRATION=1`; without that, or on the hosted build, the panel's
  capabilities check fails and it renders nothing rather than a broken button.

`HUB_CONFIGURED` is true in `pnpm dev`, and in a production build only when
`VITE_LIGTAS_HUB_URL` was set. Background polling is gated on it: the hosted demo has no hub, and
the localhost default would make every visitor's browser poll a private address.

**Troubleshooting: "Can't reach the hub right now".** The hub is not running, or the page's origin
is not the one the hub allows. The hub only lets `LIGTAS_PWA_ORIGIN` (default
`http://localhost:5173`) read its responses, so the app must be served from exactly that origin,
for example not from `localhost:4173` (the production preview).

## Where the data comes from

**Live hub, when there is one.** Where a hub is configured, `useSimulation.ts` polls the hub's
`GET /alerts` every 15 s (`ALERT_POLL_MS` in `src/lib/alertFeed.ts`, 4 s timeout) while the app is
open and visible, and again on reconnect and when the tab returns to the foreground. A new alert,
including a Tier 3 takeover, shows up without a reload. Once the hub has answered, a later outage
keeps the live alerts on screen — the app never swaps them for the recording — and "Alerts checked
… ago" turns into a warning after 10 minutes of silence. If the hub was down at load, the recording
shows and the app switches to live when the hub appears. The hosted demo has no hub and never
polls one. There is no push: a phone hears from the hub only while the app is open.

**Otherwise, the recorded run.** `useSimulation.ts` loads `public/alert-bundle.json` — genuine, forged, and replayed packets
captured from an actual Meshtasticator run via `packages/mesh-sim/bridge_to_hub.py` against a
real running `packages/hub` — and runs every entry through `@ligtas/core`'s real
`decodePacket` / `verifyBody` / `ReplayGuard` in the browser. Anyone with the page open can
flip a byte in devtools and watch verification fail live; nothing about that check is faked
for the hosted build. That recording is from 12 Sep 2026, so on the hosted demo its alerts
correctly read as days old.

Either way the app verifies every packet itself; the hub is not trusted to have filtered anything.

## Offline hardening (Stage 4)

- `vite-plugin-pwa` (`generateSW` mode) precaches the app shell, the map chunks and the bundled
  alert data on first visit, so the page still opens with no network.
- `idb` (`src/lib/alertCache.ts`) persists the most recently fetched bundle, with the time this
  phone fetched it (`{ bundle, fetchedAt }`), to IndexedDB, so a resident who goes fully offline
  after first load still sees the last alert their device actually received, not a blank screen,
  and how old it is. An entry written by an older build (a bare bundle) still loads.
- The alert fetch adds a `?t=` query string on purpose. The service worker precaches
  `alert-bundle.json`, so a bare fetch "succeeds" from that cache with no network at all and an
  offline phone would claim it had just updated. A URL the service worker does not know goes to
  the real network and fails when there is none, which is what sends the app to the stored copy
  and shows the offline banner.
- Verified by killing the serving process after a normal load and reloading — app shell and
  the last-known bundle both still rendered, served from the service-worker cache — and by
  reconnecting and watching the banner clear. **Not** verified on a real device in actual
  airplane mode; see `docs/ONBOARDING.md` §7 for that caveat in context.

## Development

```bash
pnpm --filter @ligtas/core build   # @ligtas/pwa depends on it as a workspace package
pnpm --filter @ligtas/pwa dev      # http://localhost:5173
```

```bash
pnpm --filter @ligtas/pwa build    # tsc -b && vite build, output to dist/
pnpm --filter @ligtas/pwa lint     # oxlint
pnpm test                          # from the repo root: core, hub and pwa tests together
```

To try the live feed, run a hub (`packages/hub/README.md`) and post a signed alert to it with
`packages/core/scripts/emit-alert.ts`; the open app picks it up within about 15 s.

Three lint warnings are pre-existing and tracked rather than fixed, to avoid unrelated churn:
`react(set-state-in-effect)` in `src/lib/useReliefBalance.ts` and `src/lib/useHouseholdCheckin.ts`,
and `react(use-memo)` in `src/lib/useSimulation.ts`.

## Deployment

Deployed to Vercel from Charles's account (`.vercel/` is gitignored). Build config lives in
`vercel.json` at the repo root: `pnpm --filter @ligtas/core build && pnpm --filter @ligtas/pwa build`,
output directory `apps/pwa/dist`. See `docs/ONBOARDING.md` Section 4.6 if you need access.
