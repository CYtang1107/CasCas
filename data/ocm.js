// Load public chargers: live from Open Charge Map, else a saved copy (< 7 days), else the demo list.
import { OCM } from '../config.js';
import { START } from './places.js';
import { CONDO_SITES } from './chargers.js';
import { DEMO_CHARGERS } from './chargers-demo.js';
import { normaliseAll } from '../engine/normalise.js';

const CACHE_KEY = 'cascas.ocm.v1';
const DAY_MS = 864e5;

export function ocmUrl(key, centre = START) {
  const q = new URLSearchParams({
    output: 'json', latitude: centre.lat, longitude: centre.lng,
    distance: OCM.radiusKm, distanceunit: 'KM', maxresults: OCM.maxResults,
    compact: 'false', verbose: 'false', key,
  });
  return `https://api.openchargemap.io/v3/poi?${q}`;
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

async function fetchLive(fetchFn, key) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), OCM.timeoutMs) : null;
  try {
    const res = await fetchFn(ocmUrl(key), ctrl ? { signal: ctrl.signal } : {});
    if (!res || !res.ok) return null;
    const list = normaliseAll(await res.json());
    return list.length ? list : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readCache(storage) {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    const c = raw ? JSON.parse(raw) : null;
    return c && Array.isArray(c.chargers) && typeof c.savedAt === 'number' ? c : null;
  } catch {
    return null;
  }
}

function writeCache(storage, cache) {
  try { storage?.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* memory only */ }
}

export async function loadChargers({
  fetchFn = globalThis.fetch, storage = browserStorage(), now = Date.now(), key = OCM.key, condoSites = CONDO_SITES,
} = {}) {
  if (key && fetchFn) {
    const live = await fetchLive(fetchFn, key);
    if (live) {
      writeCache(storage, { savedAt: now, chargers: live });
      return { chargers: [...condoSites, ...live], source: 'live', ageDays: 0 };
    }
  }
  const cache = readCache(storage);
  if (cache) {
    const age = (now - cache.savedAt) / DAY_MS;
    if (age >= 0 && age < OCM.cacheMaxAgeDays) {
      return { chargers: [...condoSites, ...cache.chargers], source: 'saved', ageDays: Math.floor(age) };
    }
  }
  return { chargers: [...condoSites, ...DEMO_CHARGERS], source: 'demo', ageDays: 0 };
}
