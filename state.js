// Per-device demo state. Every storage call is guarded so private windows and blocked storage still work.
const KEY = 'cascas.v1';
const blank = () => ({ checkins: {}, booking: null, sharing: {} });
let memory = blank();

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) memory = { ...blank(), ...JSON.parse(raw) };
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
