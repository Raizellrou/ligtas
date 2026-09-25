# @ligtas/pwa

The resident-facing PWA (PRD Section 8 / Stage 3–4). React + Vite + Tailwind v4 against
`@ligtas/core` directly — every alert is decoded and its signature verified in the browser
with the real codec, not a mock of it.

Served two ways: from the hub's own WiFi during a real deployment (no internet on that
network), and hosted on Vercel for this build, where it runs against a captured bundle
instead of a live hub (see "Where the data comes from" below).

## Roles

Three tabs, persisted in `localStorage` (`ligtas.role`):

- **Resident** — the real UI. Shows the evacuation instruction for the resident's own purok,
  or an explicit "your purok is not affected" state — never a blank screen (PRD Section 8).
  Purok selection persists across reloads (`usePersistedPurok.ts`).
- **Tester** — broadcasts a synthetic alert through the same verification path the Resident
  view uses, for demoing the reject cases (forged signature, replayed sequence) without a
  live mesh. Uses a reserved issuer index (255, `apps/pwa/src/lib/simulation.ts`) so it can
  never collide with a real committed demo issuer — see "Two real bugs" in
  `docs/ONBOARDING.md` §6 for why that boundary matters. Also has a "Live mesh demo" panel
  (`src/views/LiveMeshPanel.tsx`) that click-drives the real `packages/mesh-sim` scripts
  through a local hub — see "Talking to a local hub" below.
- **How it works** — static explainer, no live state.

## Talking to a local hub

`VITE_LIGTAS_HUB_URL` (default `http://localhost:3001`) points the Tester tab's "Live mesh
demo" panel at a hub's `/demo/mesh-test/*` routes (`docs/ONBOARDING.md` §4.3,
`packages/hub/README.md`). Those routes only exist on a hub explicitly started with
`LIGTAS_ENABLE_MESH_ORCHESTRATION=1` — on the hosted/Vercel build, or a plain `pnpm dev` with
no hub running, the panel's capabilities check fails to connect and it renders nothing rather
than a broken button.

## Where the data comes from

**Live hub, when there is one.** Where a hub is configured (always in `pnpm dev`; in a
production build only if `VITE_LIGTAS_HUB_URL` is set), `useSimulation.ts` polls the hub's
`GET /alerts` every 15 s while the app is open and visible, and again on reconnect and when the
tab returns to the foreground. A new alert, including a Tier 3 takeover, shows up without a
reload. Once the hub has answered, a later outage keeps the live alerts on screen (it never
swaps them for the recording), and "Alerts checked … ago" turns into a warning after 10 minutes
of silence. The hosted demo has no hub and never polls one.

**Otherwise, the recorded run.** `useSimulation.ts` loads `public/alert-bundle.json` — genuine, forged, and replayed packets
captured from an actual Meshtasticator run via `packages/mesh-sim/bridge_to_hub.py` against a
real running `packages/hub` — and runs every entry through `@ligtas/core`'s real
`decodePacket` / `verifyBody` / `ReplayGuard` in the browser. Anyone with the page open can
flip a byte in devtools and watch verification fail live; nothing about that check is faked
for the hosted build.

## Offline hardening (Stage 4)

- `vite-plugin-pwa` (`generateSW` mode) precaches the app shell and the bundled alert data on
  first visit, so the page still opens with no network.
- `idb` (`src/lib/alertCache.ts`) persists the most recently fetched bundle to IndexedDB, so a
  resident who goes fully offline after first load still sees the last alert their device
  actually received, not a blank screen.
- Verified by killing the serving process after a normal load and reloading — app shell and
  the last-known bundle both still rendered, served from the service-worker cache. **Not**
  verified on a real device in actual airplane mode; see `docs/ONBOARDING.md` §7 for that
  caveat in context.

## Development

```bash
pnpm --filter @ligtas/core build   # @ligtas/pwa depends on it as a workspace package
pnpm --filter @ligtas/pwa dev      # http://localhost:5173
```

```bash
pnpm --filter @ligtas/pwa build    # tsc -b && vite build, output to dist/
pnpm --filter @ligtas/pwa lint     # oxlint
```

One pre-existing lint warning, not new: `src/lib/useSimulation.ts` — `react(use-memo)`,
tracked in `docs/ONBOARDING.md`'s PR checklist rather than fixed, to avoid unrelated churn.

## Deployment

Deployed to Vercel from Charles's account (`.vercel/` is gitignored). Build config lives in
`vercel.json` at the repo root: `pnpm --filter @ligtas/core build && pnpm --filter @ligtas/pwa build`,
output directory `apps/pwa/dist`. See `docs/ONBOARDING.md` Section 4.6 if you need access.
