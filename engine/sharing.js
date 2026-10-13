import { isWeekend } from '../data/tariff.js';

const DAYS = ['weekdays', 'weekends', 'all'];

export function isOpenToVisitors(condo, date) {
  const s = condo.sharing;
  if (!s || !s.enabled) return false;
  const weekend = isWeekend(date);
  if (s.days === 'weekdays' && weekend) return false;
  if (s.days === 'weekends' && !weekend) return false;
  const h = date.getHours() + date.getMinutes() / 60;
  return h >= s.start && h < s.end;
}

// Bays an outside driver could take now. Residents charging use reserved bays first.
export function visitorBaysFree(condo, residentOccupancy, date) {
  if (!isOpenToVisitors(condo, date)) return 0;
  const residentsCharging = Math.ceil(condo.bays * residentOccupancy);
  const held = Math.max(condo.sharing.reservedBays, residentsCharging);
  return Math.max(0, condo.bays - held);
}

export function validateSharing(s, bays) {
  if (!DAYS.includes(s.days)) return 'Choose weekdays, weekends or every day.';
  if (!(s.start >= 0 && s.end <= 24 && s.start < s.end)) return 'Opening time must be before closing time.';
  if (!(Number.isInteger(s.reservedBays) && s.reservedBays >= 0 && s.reservedBays <= bays)) {
    return `Bays kept for residents must be a whole number between 0 and ${bays}.`;
  }
  if (!(s.visitorPrice >= 0.5 && s.visitorPrice <= 3)) return 'Visitor price must be between RM0.50 and RM3.00 per kWh.';
  return null;
}
