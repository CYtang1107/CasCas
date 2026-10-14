// Clean request bodies: keep only known fields with sane types and ranges.
import { CHOICE_LABEL } from '../engine/insights.js';

const MODES = ['urgent', 'balanced', 'saver'];
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;
const strOrNull = (v) => v === null || v === undefined || str(v);
const MAX_TIME = 1e14;

export function cleanSession(s) {
  if (!s || typeof s !== 'object') return null;
  const ok = num(s.at, 0, MAX_TIME)
    && /^[RV]\d{1,3}$/.test(String(s.anonId ?? ''))
    && ['resident', 'visitor'].includes(s.role)
    && MODES.includes(s.mode)
    && str(s.chargerId)
    && strOrNull(s.condoId) && strOrNull(s.topPickId) && strOrNull(s.nearestId)
    && Object.hasOwn(CHOICE_LABEL, s.choice)
    && num(s.kWh, 0, 200) && num(s.costRm, 0, 2000) && num(s.nearestCostRm, 0, 2000)
    && num(s.minutesVsNearest, -2000, 2000);
  if (!ok) return null;
  return {
    at: s.at, anonId: s.anonId, role: s.role, mode: s.mode, chargerId: s.chargerId,
    condoId: s.condoId ?? null, topPickId: s.topPickId ?? null, nearestId: s.nearestId ?? null,
    choice: s.choice, kWh: s.kWh, costRm: s.costRm, nearestCostRm: s.nearestCostRm,
    minutesVsNearest: s.minutesVsNearest, overstayMin: 0,
  };
}

export function cleanBooking(b, chargerId) {
  if (!b || typeof b !== 'object' || b.chargerId !== chargerId) return null;
  if (!num(b.start, 0, MAX_TIME) || !num(b.end, 0, MAX_TIME) || b.end <= b.start || b.end - b.start > 864e5) return null;
  return { chargerId, start: b.start, end: b.end };
}

export function cleanCheckin(c) {
  if (!c || typeof c !== 'object' || !str(c.chargerId) || typeof c.ok !== 'boolean' || !num(c.at, 0, MAX_TIME)) return null;
  return { chargerId: c.chargerId, ok: c.ok, note: typeof c.note === 'string' ? c.note.slice(0, 120) : '', at: c.at };
}

export function cleanSharing(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    enabled: s.enabled === true, days: s.days, start: Number(s.start), end: Number(s.end),
    reservedBays: Number(s.reservedBays), visitorPrice: Number(s.visitorPrice),
  };
}
