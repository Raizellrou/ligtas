// Walking-route engine over the barangay's road network. Pure functions, no
// React, no DOM: it is imported by the app AND by scripts/build-barangay-map.mjs
// (Node strips the types), so the build's cross-check and the phone run the
// very same code. Keep it to erasable TypeScript syntax (no enums, no
// constructor parameter properties) for that reason.
//
// Design: distances from each evacuation center to every road node are
// computed once per alert severity ("distance fields"). A route from ANY
// start point is then just walking the field's `prev` chain from the start's
// nearest road node, so a moving GPS dot costs almost nothing per update.

export interface GraphData {
  /** Flat [x0, y0, x1, y1, ...] node coordinates in map units. */
  nodes: number[]
  /** Flat [a0, b0, a1, b1, ...] node indices, one pair per road edge. */
  edges: number[]
  /** One char per edge: '0' never floods, '2' floods from Tier 2 up, '3' only at Tier 3. */
  flood: string
  /** Each evacuation center's nearest road node and how far off-road the pin is. */
  centers: Record<string, { node: number; snapM: number }>
  /** Road node of each purok's demo anchor, purok 1..n. */
  anchors: number[]
}

interface Arc {
  to: number
  /** Length in metres. */
  w: number
  edge: number
}

export interface Graph {
  data: GraphData
  metersPerUnit: number
  nodeCount: number
  edgeCount: number
  adj: Arc[][]
  edgeFlood: number[]
}

export interface Field {
  /** Walking metres from the source to each node along unblocked edges; Infinity if cut off. */
  dist: Float64Array
  /** Previous node on the way back to the source; -1 at the source and for unreachable nodes. */
  prev: Int32Array
}

export function buildGraph(data: GraphData, metersPerUnit: number): Graph {
  const nodeCount = data.nodes.length / 2
  const edgeCount = data.edges.length / 2
  const adj: Arc[][] = Array.from({ length: nodeCount }, () => [])
  const edgeFlood: number[] = []
  for (let e = 0; e < edgeCount; e++) {
    const a = data.edges[2 * e]
    const b = data.edges[2 * e + 1]
    const w =
      Math.hypot(data.nodes[2 * a] - data.nodes[2 * b], data.nodes[2 * a + 1] - data.nodes[2 * b + 1]) * metersPerUnit
    adj[a].push({ to: b, w, edge: e })
    adj[b].push({ to: a, w, edge: e })
    edgeFlood.push(Number(data.flood[e]))
  }
  return { data, metersPerUnit, nodeCount, edgeCount, adj, edgeFlood }
}

/**
 * Whether a street is treated as flooded at an alert severity. Tier 1 ("watch")
 * and "no alert" block nothing: every flood-prone street starts at Tier 2.
 */
export function isBlocked(floodTier: number, severity: number): boolean {
  return floodTier !== 0 && floodTier <= severity
}

class MinHeap {
  items: [number, number][] = []

  get size(): number {
    return this.items.length
  }

  push(key: number, value: number): void {
    const a = this.items
    a.push([key, value])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }

  pop(): [number, number] {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/** Dijkstra from one node, treating streets flooded at `severity` as impassable. */
export function distanceField(graph: Graph, source: number, severity: number): Field {
  const dist = new Float64Array(graph.nodeCount).fill(Infinity)
  const prev = new Int32Array(graph.nodeCount).fill(-1)
  dist[source] = 0
  const heap = new MinHeap()
  heap.push(0, source)
  while (heap.size > 0) {
    const [d, n] = heap.pop()
    if (d > dist[n]) continue
    for (const arc of graph.adj[n]) {
      if (isBlocked(graph.edgeFlood[arc.edge], severity)) continue
      const next = d + arc.w
      if (next < dist[arc.to]) {
        dist[arc.to] = next
        prev[arc.to] = n
        heap.push(next, arc.to)
      }
    }
  }
  return { dist, prev }
}

/** A distance field per evacuation center id. */
export function centerFields(graph: Graph, severity: number): Record<string, Field> {
  const fields: Record<string, Field> = {}
  for (const [id, c] of Object.entries(graph.data.centers)) fields[id] = distanceField(graph, c.node, severity)
  return fields
}

export interface NetworkSnap {
  /** The two road nodes at the ends of the nearest street segment. */
  a: number
  b: number
  /** Metres from the snapped point on the street to each end. */
  alongA: number
  alongB: number
  /** Metres from the map point to the street. */
  snapM: number
  /** The snapped point on the street, in map units. */
  x: number
  y: number
}

/**
 * The nearest point on the road network to a map point. Snapping to a whole
 * street segment, not to its nearest end node, matters: on a long street the
 * closest node can belong to a different street entirely (one that flooding
 * may cut off), which would tell someone standing on a safe street they have
 * no way out. A route from here leaves via either end of the segment.
 */
export function snapToNetwork(graph: Graph, x: number, y: number): NetworkSnap {
  const { nodes, edges } = graph.data
  let best = { e: 0, t: 0, d: Infinity }
  for (let e = 0; e < graph.edgeCount; e++) {
    const a = edges[2 * e]
    const b = edges[2 * e + 1]
    const ax = nodes[2 * a]
    const ay = nodes[2 * a + 1]
    const dx = nodes[2 * b] - ax
    const dy = nodes[2 * b + 1] - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
    if (d < best.d) best = { e, t, d }
  }
  const a = edges[2 * best.e]
  const b = edges[2 * best.e + 1]
  const ax = nodes[2 * a]
  const ay = nodes[2 * a + 1]
  const bx = nodes[2 * b]
  const by = nodes[2 * b + 1]
  const edgeM = Math.hypot(bx - ax, by - ay) * graph.metersPerUnit
  return {
    a,
    b,
    alongA: best.t * edgeM,
    alongB: (1 - best.t) * edgeM,
    snapM: best.d * graph.metersPerUnit,
    x: ax + best.t * (bx - ax),
    y: ay + best.t * (by - ay),
  }
}

/** The route from a node back to the field's source, or null if it is cut off. */
export function routeFrom(graph: Graph, field: Field, node: number): { points: [number, number][]; meters: number } | null {
  if (!Number.isFinite(field.dist[node])) return null
  const points: [number, number][] = []
  for (let n = node; n !== -1; n = field.prev[n]) points.push([graph.data.nodes[2 * n], graph.data.nodes[2 * n + 1]])
  return { points, meters: field.dist[node] }
}

/** Streets treated as flooded at `severity`, as [ax, ay, bx, by] segments for drawing. */
export function blockedSegments(graph: Graph, severity: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  for (let e = 0; e < graph.edgeCount; e++) {
    if (!isBlocked(graph.edgeFlood[e], severity)) continue
    const a = graph.data.edges[2 * e]
    const b = graph.data.edges[2 * e + 1]
    out.push([graph.data.nodes[2 * a], graph.data.nodes[2 * a + 1], graph.data.nodes[2 * b], graph.data.nodes[2 * b + 1]])
  }
  return out
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** An SVG path `d` string through a list of points. */
export function pointsToPath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('')
}

/** An SVG path `d` string of disjoint segments. */
export function segmentsToPath(segments: readonly (readonly [number, number, number, number])[]): string {
  return segments.map(([ax, ay, bx, by]) => `M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}`).join('')
}
