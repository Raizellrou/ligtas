import { useEffect, useMemo, useState } from 'react'
import {
  EVACUATION_CENTERS,
  MAP_CENTERS,
  MAP_META,
  centerDistancesFor,
  routeKeyFor,
  type CenterDistance,
  type EvacuationCenter,
} from './evacuationCenters'
import { latLonToUnits, withinMap } from './geo'
import { loadGraph } from './roadGraph'
import {
  blockedSegments,
  centerFields,
  pointsToPath,
  routeFrom,
  segmentsToPath,
  snapToNetwork,
  type Field,
  type Graph,
} from './routing'
import type { LivePosition } from './useLiveLocation'

export interface RankedCenter {
  center: EvacuationCenter
  /** Walking metres, or null when flooding cuts this center off. */
  meters: number | null
}

export type RouteMode = 'baseline' | 'flood-aware' | 'from-you'

export interface EvacuationRoute {
  /** Reachable centers nearest first, then any that flooding cuts off. */
  ranked: RankedCenter[]
  nearest: CenterDistance
  /** SVG path to the nearest center, or null until the road graph loads (the map then draws its precomputed route). */
  routeD: string | null
  /** SVG path of the streets treated as flooded right now, or null. */
  blockedD: string | null
  /** The alert severity flooding was applied at: 0 (none), 2 or 3. */
  blockingTier: number
  mode: RouteMode
  /** No flood-free route from here reaches any center; the route shown ignores the flooding. */
  allFlooded: boolean
  /** A GPS fix exists but is off the mapped area, so the route starts from the purok instead. */
  outsideMap: boolean
  /** Extra walking metres caused by avoiding flooded streets, if meaningful. */
  detourMeters: number | null
  /** The resident's own spot on the map, for the dot. */
  you: { x: number; y: number; accuracyUnits: number } | null
}

// A fix farther than this from any mapped road is treated as off the map.
const MAX_SNAP_M = 150
const MIN_DETOUR_M = 30

const round10 = (m: number) => Math.max(10, Math.round(m / 10) * 10)

/**
 * The one answer for "where do I go and how": the takeover, the map header,
 * the alert card and the map all read this, so they cannot disagree.
 *
 * It answers immediately from the static purok data, then upgrades once the
 * road graph has loaded: routing from the resident's GPS fix if there is one,
 * and around any streets flooded at the current alert severity.
 */
