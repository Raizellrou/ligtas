import { describe, expect, it } from 'vitest'
import {
  blockedSegments,
  buildGraph,
  centerFields,
  distanceField,
  isBlocked,
  pointsToPath,
  routeFrom,
  snapToNetwork,
  type GraphData,
} from '../src/lib/routing'

// Two ways from node 0 to node 2 (the center), at 1 metre per map unit:
//
//   short: 0 -> 1 -> 2      (10 + 10 = 20 m)
//   long:  0 -> 3 -> 2      (40 + ~31.6 = ~71.6 m)
//
// `flood` has one char per edge, in the order edges are listed below:
// [0-1, 1-2, 0-3, 3-2].
function square(flood: string): GraphData {
  return {
    nodes: [0, 0, 10, 0, 10, 10, 0, 40],
    edges: [0, 1, 1, 2, 0, 3, 3, 2],
    flood,
    centers: { 'center-a': { node: 2, snapM: 5 } },
    anchors: [0],
  }
}

describe('isBlocked', () => {
  it('blocks nothing at Tier 1 or with no alert', () => {
    expect(isBlocked(2, 0)).toBe(false)
    expect(isBlocked(2, 1)).toBe(false)
    expect(isBlocked(3, 1)).toBe(false)
  })

  it('blocks a tier-2 street from Tier 2 up, and a tier-3 street only at Tier 3', () => {
    expect(isBlocked(2, 2)).toBe(true)
    expect(isBlocked(2, 3)).toBe(true)
    expect(isBlocked(3, 2)).toBe(false)
    expect(isBlocked(3, 3)).toBe(true)
  })

  it('never blocks a street that does not flood', () => {
    expect(isBlocked(0, 3)).toBe(false)
  })
})

describe('distanceField and routeFrom', () => {
  it('takes the short way when nothing is flooded', () => {
    const g = buildGraph(square('0000'), 1)
    const field = distanceField(g, 2, 0)
    expect(field.dist[0]).toBeCloseTo(20)
    expect(routeFrom(g, field, 0)!.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it('detours around a flooded street once the alert reaches its tier', () => {
    // Edge 0 (node 0 <-> 1) floods from Tier 2.
    const g = buildGraph(square('2000'), 1)
    expect(distanceField(g, 2, 1).dist[0]).toBeCloseTo(20) // Tier 1: unchanged
    const detour = distanceField(g, 2, 2)
    expect(detour.dist[0]).toBeCloseTo(40 + Math.hypot(10, 30))
    expect(routeFrom(g, detour, 0)!.points[1]).toEqual([0, 40])
  })

  it('reports a node as cut off, with no route, when every way is flooded', () => {
    const g = buildGraph(square('2222'), 1)
    const field = distanceField(g, 2, 2)
    expect(field.dist[0]).toBe(Infinity)
    expect(routeFrom(g, field, 0)).toBeNull()
  })

  it('does not treat a tier-3 street as flooded at Tier 2', () => {
    const g = buildGraph(square('3000'), 1)
    expect(distanceField(g, 2, 2).dist[0]).toBeCloseTo(20)
    expect(distanceField(g, 2, 3).dist[0]).toBeGreaterThan(60)
  })
})

describe('centerFields', () => {
  it('computes a field per center from its road node', () => {
    const g = buildGraph(square('0000'), 1)
    const fields = centerFields(g, 0)
    expect(Object.keys(fields)).toEqual(['center-a'])
    expect(fields['center-a'].dist[2]).toBe(0)
  })
})

describe('snapToNetwork', () => {
  it('snaps to the nearest point on the nearest street and reports the distance in metres', () => {
    const g = buildGraph(square('0000'), 2) // 2 m per unit
    // 3 units above the middle of the 0-1 street (which runs (0,0)-(10,0)).
    const hit = snapToNetwork(g, 4, 3)
    expect([hit.a, hit.b]).toEqual([0, 1])
    expect(hit.snapM).toBeCloseTo(3 * 2)
    expect(hit.x).toBeCloseTo(4)
    expect(hit.y).toBeCloseTo(0)
    expect(hit.alongA).toBeCloseTo(4 * 2)
    expect(hit.alongB).toBeCloseTo(6 * 2)
  })

  it('clamps to the end of a street when the point is past it', () => {
    const g = buildGraph(square('0000'), 1)
    const hit = snapToNetwork(g, 20, -5) // beyond node 1, off the 0-1 street
    expect(hit.x).toBeCloseTo(10)
    expect(hit.y).toBeCloseTo(0)
    expect(hit.alongB).toBeCloseTo(0)
  })

  it('picks the street a point is on, not the nearest end node of a different street', () => {
    // Long street 0-1 (100 units) and a short unrelated spur 2-3 hanging near its middle.
    const g = buildGraph(
      {
        nodes: [0, 0, 100, 0, 50, 30, 50, 40],
        edges: [0, 1, 2, 3],
        flood: '00',
        centers: { 'center-a': { node: 1, snapM: 0 } },
        anchors: [0],
      },
      1,
    )
    const hit = snapToNetwork(g, 50, 1) // standing on the long street, 1 m off it
    expect([hit.a, hit.b]).toEqual([0, 1])
    // A nearest-node snap would pick the spur's node 2 (29 units away) over
    // either end of the street the point is actually on (50 units away).
    expect(hit.snapM).toBeCloseTo(1)
  })
})

describe('blockedSegments', () => {
  it('lists only the streets flooded at the given severity', () => {
    const g = buildGraph(square('2300'), 1)
    expect(blockedSegments(g, 1)).toHaveLength(0)
    expect(blockedSegments(g, 2)).toEqual([[0, 0, 10, 0]])
    expect(blockedSegments(g, 3)).toHaveLength(2)
  })
})

describe('pointsToPath', () => {
  it('builds an SVG path', () => {
    expect(
      pointsToPath([
        [1, 2],
        [3.14159, 4],
      ]),
    ).toBe('M1 2L3.1 4')
  })
})
