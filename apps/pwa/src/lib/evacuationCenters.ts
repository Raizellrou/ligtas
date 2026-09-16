export interface EvacuationCenter {
  id: string
  name: string
  note?: string
}

export const EVACUATION_CENTERS: Record<string, EvacuationCenter> = {
  'center-a': { id: 'center-a', name: 'Barangay Elementary School', note: 'Covered court, 2nd floor assembly area' },
  'center-b': { id: 'center-b', name: 'Barangay Multi-Purpose Hall' },
  'center-c': { id: 'center-c', name: 'Covered Basketball Court' },
}

// Map geometry -- shared between EvacuationMap's rendering and the distance
// math below, so "which center is nearest" and "what's actually drawn" can
// never drift apart the way a separately hand-maintained purok->center
// table did (a purok's nearest center changed once the pins were scattered
// to different corners instead of stacked in one column).
export const MAP_GRID = { cols: 4, rows: 3, zoneW: 80, zoneH: 70, originX: 40, originY: 30 }

export function purokZoneCenter(purok: number): { x: number; y: number } {
  const i = purok - 1
  const col = i % MAP_GRID.cols
  const row = Math.floor(i / MAP_GRID.cols)
  return {
    x: MAP_GRID.originX + col * MAP_GRID.zoneW + MAP_GRID.zoneW / 2,
    y: MAP_GRID.originY + row * MAP_GRID.zoneH + MAP_GRID.zoneH / 2,
  }
}

// Hand-placed: only 3 of these, real (if fictional) buildings that don't
// follow the purok grid, so a formula isn't worth inventing. Scattered to
// different corners/edges rather than stacked in one column -- a straight
// line of pins reads as a legend, not a map.
export const CENTER_POSITIONS: Record<string, { x: number; y: number; labelAnchor: 'start' | 'middle' | 'end' }> = {
  'center-a': { x: 18, y: 18, labelAnchor: 'start' },
  'center-b': { x: 388, y: MAP_GRID.originY + MAP_GRID.zoneH * 1.5, labelAnchor: 'end' },
  'center-c': { x: 18, y: MAP_GRID.originY + MAP_GRID.zoneH * MAP_GRID.rows - 6, labelAnchor: 'start' },
}

/**
 * A routed path from a purok to a center, instead of a straight line -- a
 * straight line between two arbitrary points on this grid visibly cuts
 * across whichever purok tiles happen to sit between them, which reads as
 * "walk through your neighbor's block." Routes out of the purok's own tile
 * through the empty gap at its row boundary (12 units wide, centered on the
 * boundary -- clear for every column, not just this one), across to the
 * center's column, then straight into the center -- all three center pins
 * sit outside the grid's own column range (x=18 or x=388 vs. the grid's
 * [40,360]), so that final leg is always in open margin, never over a tile.
 */
export function connectorPathFor(purok: number, centerId: string): string {
  const zone = purokZoneCenter(purok)
  const pin = CENTER_POSITIONS[centerId]
  const row = Math.floor((purok - 1) / MAP_GRID.cols)
  const bendY = pin.y < zone.y ? MAP_GRID.originY + row * MAP_GRID.zoneH : MAP_GRID.originY + (row + 1) * MAP_GRID.zoneH
  return `M ${zone.x} ${zone.y} L ${zone.x} ${bendY} L ${pin.x} ${bendY} L ${pin.x} ${pin.y}`
}

// The map's SVG units aren't real-world units -- there's no actual
// geography anywhere in this repo (see instructions.ts). This picks a
// plausible barangay scale (the ~400-unit-wide canvas standing in for
// roughly a 1.2km span) purely so residents see a usable, varying number
// rather than nothing.
const METERS_PER_UNIT = 3

export interface CenterDistance {
  center: EvacuationCenter
  meters: number
}

/** Every evacuation center with its straight-line distance from a purok, nearest first. */
export function centerDistancesFor(purok: number): CenterDistance[] {
  const zone = purokZoneCenter(purok)
  return Object.values(EVACUATION_CENTERS)
    .map((center) => {
      const pos = CENTER_POSITIONS[center.id]
      const units = Math.hypot(zone.x - pos.x, zone.y - pos.y)
      return { center, meters: Math.round((units * METERS_PER_UNIT) / 10) * 10 }
    })
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
