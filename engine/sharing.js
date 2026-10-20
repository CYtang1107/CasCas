import { isWeekend } from '../data/tariff.js';
import { baseOccupancy } from '../data/demand.js';

const DAYS = ['weekdays', 'weekends', 'all'];
export const MODES = ['hours', 'auto'];
// Auto mode lets visitors in only between these hours, whatever the bays say.
export const AUTO_HOURS = [7, 22];
// Plan for 10% more residents than expected, so a busy evening never runs short.
export const AUTO_BUFFER = 0.1;

// Share of the condo's bays residents are expected to use now and over the next 2 hours.
function residentsExpected(condo, date) {
  const site = { id: `cs-${condo.id}`, siteType: 'condo' };
  return Math.min(1, AUTO_BUFFER + Math.max(...[0, 1, 2].map((h) => baseOccupancy(site, new Date(date.getTime() + h * 3600e3)))));
}

export function isOpenToVisitors(condo, date) {
  const s = condo.sharing;
  if (!s || !s.enabled) return false;
  const weekend = isWeekend(date);
  if (s.days === 'weekdays' && weekend) return false;
  if (s.days === 'weekends' && !weekend) return false;
  const h = date.getHours() + date.getMinutes() / 60;
  if (s.mode === 'auto') {
    // Share whenever residents are expected to leave more bays idle than the JMB keeps for them.
    if (h < AUTO_HOURS[0] || h >= AUTO_HOURS[1]) return false;
    // The kept bays are spare on top of the residents expected, so someone arriving home finds one.
    return condo.bays - Math.ceil(condo.bays * residentsExpected(condo, date)) - s.reservedBays > 0;
  }
  return h >= s.start && h < s.end;
}

// Bays an outside driver could take now. Residents charging use reserved bays first.
export function visitorBaysFree(condo, residentOccupancy, date) {
  if (!isOpenToVisitors(condo, date)) return 0;
  const residentsCharging = Math.ceil(condo.bays * residentOccupancy);
  const held = condo.sharing.mode === 'auto'
    ? Math.max(residentsCharging, Math.ceil(condo.bays * residentsExpected(condo, date))) + condo.sharing.reservedBays
    : Math.max(condo.sharing.reservedBays, residentsCharging);
  return Math.max(0, condo.bays - held);
}

export function validateSharing(s, bays) {
  if (s.mode !== undefined && !MODES.includes(s.mode)) return 'Sharing mode must be fixed hours or auto.';
  if (!DAYS.includes(s.days)) return 'Choose weekdays, weekends or every day.';
  if (!(s.start >= 0 && s.end <= 24 && s.start < s.end)) return 'Opening time must be before closing time.';
  if (!(Number.isInteger(s.reservedBays) && s.reservedBays >= 0 && s.reservedBays <= bays)) {
    return `Bays kept for residents must be a whole number between 0 and ${bays}.`;
  }
  if (!(s.visitorPrice >= 0.5 && s.visitorPrice <= 3)) return 'Visitor price must be between RM0.50 and RM3.00 per kWh.';
  return null;
}
