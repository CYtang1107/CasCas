// Per-device demo state. Every storage call is guarded so private windows and blocked storage still work.
const KEY = 'cascas.v1';
const blank = () => ({ checkins: {}, booking: null, sharing: {} });
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
