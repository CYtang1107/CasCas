// Per-device demo state. Every storage call is guarded so private windows and blocked storage still work.
const KEY = 'cascas.v1';
export const MAX_SESSIONS = 500;
// The driver's own settings on this device (no accounts in the prototype).
const blankProfile = () => ({ name: '', carId: null, homeId: '', prefs: null, theme: 'light' });
const blank = () => ({ checkins: {}, booking: null, sharing: {}, sessions: [], visitorPasses: [], anonNo: null, maintenance: {}, searchHistory: [], favourites: [], profile: blankProfile() });
let memory = blank();

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Keep only the parts of stored JSON that have the shape the app expects (old builds may differ).
function clean(parsed) {
  const s = blank();
  if (!isObject(parsed)) return s;
  if (isObject(parsed.checkins)) {
    for (const [id, list] of Object.entries(parsed.checkins)) if (Array.isArray(list)) s.checkins[id] = list;
  }
  if (isObject(parsed.sharing)) {
    for (const [id, v] of Object.entries(parsed.sharing)) if (isObject(v)) s.sharing[id] = v;
  }
  if (isObject(parsed.booking)) s.booking = parsed.booking;
  if (Array.isArray(parsed.sessions)) s.sessions = parsed.sessions.filter(isObject).slice(-MAX_SESSIONS);
  if (Array.isArray(parsed.visitorPasses)) s.visitorPasses = parsed.visitorPasses.filter(isObject);
  if (Number.isInteger(parsed.anonNo)) s.anonNo = parsed.anonNo;
  for (const k of ['searchHistory', 'favourites']) {
    if (Array.isArray(parsed[k])) s[k] = parsed[k].filter((x) => typeof x === 'string').slice(0, 50);
  }
  if (isObject(parsed.profile)) {
    const p = parsed.profile;
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    s.profile = {
      name: str(p.name, 40), carId: typeof p.carId === 'string' ? p.carId : null, homeId: str(p.homeId, 40),
      theme: p.theme === 'dark' ? 'dark' : 'light',
      prefs: isObject(p.prefs) ? {
        maxPrice: typeof p.prefs.maxPrice === 'number' && p.prefs.maxPrice > 0 ? p.prefs.maxPrice : null,
        fastOnly: p.prefs.fastOnly === true,
        operator: typeof p.prefs.operator === 'string' ? p.prefs.operator.slice(0, 40) : null,
      } : null,
    };
  }
  if (isObject(parsed.maintenance)) {
    for (const [id, list] of Object.entries(parsed.maintenance)) if (Array.isArray(list)) s.maintenance[id] = list.filter(isObject);
  }
  return s;
}

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) memory = clean(JSON.parse(raw));
  } catch {
    // Corrupt JSON or blocked storage: keep what is in memory.
  }
  return memory;
}

export function saveState(state) {
  memory = state;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
}

export function resetState() {
  memory = blank();
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* memory only */ }
  return memory;
}

export function addSession(state, record) {
  state.sessions = [...state.sessions, record].slice(-MAX_SESSIONS);
}

// A random 1–99 number for this device, used in anonymous IDs such as "Visitor #48".
export function anonNumber(state, rand = Math.random) {
  if (!Number.isInteger(state.anonNo)) state.anonNo = 1 + Math.floor(rand() * 99);
  return state.anonNo;
}