export function useEvacuationRoute({
  purok,
  severity,
  position,
}: {
  purok: number
  severity: number
  position: LivePosition | null
}): EvacuationRoute {
  const [graph, setGraph] = useState<Graph | null>(null)
  useEffect(() => {
    let live = true
    loadGraph()
      .then((g) => {
        if (live) setGraph(g)
      })
      .catch(() => {
        // Keep the static answer; a later mount retries the load.
      })
    return () => {
      live = false
    }
  }, [])

  // Tier 1 and "no alert" block nothing: flood-prone streets start at Tier 2.
  const blockingTier = severity >= 2 ? severity : 0

  const fields = useMemo(() => {
    if (graph === null) return null
    return {
      open: centerFields(graph, 0),
      blocked: blockingTier === 0 ? null : centerFields(graph, blockingTier),
    }
  }, [graph, blockingTier])

  const blockedD = useMemo(
    () => (graph === null || blockingTier === 0 ? null : segmentsToPath(blockedSegments(graph, blockingTier))),
    [graph, blockingTier],
  )

  const lat = position?.lat
  const lon = position?.lon
  const accuracy = position?.accuracy
  const located = useMemo(() => {
    if (lat === undefined || lon === undefined || accuracy === undefined) return null
    const { x, y } = latLonToUnits(lat, lon, MAP_META.projection)
    return { x, y, accuracyUnits: accuracy / MAP_META.projection.mpu, onMap: withinMap(x, y, MAP_META.viewBox, 10) }
  }, [lat, lon, accuracy])
  const you = useMemo(
    () => (located?.onMap ? { x: located.x, y: located.y, accuracyUnits: located.accuracyUnits } : null),
    [located],
  )

  // Where the route starts. On the mapped roads, the resident's spot: they can
  // leave the street they are on by either end, so both are candidates.
  // Otherwise their purok's anchor.
  const start = useMemo(() => {
    if (graph === null) return null
    if (you !== null) {
      const snap = snapToNetwork(graph, you.x, you.y)
      if (snap.snapM <= MAX_SNAP_M) {
        return {
          fromYou: true,
          // The route is drawn from the dot, then along the street to the end it leaves by.
          lead: [you.x, you.y, snap.x, snap.y] as number[],
          candidates: [
            { node: snap.a, extraM: snap.snapM + snap.alongA },
            { node: snap.b, extraM: snap.snapM + snap.alongB },
          ],
        }
      }
    }
    return {
      fromYou: false,
      lead: [] as number[],
      candidates: [{ node: graph.data.anchors[Number(routeKeyFor(purok)) - 1], extraM: 0 }],
    }
  }, [graph, you, purok])
  const fromYou = start?.fromYou ?? false

  const routed = useMemo(() => {
    if (graph === null || fields === null || start === null) return null

    // Per center: the shortest walk over the start candidates, and which one wins.
    const measure = (fs: Record<string, Field>) =>
      MAP_CENTERS.map((c) => {
        let best: { m: number; node: number } | null = null
        for (const cand of start.candidates) {
          const d = fs[c.id].dist[cand.node]
          if (!Number.isFinite(d)) continue
          const m = d + cand.extraM + graph.data.centers[c.id].snapM
          if (best === null || m < best.m) best = { m, node: cand.node }
        }
        return { id: c.id, center: EVACUATION_CENTERS[c.id], m: best?.m ?? null, node: best?.node ?? -1 }
      })

    const open = measure(fields.open)
    const applied = fields.blocked === null ? open : measure(fields.blocked)
    const allFlooded = applied.every((o) => o.m === null)
    // With every way flooded, fall back to the ordinary route rather than show nothing.
    const list = allFlooded ? open : applied
    const usedFields = allFlooded || fields.blocked === null ? fields.open : fields.blocked

    const byDistance = (a: { m: number | null }, b: { m: number | null }) => (a.m ?? Infinity) - (b.m ?? Infinity)
    const first = [...list].sort(byDistance)[0]
    // Not even the ordinary network reaches a center from here: keep the static answer.
    if (first.m === null) return null

    const ranked: RankedCenter[] = [...list]
      .sort(byDistance)
      .map((o) => ({ center: o.center, meters: o.m === null ? null : round10(o.m) }))
    const path = routeFrom(graph, usedFields[first.id], first.node)
    const pin = MAP_CENTERS.find((c) => c.id === first.id)!
    const lead: [number, number][] = []
    for (let i = 0; i < start.lead.length; i += 2) lead.push([start.lead[i], start.lead[i + 1]])
    const routeD = path === null ? null : pointsToPath([...lead, ...path.points, [pin.x, pin.y]])

    const bestOpen = [...open].sort(byDistance)[0]
    const detour = !allFlooded && fields.blocked !== null && bestOpen.m !== null ? first.m - bestOpen.m : 0

    return { ranked, routeD, allFlooded, detourMeters: detour >= MIN_DETOUR_M ? round10(detour) : null }
  }, [graph, fields, start])

  if (routed === null) {
    const baseline = centerDistancesFor(purok)
    return {
      ranked: baseline.map(({ center, meters }) => ({ center, meters })),
      nearest: baseline[0],
      routeD: null,
      blockedD: null,
      blockingTier: 0,
      mode: 'baseline',
      allFlooded: false,
      outsideMap: located !== null && !located.onMap,
      detourMeters: null,
      you,
    }
  }

  const nearestRanked = routed.ranked[0]
  return {
    ranked: routed.ranked,
    nearest: { center: nearestRanked.center, meters: nearestRanked.meters! },
    routeD: routed.routeD,
    blockedD,
    blockingTier,
    mode: fromYou ? 'from-you' : blockingTier > 0 ? 'flood-aware' : 'baseline',
    allFlooded: routed.allFlooded,
    outsideMap: located !== null && !located.onMap,
    detourMeters: routed.detourMeters,
    you,
  }
}
