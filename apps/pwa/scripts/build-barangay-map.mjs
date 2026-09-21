// Builds the offline evacuation map for the demo barangay from OpenStreetMap.
//
// Run by hand (`pnpm --filter @ligtas/pwa map:build`); the two JSON files it
// writes are committed, so `pnpm build` and CI never touch the network. This
// is a one-time snapshot, not a runtime dependency: the app only draws what
// is baked in here, which is what makes the map work with no connection.
//
// What is real and what is not:
//   real  -- roads, waterways, the barangay boundary, evacuation-center
//            names and locations (only places OSM actually names).
//   demo  -- the purok locations. OSM has no purok boundaries, so the 12
//            purok anchors are generated (seeded k-means over the road
//            network). The UI labels them "Demo layout, not official".
//
// Walking routes are precomputed here (Dijkstra over the OSM walking graph),
// so the app needs no graph, no routing code and no library at runtime.
//
// Overpass: the public servers rate-limit and time out under load, so every
// query is cached in the OS temp dir and retried with backoff across mirrors.
// Set LIGTAS_MAP_REFRESH=1 to ignore the cache.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(await readFile(path.join(here, 'nangka.config.json'), 'utf8'))
const OUT_DIR = path.join(here, '..', 'src', 'data')
const CACHE_DIR = process.env.LIGTAS_MAP_CACHE ?? path.join(tmpdir(), 'ligtas-map-cache')
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

const failures = []
function check(ok, message) {
  if (!ok) failures.push(message)
}

