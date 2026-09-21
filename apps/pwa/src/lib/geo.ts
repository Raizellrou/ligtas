// Converts between GPS coordinates and the map's SVG units. The parameters
// come from scripts/build-barangay-map.mjs (nangka-routes.json meta.projection)
// and are the exact numbers the build used, so a GPS fix lands where the
// same real-world point was drawn. Pure functions, no React.

export interface Projection {
  /** Longitude of the map's left edge. */
  west: number
  /** Latitude of the map's top edge. */
  north: number
  /** Metres per degree of latitude / longitude at the map's centre latitude. */
  mLat: number
  mLon: number
  /** Real metres per SVG unit. */
  mpu: number
}

export function latLonToUnits(lat: number, lon: number, p: Projection): { x: number; y: number } {
  return { x: ((lon - p.west) * p.mLon) / p.mpu, y: ((p.north - lat) * p.mLat) / p.mpu }
}

export function unitsToLatLon(x: number, y: number, p: Projection): { lat: number; lon: number } {
  return { lat: p.north - (y * p.mpu) / p.mLat, lon: p.west + (x * p.mpu) / p.mLon }
}

/** True if a point is on the map, allowing `marginUnits` of slack past each edge. */
export function withinMap(x: number, y: number, viewBox: number[], marginUnits = 0): boolean {
  return x >= -marginUnits && y >= -marginUnits && x <= viewBox[0] + marginUnits && y <= viewBox[1] + marginUnits
}
