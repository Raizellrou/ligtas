import { describe, expect, it } from 'vitest'
import { latLonToUnits, unitsToLatLon, withinMap, type Projection } from '../src/lib/geo'

// Roughly Nangka, Marikina: a 2.4 km wide map drawn 400 units across.
const projection: Projection = { west: 121.0968, north: 14.6768, mLat: 110574, mLon: 107600, mpu: 6.6 }

describe('latLonToUnits / unitsToLatLon', () => {
  it('puts the top-left corner at the origin', () => {
    const p = latLonToUnits(projection.north, projection.west, projection)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0)
  })

  it('increases x to the east and y to the south', () => {
    const p = latLonToUnits(projection.north - 0.001, projection.west + 0.001, projection)
    expect(p.x).toBeCloseTo((0.001 * 107600) / 6.6)
    expect(p.y).toBeCloseTo((0.001 * 110574) / 6.6)
  })

  it('round-trips a coordinate', () => {
    const { x, y } = latLonToUnits(14.6702, 121.1093, projection)
    const back = unitsToLatLon(x, y, projection)
    expect(back.lat).toBeCloseTo(14.6702, 9)
    expect(back.lon).toBeCloseTo(121.1093, 9)
  })
})

describe('withinMap', () => {
  it('accepts points on the map and rejects points off it', () => {
    expect(withinMap(200, 100, [400, 250])).toBe(true)
    expect(withinMap(-1, 100, [400, 250])).toBe(false)
    expect(withinMap(200, 260, [400, 250])).toBe(false)
  })

  it('allows a margin past the edge', () => {
    expect(withinMap(-5, 100, [400, 250], 10)).toBe(true)
    expect(withinMap(-15, 100, [400, 250], 10)).toBe(false)
  })
})
