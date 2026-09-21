import routesJson from '../data/nangka-routes.json'

/**
 * Real, offline map data for one barangay (Nangka, Marikina City), baked from
 * OpenStreetMap by `pnpm --filter @ligtas/pwa map:build` -- see
 * apps/pwa/scripts/build-barangay-map.mjs. Everything here is static data:
 * roads and centers are real, the purok positions are a demo layout, and every
 * purok->center walking route was precomputed on the real road network, so the
 * app does no routing and needs no connection.
 *
 * This small file (centers, purok anchors, walking distances) is imported
 * statically because the emergency takeover needs it instantly. The heavy
 * road geometry lives in nangka-map.json and is loaded on demand by the map.
 */

export interface EvacuationCenter {
  id: string
  name: string
  note?: string
}

export interface MapCenter extends EvacuationCenter {
  /** Short pin label on the map, e.g. "School". */
  short: string
  x: number
  y: number
}

export interface PurokAnchor {
  purok: number
  x: number
  y: number
}

interface RoutesData {
  meta: {
    barangay: string
    source: string
    snapshotDate: string
    viewBox: number[] // [width, height] in SVG units
    layoutNote: string
  }
  centers: { id: string; name: string; short: string; x: number; y: number }[]
  puroks: PurokAnchor[]
  walkMeters: Record<string, Record<string, number>>
}

const data = routesJson as RoutesData

export const MAP_META = data.meta

export const MAP_CENTERS: MapCenter[] = data.centers.map(({ id, name, short, x, y }) => ({ id, name, short, x, y }))

export const EVACUATION_CENTERS: Record<string, EvacuationCenter> = Object.fromEntries(
  MAP_CENTERS.map((c) => [c.id, { id: c.id, name: c.name }]),
)

export const PUROK_ANCHORS: PurokAnchor[] = data.puroks

// The picker offers 1-12 but a purok persisted from an earlier version can be
// any integer up to 32 (usePersistedPurok). This runs on the emergency path,
// so an unmapped purok must degrade to a nearby answer, never throw.
function anchorNumberFor(purok: number): number {
  return purok >= 1 && purok <= PUROK_ANCHORS.length ? purok : ((purok - 1) % PUROK_ANCHORS.length) + 1
}

export function purokAnchorFor(purok: number): PurokAnchor {
  return PUROK_ANCHORS[anchorNumberFor(purok) - 1]
}

/** The purok->center route key used in nangka-map.json. */
export function routeKeyFor(purok: number): string {
  return String(anchorNumberFor(purok))
}

export interface MapGeometry {
  meta: { viewBox: number[] }
  boundary: string
  roads: { major: string; minor: string; path: string }
  water: { areas: string; river: string; stream: string }
  /** SVG path per purok, per center id. */
  routes: Record<string, Record<string, string>>
}

/** Road geometry, split into its own chunk (precached by the service worker) so the home screen stays light. */
export function loadMapGeometry(): Promise<MapGeometry> {
  return import('../data/nangka-map.json').then((m) => m.default as MapGeometry)
}

export interface CenterDistance {
  center: EvacuationCenter
  /** Walking distance along real roads, in metres. */
  meters: number
}

/** Every evacuation center with its walking distance from a purok, nearest first. */
export function centerDistancesFor(purok: number): CenterDistance[] {
  const walk = data.walkMeters[routeKeyFor(purok)]
  return Object.values(EVACUATION_CENTERS)
    .map((center) => ({ center, meters: walk[center.id] }))
    .sort((a, b) => a.meters - b.meters)
}

export function nearestCenterFor(purok: number): CenterDistance {
  return centerDistancesFor(purok)[0]
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`
  const km = meters / 1000
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`
}

// Rough, deliberately conservative walking pace (~80m/min, roughly 4.8km/h)
// so the number stays usable for people who won't be walking briskly during
// an evacuation -- a raw meter count is hard for most people to judge at a
// glance, a minute count isn't.
const METERS_PER_MINUTE = 80

export function formatWalkTime(meters: number): string {
  const minutes = Math.max(1, Math.round(meters / METERS_PER_MINUTE))
  return `~${minutes} min walk`
}
