// Operational log for a condo's charging bays: faults, repairs and routine services, with costs.
export const KINDS = { fault: 'Fault', repair: 'Repaired', service: 'Routine service' };
export const MAX_NOTE = 120;

export function validateEntry(e, bays) {
  if (!e || typeof e !== 'object') return 'Invalid entry.';
  if (!(Number.isInteger(e.bay) && e.bay >= 1 && e.bay <= bays)) return `Choose a bay from 1 to ${bays}.`;
  if (!Object.hasOwn(KINDS, e.kind)) return 'Choose a type: fault, repaired or routine service.';
  if (!(typeof e.costRm === 'number' && Number.isFinite(e.costRm) && e.costRm >= 0 && e.costRm <= 100000)) return 'Cost must be RM0 or more.';
  if (!(typeof e.at === 'number' && Number.isFinite(e.at) && e.at > 0)) return 'Invalid date.';
  if (e.note !== undefined && typeof e.note !== 'string') return 'Invalid note.';
  return null;
}

export function cleanEntry(e) {
  return { bay: e.bay, kind: e.kind, costRm: Math.round(e.costRm * 100) / 100, at: e.at, note: String(e.note || '').slice(0, MAX_NOTE) };
}

// A bay is out of service when its latest fault-or-repair entry is a fault.
export function bayStatus(entries, bays) {
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  return Array.from({ length: bays }, (_, i) => {
    const mine = sorted.filter((e) => e.bay === i + 1);
    const lastFix = mine.filter((e) => e.kind !== 'service').at(-1) || null;
    return { bay: i + 1, status: lastFix?.kind === 'fault' ? 'fault' : 'ok', last: mine.at(-1) || null };
  });
}

export const faultBays = (entries, bays) => bayStatus(entries, bays).filter((b) => b.status === 'fault').length;

// `to` is exclusive.
export function maintenanceCost(entries, from, to) {
  return entries.filter((e) => e.at >= from && e.at < to).reduce((s, e) => s + e.costRm, 0);
}