// ---------------------------------------------------------------- Overpass

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function overpass(name, query) {
  const cacheFile = path.join(CACHE_DIR, `${config.osmRelation}-${name}.json`)
  if (!process.env.LIGTAS_MAP_REFRESH && existsSync(cacheFile)) {
    return JSON.parse(await readFile(cacheFile, 'utf8'))
  }
  let lastError
  for (let attempt = 0; attempt < 8; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ligtas-map-build/0.1' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(150_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      // An overloaded server answers 200 with an XML error page, or with
      // JSON whose `remark` reports a runtime error and a partial result.
      const json = JSON.parse(text)
      if (typeof json.remark === 'string' && /error/i.test(json.remark)) throw new Error(json.remark)
      await mkdir(CACHE_DIR, { recursive: true })
      await writeFile(cacheFile, text)
      return json
    } catch (err) {
      lastError = err
      const wait = 6000 * (attempt + 1)
      console.warn(`  ${name}: ${endpoint} failed (${err.message}); retrying in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
  throw new Error(`Overpass query "${name}" failed after 8 attempts: ${lastError?.message}`)
}

// ---------------------------------------------------------------- geometry

const same = (a, b) => a.lat === b.lat && a.lon === b.lon

/** Joins OSM way fragments end-to-end into rings (closed) or chains (open). */
function assembleRings(segments) {
  const pool = segments.filter((s) => s.length > 1).map((s) => s.slice())
  const rings = []
  while (pool.length) {
    let ring = pool.pop()
    let grew = true
    while (grew && !same(ring[0], ring.at(-1))) {
      grew = false
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i]
        if (same(ring.at(-1), s[0])) ring = ring.concat(s.slice(1))
        else if (same(ring.at(-1), s.at(-1))) ring = ring.concat(s.slice(0, -1).reverse())
        else if (same(ring[0], s.at(-1))) ring = s.slice(0, -1).concat(ring)
        else if (same(ring[0], s[0])) ring = s.slice(1).reverse().concat(ring)
        else continue
        pool.splice(i, 1)
        grew = true
        break
      }
    }
    rings.push({ pts: ring, closed: ring.length > 3 && same(ring[0], ring.at(-1)) })
  }
  return rings
}

function polygonArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

function pointInPolygon([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Douglas-Peucker, iterative so a long river polygon can't overflow the stack. */
function simplify(pts, tolerance) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b])
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max > tolerance) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Keeps only the runs of a polyline that fall inside a rectangle. */
function clipRuns(pts, rect) {
  const runs = []
  let run = []
  for (const p of pts) {
    if (p[0] >= rect.x0 && p[0] <= rect.x1 && p[1] >= rect.y0 && p[1] <= rect.y1) run.push(p)
    else {
      if (run.length > 1) runs.push(run)
      run = []
    }
  }
  if (run.length > 1) runs.push(run)
  return runs
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- 1. fetch

console.log(`Building map for ${config.barangay} (OSM relation ${config.osmRelation})`)

const boundaryRes = await overpass('boundary', `[out:json][timeout:90];rel(${config.osmRelation});out geom;`)
const relation = boundaryRes.elements[0]
const boundaryRings = assembleRings(
  relation.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry),
)

let south = 90
let west = 190
let north = -90
let east = -190
for (const ring of boundaryRings) {
  for (const p of ring.pts) {
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lon)
    east = Math.max(east, p.lon)
  }
}

const lat0 = (south + north) / 2
const M_LAT = 110574
const M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180)
south -= config.padMeters / M_LAT
north += config.padMeters / M_LAT
west -= config.padMeters / M_LON
east += config.padMeters / M_LON
const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`

// Metres from the padded map's top-left corner, y down (SVG orientation).
const toMeters = (lat, lon) => [(lon - west) * M_LON, (north - lat) * M_LAT]
const widthM = (east - west) * M_LON
const heightM = (north - south) * M_LAT
const mpu = widthM / config.mapWidthUnits // real metres per SVG unit
const viewW = config.mapWidthUnits
const viewH = Math.round((heightM / mpu) * 10) / 10
const r1 = (v) => Math.round(v * 10) / 10
const toUnits = ([x, y]) => [r1(x / mpu), r1(y / mpu)]
const clipRect = { x0: -30, y0: -30, x1: viewW + 30, y1: viewH + 30 }

const ringM = (pts) => pts.map((p) => toMeters(p.lat, p.lon))
const outerRing = boundaryRings
  .filter((r) => r.closed)
  .map((r) => ringM(r.pts))
  .sort((a, b) => polygonArea(b) - polygonArea(a))[0]
check(outerRing !== undefined, 'boundary did not assemble into a closed ring')

console.log('Fetching roads, water and places (cached in ' + CACHE_DIR + ')...')
const roadsRes = await overpass(
  'roads',
  `[out:json][timeout:120];way[highway][highway!~'^(motorway|motorway_link|proposed|construction|razed|corridor|platform|bus_stop|elevator)$'][footway!~'^(sidewalk|crossing)$'][access!~'^(private|no)$'](${bbox});out geom;`,
)
await sleep(3000)
const waterRes = await overpass(
  'water',
  `[out:json][timeout:120];(way[waterway~'^(river|stream|canal|drain|riverbank)$'](${bbox});way[natural=water](${bbox});rel[natural=water](${bbox});rel[waterway=riverbank](${bbox}););out geom;`,
)
await sleep(3000)
const placesRes = await overpass(
  'places',
  `[out:json][timeout:120];(nwr[amenity~'^(school|community_centre|townhall|shelter|kindergarten)$'](${bbox});nwr[leisure~'^(pitch|sports_centre|stadium|sports_hall)$'](${bbox});nwr[building~'^(gymnasium|sports_hall|civic|government)$'](${bbox});nwr[office=government](${bbox}););out tags center;`,
)

// ---------------------------------------------------------------- 2. roads + walking graph

const ROAD_CLASS = {
  trunk: 'major',
  primary: 'major',
  secondary: 'major',
  tertiary: 'major',
  residential: 'minor',
  unclassified: 'minor',
  living_street: 'minor',
  road: 'minor',
}
const roadClassOf = (highway) => ROAD_CLASS[highway.replace(/_link$/, '')] ?? 'path'

const nodeIndex = new Map() // OSM node id -> graph index
const nodeXY = [] // metres
const edges = [] // [i, j, metres]
const drawn = { major: [], minor: [], path: [] } // polylines in metres, by class

function graphNode(id, lat, lon) {
  let i = nodeIndex.get(id)
  if (i === undefined) {
    i = nodeXY.length
    nodeIndex.set(id, i)
    nodeXY.push(toMeters(lat, lon))
  }
  return i
}

for (const way of roadsRes.elements) {
  if (way.type !== 'way' || !way.geometry || way.geometry.length < 2) continue
  const cls = roadClassOf(way.tags.highway)
  const pts = way.geometry.map((p) => toMeters(p.lat, p.lon))
  drawn[cls].push(pts)
  for (let k = 0; k + 1 < way.nodes.length; k++) {
    const a = graphNode(way.nodes[k], way.geometry[k].lat, way.geometry[k].lon)
    const b = graphNode(way.nodes[k + 1], way.geometry[k + 1].lat, way.geometry[k + 1].lon)
    if (a !== b) edges.push([a, b, Math.hypot(nodeXY[a][0] - nodeXY[b][0], nodeXY[a][1] - nodeXY[b][1])])
  }
}

// Keep only the largest connected piece, so every purok and center can reach
// every other (a stray disconnected footpath would otherwise strand a pin).
const adjacency = nodeXY.map(() => [])
for (const [a, b, w] of edges) {
  adjacency[a].push([b, w])
  adjacency[b].push([a, w])
}
const component = new Int32Array(nodeXY.length).fill(-1)
const componentSize = []
for (let start = 0; start < nodeXY.length; start++) {
  if (component[start] !== -1) continue
  const id = componentSize.length
  let size = 0
  const queue = [start]
  component[start] = id
  while (queue.length) {
    const n = queue.pop()
    size++
    for (const [m] of adjacency[n]) {
      if (component[m] === -1) {
        component[m] = id
        queue.push(m)
      }
    }
  }
  componentSize.push(size)
}
const mainComponent = componentSize.indexOf(Math.max(...componentSize))
const inGraph = (i) => component[i] === mainComponent
console.log(
  `Walking graph: ${nodeXY.length} nodes, ${edges.length} edges, largest piece ${componentSize[mainComponent]} nodes (${componentSize.length} pieces)`,
)

class MinHeap {
  constructor() {
    this.items = []
  }
  get size() {
    return this.items.length
  }
  push(key, value) {
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
  pop() {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length) {
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

function dijkstra(source) {
  const dist = new Float64Array(nodeXY.length).fill(Infinity)
  const prev = new Int32Array(nodeXY.length).fill(-1)
  dist[source] = 0
  const heap = new MinHeap()
  heap.push(0, source)
  while (heap.size) {
    const [d, n] = heap.pop()
    if (d > dist[n]) continue
    for (const [m, w] of adjacency[n]) {
      if (d + w < dist[m]) {
        dist[m] = d + w
        prev[m] = n
        heap.push(d + w, m)
      }
    }
  }
  return { dist, prev }
}

function nearestNode(p, allowed = () => true) {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < nodeXY.length; i++) {
    if (!inGraph(i) || !allowed(i)) continue
    const d = Math.hypot(nodeXY[i][0] - p[0], nodeXY[i][1] - p[1])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return { node: best, snap: bestD }
}

// ---------------------------------------------------------------- 3. demo purok anchors

const rand = mulberry32(config.seed)
const settlementNodes = []
for (let i = 0; i < nodeXY.length; i++) {
  if (inGraph(i) && pointInPolygon(nodeXY[i], outerRing)) settlementNodes.push(i)
}

function kmeans(points, k) {
  const centroids = [points[Math.floor(rand() * points.length)].slice()]
  while (centroids.length < k) {
    const d2 = points.map((p) => Math.min(...centroids.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2)))
    let t = rand() * d2.reduce((a, b) => a + b, 0)
    let i = 0
    while (i < points.length - 1 && (t -= d2[i]) > 0) i++
    centroids.push(points[i].slice())
  }
  for (let iter = 0; iter < 80; iter++) {
    const sums = centroids.map(() => [0, 0, 0])
    for (const p of points) {
      let best = 0
      let bestD = Infinity
      centroids.forEach((c, ci) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2
        if (d < bestD) {
          bestD = d
          best = ci
        }
      })
      sums[best][0] += p[0]
      sums[best][1] += p[1]
      sums[best][2]++
    }
    sums.forEach((s, ci) => {
      if (s[2] > 0) centroids[ci] = [s[0] / s[2], s[1] / s[2]]
    })
  }
  return centroids
}

const settlementSet = new Set(settlementNodes)
const usedNodes = new Set()
const anchorNodes = kmeans(
  settlementNodes.map((i) => nodeXY[i]),
  config.purokCount,
).map((c) => {
  const { node, snap } = nearestNode(c, (i) => !usedNodes.has(i) && settlementSet.has(i))
  usedNodes.add(node)
  return { node, snap }
})

// Number the puroks in reading order (north to south, west to east) so the
// numbering looks like a layout rather than an accident of the clustering.
const cols = 4
const byY = anchorNodes.slice().sort((a, b) => nodeXY[a.node][1] - nodeXY[b.node][1])
const purokAnchors = []
for (let row = 0; row * cols < byY.length; row++) {
  byY
    .slice(row * cols, row * cols + cols)
    .sort((a, b) => nodeXY[a.node][0] - nodeXY[b.node][0])
    .forEach((a) => purokAnchors.push(a))
}

// ---------------------------------------------------------------- 4. evacuation centers

const KINDS = ['school', 'hall', 'court']
const KIND_LABEL = { school: 'School', hall: 'Hall', court: 'Court' }

function kindOf(tags) {
  const name = tags.name ?? ''
  if (!name) return null
  if (tags.amenity === 'school' && /school/i.test(name)) return 'school'
  if (
    (tags.amenity === 'townhall' || tags.amenity === 'community_centre') &&
    /barangay|pambarangay|hall|multi-?purpose|civic/i.test(name)
  ) {
    return 'hall'
  }
  if (
    (['pitch', 'sports_hall', 'sports_centre'].includes(tags.leisure ?? '') || tags.building === 'sports_hall') &&
    /court|gym/i.test(name)
  ) {
    return 'court'
  }
  return null
}

const candidates = []
for (const e of placesRes.elements) {
  const kind = kindOf(e.tags ?? {})
  if (!kind) continue
  const pos = e.type === 'node' ? [e.lat, e.lon] : [e.center.lat, e.center.lon]
  const xy = toMeters(pos[0], pos[1])
  if (!pointInPolygon(xy, outerRing)) continue
  const { node, snap } = nearestNode(xy)
  if (snap > config.maxSnapMeters) continue
  candidates.push({ osm: `${e.type}/${e.id}`, name: e.tags.name, kind, xy, node, snap })
}
console.log(`Center candidates inside the barangay (named, on the road network): ${candidates.length}`)
for (const k of KINDS) {
  console.log(`  ${k}: ${candidates.filter((c) => c.kind === k).map((c) => c.name).join('; ') || '(none)'}`)
}

const distFrom = new Map() // graph node -> dijkstra result
const distancesFor = (node) => {
  if (!distFrom.has(node)) distFrom.set(node, dijkstra(node))
  return distFrom.get(node)
}

let chosen
if (config.centerOsmIds) {
  chosen = config.centerOsmIds.map((id) => {
    const c = candidates.find((x) => x.osm === id)
    check(c !== undefined, `pinned center ${id} is not a valid candidate`)
    return c
  })
} else {
  // Prefer elementary schools -- the usual evacuation-center pick -- and
  // roofed courts (an open basketball court shelters no one), falling back to
  // any named candidate of that kind if the barangay has none.
  const preferred = { school: /elementary/i, court: /covered|gym/i }
  const pools = KINDS.map((k) => {
    const all = candidates.filter((c) => c.kind === k)
    const wanted = preferred[k] ? all.filter((c) => preferred[k].test(c.name)) : all
    return wanted.length ? wanted : all
  })
  check(pools.every((p) => p.length > 0), 'no candidate for one of: school, hall, court')

  // Pick the trio that minimises the average walk from a purok to its nearest
  // center, among trios kept apart from each other (a tight cluster of three
  // pins covers nothing). Relax the separation if no trio satisfies it.
  let best = null
  for (let sep = config.minCenterSeparationMeters; sep >= 100 && !best; sep = Math.floor(sep * 0.8)) {
    for (const s of pools[0]) {
      for (const h of pools[1]) {
        for (const c of pools[2]) {
          const trio = [s, h, c]
          const apart = trio.every((a, i) => trio.every((b, j) => i >= j || Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) >= sep))
          if (!apart) continue
          const cost =
            purokAnchors.reduce((sum, a) => sum + Math.min(...trio.map((t) => distancesFor(t.node).dist[a.node] + t.snap)), 0) /
            purokAnchors.length
          if (!best || cost < best.cost) best = { trio, cost }
        }
      }
    }
  }
  check(best !== null, 'no evacuation-center trio found')
  chosen = best?.trio ?? []
}

const centers = chosen.map((c, i) => ({ id: `center-${'abc'[i]}`, ...c }))

// ---------------------------------------------------------------- 5. routes

const pathToU = (pts) => simplify(pts.map(toUnits), 0.2)
const walkMeters = {}
const routeD = {}
const dOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')

purokAnchors.forEach((anchor, pi) => {
  const purok = pi + 1
  walkMeters[purok] = {}
  routeD[purok] = {}
  for (const center of centers) {
    const { dist, prev } = distancesFor(center.node)
    const graphDist = dist[anchor.node]
    check(Number.isFinite(graphDist), `purok ${purok} cannot reach ${center.name}`)
    const total = graphDist + center.snap
    const straight = Math.hypot(nodeXY[anchor.node][0] - center.xy[0], nodeXY[anchor.node][1] - center.xy[1])
    check(total >= straight - 1, `purok ${purok} -> ${center.name}: route ${total.toFixed(0)} m is shorter than straight line ${straight.toFixed(0)} m`)
    walkMeters[purok][center.id] = Math.max(10, Math.round(total / 10) * 10)

    const nodes = []
    for (let n = anchor.node; n !== -1; n = prev[n]) nodes.push(n)
    routeD[purok][center.id] = dOf(pathToU([...nodes.map((n) => nodeXY[n]), center.xy]))
  }
})

// ---------------------------------------------------------------- 6. map layers

const pathOf = (polylines, tolerance) =>
  polylines
    .flatMap((pts) => clipRuns(pts.map(toUnits), clipRect))
    .map((run) => simplify(run, tolerance))
    .filter((run) => run.length > 1)
    .map(dOf)
    .join('')

const water = { river: [], stream: [], areas: [] }
const areaRings = []
for (const el of waterRes.elements) {
  if (el.type === 'way' && el.geometry) {
    const w = el.tags ?? {}
    if (w.natural === 'water' || w.waterway === 'riverbank') {
      const closed = el.geometry.length > 3 && same(el.geometry[0], el.geometry.at(-1))
      if (closed) areaRings.push(ringM(el.geometry))
      else water.stream.push(ringM(el.geometry))
    } else {
      ;(w.waterway === 'river' ? water.river : water.stream).push(ringM(el.geometry))
    }
  } else if (el.type === 'relation') {
    const rings = assembleRings(el.members.filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry))
    for (const ring of rings) {
      if (ring.closed) areaRings.push(ringM(ring.pts))
      else water.stream.push(ringM(ring.pts)) // an unclosed bank still reads as a line
    }
  }
}
const areasD = areaRings
  .map((ring) => simplify(ring.map(toUnits), 0.4))
  .filter((ring) => ring.length > 3)
  .map((ring) => dOf(ring) + 'Z')
  .join('')

const boundaryU = simplify(outerRing.map(toUnits), 0.3)

const mapJson = {
  meta: { viewBox: [viewW, viewH] },
  boundary: dOf(boundaryU) + 'Z',
  roads: {
    major: pathOf(drawn.major, 0.25),
    minor: pathOf(drawn.minor, 0.25),
    path: pathOf(drawn.path, 0.25),
  },
  water: {
    areas: areasD,
    river: pathOf(water.river, 0.3),
    stream: pathOf(water.stream, 0.3),
  },
  routes: routeD,
}

const snapshotDate = new Date().toISOString().slice(0, 10)
const routesJson = {
  meta: {
    barangay: config.barangay,
    source: 'OpenStreetMap contributors (ODbL)',
    snapshotDate,
    osmBase: roadsRes.osm3s?.timestamp_osm_base ?? null,
    viewBox: [viewW, viewH],
    metersPerUnit: r1(mpu),
    layoutNote: 'Purok positions are a demo layout, not official. Evacuation centers are not LGU-confirmed.',
  },
  centers: centers.map((c) => {
    const [x, y] = toUnits(c.xy)
    // A gym is more useful to a resident as "Gym" than as the generic "Court".
    const short = c.kind === 'court' && /gym/i.test(c.name) ? 'Gym' : KIND_LABEL[c.kind]
    return { id: c.id, name: c.name, kind: c.kind, short, osm: c.osm, x, y }
  }),
  puroks: purokAnchors.map((a, i) => {
    const [x, y] = toUnits(nodeXY[a.node])
    return { purok: i + 1, x, y }
  }),
  walkMeters,
}

// ---------------------------------------------------------------- 7. checks + write

const mapBytes = Buffer.byteLength(JSON.stringify(mapJson))
check(mapBytes <= config.geometryBudgetBytes, `map geometry is ${mapBytes} bytes, over the ${config.geometryBudgetBytes} budget`)
check(purokAnchors.length === config.purokCount, `expected ${config.purokCount} puroks, got ${purokAnchors.length}`)
for (const p of routesJson.puroks) {
  check(p.x >= 0 && p.x <= viewW && p.y >= 0 && p.y <= viewH, `purok ${p.purok} is outside the map`)
}
for (const c of routesJson.centers) {
  check(c.x >= 0 && c.x <= viewW && c.y >= 0 && c.y <= viewH, `${c.name} is outside the map`)
}
purokAnchors.forEach((a, i) => check(a.snap <= config.maxSnapMeters * 2, `purok ${i + 1} snapped ${a.snap.toFixed(0)} m from its centroid`))

console.log('\nCenters chosen:')
for (const c of centers) console.log(`  ${c.id}  ${KIND_LABEL[c.kind].padEnd(6)} ${c.name}  (${c.osm}, ${c.snap.toFixed(0)} m off-road)`)
console.log('\nWalking metres (rounded to 10), purok x center:')
for (const p of Object.keys(walkMeters)) {
  const row = centers.map((c) => String(walkMeters[p][c.id]).padStart(5)).join(' ')
  console.log(`  purok ${p.padStart(2)}: ${row}   nearest ${centers.reduce((a, b) => (walkMeters[p][a.id] <= walkMeters[p][b.id] ? a : b)).name}`)
}
console.log(`\nMap: ${viewW} x ${viewH} units, ${r1(mpu)} m/unit, geometry ${(mapBytes / 1024).toFixed(1)} KB`)

if (failures.length) {
  console.error('\nSelf-checks FAILED:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })
await writeFile(path.join(OUT_DIR, 'nangka-map.json'), JSON.stringify(mapJson))
await writeFile(path.join(OUT_DIR, 'nangka-routes.json'), JSON.stringify(routesJson, null, 2) + '\n')
console.log('\nSelf-checks passed. Wrote src/data/nangka-map.json and src/data/nangka-routes.json')
