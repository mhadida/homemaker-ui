/** Local ENU tangent-plane projection between WGS84 lon/lat and the app's
 * plan metres [x, z]. east→+x, north→+z. Flat-earth error at ≤~2 km city
 * scale is <0.1 m. Pure — no three/React. */

export interface GeoAnchor {
  lat0: number;
  lon0: number;
}

export interface LngLatBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const R = 6378137; // WGS84 equatorial radius (m)
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** bbox centre → the local-frame origin anchor. */
export function anchorOf(b: LngLatBBox): GeoAnchor {
  return { lat0: (b.south + b.north) / 2, lon0: (b.west + b.east) / 2 };
}

/** lon/lat → local plan metres [x, z]. */
export function project(lat: number, lon: number, a: GeoAnchor): [number, number] {
  const x = rad(lon - a.lon0) * Math.cos(rad(a.lat0)) * R;
  const z = rad(lat - a.lat0) * R;
  return [x, z];
}

/** Inverse of project. */
export function unproject(x: number, z: number, a: GeoAnchor): [number, number] {
  const lat = a.lat0 + deg(z / R);
  const lon = a.lon0 + deg(x / (Math.cos(rad(a.lat0)) * R));
  return [lat, lon];
}
