// TomTom through the server: the key never reaches the browser, and every answer is cached so a
// demo stays well inside the free daily allowance (about 2,500 requests).
import { stationsFromSearch, parseAvailability } from '../engine/tomtom.js';

const BASE = 'https://api.tomtom.com';
const HOME = { lat: 3.2165, lng: 101.725 }; // KL East
const TTL = { stations: 6 * 3600e3, availability: 5 * 60e3, route: 3 * 60e3, incidents: 5 * 60e3 };
const MAX_AVAILABILITY = 25;

export function createTomTom({ key, fetchFn, now }) {
  const cache = new Map();
  const cached = async (k, ttl, load) => {
    const hit = cache.get(k);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = await load();
    if (cache.size > 1000) cache.clear();
    cache.set(k, { at: now(), value });
    return value;
  };
  const get = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetchFn(`${BASE}${path}${sep}key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(`TomTom ${r.status}`);
    return r.json();
  };

  async function stations() {
    const list = await cached('stations', TTL.stations, async () => stationsFromSearch(
      await get(`/search/2/nearbySearch/.json?lat=${HOME.lat}&lon=${HOME.lng}&radius=15000&categorySet=7309&limit=100`)));
    return cached('availability', TTL.availability, async () => {
      const out = [];
      for (const s of list) {
        let live = null;
        if (s.availabilityId && out.filter((x) => x.live).length < MAX_AVAILABILITY) {
          try { live = parseAvailability(await get(`/search/2/chargingAvailability.json?chargingAvailability=${encodeURIComponent(s.availabilityId)}`)); } catch { live = null; }
        }
        out.push({ ...s, live });
      }
      return { stations: out, at: now() };
    });
  }

  const route = (pts, alternatives) => cached(`r:${alternatives}:${pts.map((p) => `${p.lat},${p.lng}`).join(';')}`, TTL.route, () => get(
    `/routing/1/calculateRoute/${pts.map((p) => `${p.lat},${p.lng}`).join(':')}/json?traffic=true&sectionType=traffic&instructionsType=text&language=en-GB&maxAlternatives=${alternatives ? 1 : 0}`));

  const incidents = (bbox) => cached(`i:${bbox}`, TTL.incidents, () => get(
    `/traffic/services/5/incidentDetails?bbox=${bbox}&language=en-GB&fields=${encodeURIComponent('{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},from,to,delay}}}')}`));

  return { stations, route, incidents };
}

// Route points: up to 6 "lat,lng" pairs inside a box around Malaysia, rounded to ~100 m.
export function parsePoints(q) {
  const pts = String(q || '').split(';').map((s) => s.split(',').map(Number));
  if (pts.length < 2 || pts.length > 6) return null;
  if (!pts.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat > -2 && lat < 8 && lng > 98 && lng < 121)) return null;
  return pts.map(([lat, lng]) => ({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 }));
}

// Incident box "w,s,e,n": snapped to 0.05° so neighbours share a cache entry, at most ~0.9° a side.
export function parseBbox(q) {
  const b = String(q || '').split(',').map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return null;
  let [w, s, e, n] = b.map((v) => Math.round(v * 20) / 20);
  if (e <= w || n <= s) return null;
  if (e - w > 0.9) { const c = (w + e) / 2; w = c - 0.45; e = c + 0.45; }
  if (n - s > 0.9) { const c = (s + n) / 2; s = c - 0.45; n = c + 0.45; }
  return [w, s, e, n].map((v) => v.toFixed(2)).join(',');
}
