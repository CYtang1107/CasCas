// Place search for Plan: our own places first, then Photon (OpenStreetMap search, made for
// type-ahead and free for fair use). Only the typed words go out, with the start point rounded
// to about 1 km to rank nearer results first.
import { roadKm } from './trip.js';

export const TRIP_KM = 40;
const MALAYSIA_BBOX = '99.6,0.8,119.3,7.4';

export const isTrip = (origin, dest) => roadKm(origin, dest) > TRIP_KM;

export function photonUrl(query, near) {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', query);
  u.searchParams.set('limit', '6');
  u.searchParams.set('lang', 'en');
  u.searchParams.set('bbox', MALAYSIA_BBOX);
  if (near) {
    u.searchParams.set('lat', near.lat.toFixed(2));
    u.searchParams.set('lon', near.lng.toFixed(2));
  }
  return u.toString();
}

export function parsePhoton(json) {
  const out = [];
  for (const f of json?.features || []) {
    const p = f?.properties || {};
    const [lng, lat] = f?.geometry?.coordinates || [];
    if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const parts = [p.street, p.city, p.state].filter((x) => x && x !== p.name);
    out.push({ name: p.name, sub: (parts.length ? parts : [p.state, p.country].filter(Boolean)).join(', '), lat, lng, source: 'search' });
  }
  return out;
}

export function localMatches(query, places) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return places
    .filter((p) => q.split(/\s+/).every((w) => p.name.toLowerCase().includes(w)))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
}

export async function searchPlaces(query, near, { fetchFn = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(photonUrl(query, near), { signal: ctrl.signal });
    return res.ok ? parsePhoton(await res.json()) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}
