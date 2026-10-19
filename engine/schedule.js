// Smart scheduling: price and how busy a charger is, hour by hour, so drivers can pick a better time.
import { priceAt } from './pricing.js';
import { occupancyAt } from './occupancy.js';
import { isOpenToVisitors, visitorBaysFree } from './sharing.js';
import { round2 } from './pricing.js';

// One window per hour: the first starts at `from`, the rest on the hour.
export function chargeWindows({ charger, condo = null, isResident = false, from, hours = 24, kWh, occupancyFn = occupancyAt }) {
  const out = [];
  for (let i = 0; i < hours; i++) {
    const at = i === 0 ? new Date(from) : new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours() + i);
    const occ = occupancyFn(charger, at, condo);
    const visitorOnly = !!condo && charger.siteType === 'condo' && !isResident;
    const open = visitorOnly
      ? isOpenToVisitors(condo, at) && visitorBaysFree(condo, occ.resident, at) > 0
      : occ.total < 1;
    const price = priceAt(charger, at, condo, isResident);
    out.push({ at, price, occupancy: occ.total, open, cost: round2(kWh * price) });
  }
  return out;
}

// The cheapest open hour. At the same price a crowded hour loses, then the earliest wins.
const CROWDED = 0.8;
export function bestWindow(opts) {
  const windows = chargeWindows(opts);
  const now = windows[0];
  const open = windows.filter((w) => w.open);
  if (!open.length) return { now, best: null, savingRm: 0, isNow: false, windows };
  const crowded = (w) => (w.occupancy >= CROWDED ? 1 : 0);
  const best = [...open].sort((a, b) => a.cost - b.cost || crowded(a) - crowded(b) || a.at - b.at)[0];
  const isNow = best === now || (now.open && now.cost <= best.cost && crowded(now) <= crowded(best));
  return { now, best: isNow ? now : best, savingRm: isNow ? 0 : round2(Math.max(0, now.cost - best.cost)), isNow, windows };
}
