import { MAP_CENTERS, MAP_META, routeKeyFor } from './evacuationCenters'
import { buildGraph, centerFields, routeFrom, type Graph, type GraphData } from './routing'

let graphPromise: Promise<Graph> | null = null

/**
 * The road network, loaded on demand as its own chunk (the service worker
 * precaches it, so this works offline). Cached for the session; a failed load
 * is retried on the next call instead of being remembered.
 */
export function loadGraph(): Promise<Graph> {
  graphPromise ??= import('../data/nangka-graph.json').then((m) =>
    buildGraph(m.default as unknown as GraphData, MAP_META.projection.mpu),
  )
  graphPromise.catch(() => {
    graphPromise = null
  })
  return graphPromise
}

/**
 * The walk a resident would take from their purok to the nearest evacuation
 * center at an alert severity (streets flooded at that severity are avoided;
 * 0 means nothing is flooded), as map points ending on the center's pin. The
 * walk simulator follows this. If flooding cuts every center off, it walks
 * the ordinary route, as the map does.
 */
export async function planWalkPath(purok: number, severity: number): Promise<[number, number][] | null> {
  const graph = await loadGraph()
  const start = graph.data.anchors[Number(routeKeyFor(purok)) - 1]
  const blockingTier = severity >= 2 ? severity : 0
  let fields = centerFields(graph, blockingTier)
  if (!Object.keys(fields).some((id) => Number.isFinite(fields[id].dist[start]))) fields = centerFields(graph, 0)
  let best: { id: string; meters: number } | null = null
  for (const id of Object.keys(graph.data.centers)) {
    const meters = fields[id].dist[start] + graph.data.centers[id].snapM
    if (Number.isFinite(meters) && (best === null || meters < best.meters)) best = { id, meters }
  }
  if (best === null) return null
  const route = routeFrom(graph, fields[best.id], start)
  const pin = MAP_CENTERS.find((c) => c.id === best.id)
  if (route === null || pin === undefined) return null
  return [...route.points, [pin.x, pin.y]]
}
