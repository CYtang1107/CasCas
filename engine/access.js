// Visitor access to shared condo bays. Approval is automatic while the condo is sharing.
import { isOpenToVisitors } from './sharing.js';

export const PASS_KEEP_DAYS = 30;

export function normalisePlate(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

// Loose check: 2–10 letters and digits with at least one of each (e.g. WXY1234, VEP88).
export function isValidPlate(p) {
  return /^[A-Z0-9]{2,10}$/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
}

export function formatPlate(p) {
  const m = /^([A-Z]+)(\d+)([A-Z]*)$/.exec(p);
  return m ? [m[1], m[2], m[3]].filter(Boolean).join(' ') : p;
}

export function canAutoApprove(condo, date) {
  return !!condo && isOpenToVisitors(condo, date);
}

export function createPass({ id, condoId, chargerId, plate, slotStart, minutes, now }) {
  const length = Math.max(60, Math.ceil(minutes / 30) * 30);
  return { id, condoId, chargerId, plate, slotStart, slotEnd: slotStart + length * 60000, createdAt: now };
}

export function upcomingPasses(passes, condoId, nowMs) {
  return passes.filter((p) => p.condoId === condoId && p.slotEnd > nowMs).sort((a, b) => a.slotStart - b.slotStart);
}

export function purgePasses(passes, nowMs) {
  return passes.filter((p) => nowMs - p.slotEnd < PASS_KEEP_DAYS * 864e5);
}
