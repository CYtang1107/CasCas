import { CONST } from '../config.js';

const toRad = (d) => (d * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function driveMinutes(km) {
  return ((km * CONST.roadFactor) / CONST.avgKmh) * 60;
}

// Extra minutes for origin → charger → destination compared with going direct.
export function detourMinutes(origin, charger, destination) {
  const extra = distanceKm(origin, charger) + distanceKm(charger, destination) - distanceKm(origin, destination);
  return driveMinutes(Math.max(0, extra));
}
