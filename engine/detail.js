// Everything the charger detail panel shows, gathered in one place (pure, testable).
import { priceAt, priceNote } from './pricing.js';
import { occupancyAt } from './occupancy.js';
import { isOpenToVisitors } from './sharing.js';
import { waitMinutes } from './score.js';
import { co2AvoidedKg } from './economics.js';

function accessLine(charger, condo, date, isResident) {
  if (charger.siteType !== 'condo' || !condo) return null;
  if (isResident) return 'Your condo bay';
  return isOpenToVisitors(condo, date) ? 'Shared now with visitors' : 'Residents only right now';
}

// "AC 2/4 free": bays not in use (or booked, or out of service) right now.
export function availability(charger, occupancy) {
  const total = charger.bays || 0;
  return { free: Math.max(0, total - Math.ceil(total * Math.min(1, occupancy) - 1e-9)), total };
}

// The driver's own month on this device: sessions, energy, money and CO2 avoided.
export function monthSummary(sessions, date) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  const mine = sessions.filter((s) => s.at >= from && s.at < to);
  const kWh = mine.reduce((t, s) => t + s.kWh, 0);
  return { sessions: mine.length, kWh, paidRm: mine.reduce((t, s) => t + s.costRm, 0), co2Kg: co2AvoidedKg(kWh) };
}

// Every suitable charger for this trip, cheapest first, with the gap to the cheapest.
export function priceComparison(results) {
  const rows = results.map((c) => ({
    id: c.charger.id, name: c.charger.name, operator: c.charger.operator, kind: `${c.charger.type} ${c.charger.kw} kW`,
    price: c.price, priceEstimated: !!c.charger.priceEstimated, cost: c.cost, km: c.km, shared: !!c.isSharedVisit,
  })).sort((a, b) => a.cost - b.cost || a.km - b.km);
  const cheapest = rows.length ? rows[0].cost : 0;
  return rows.map((r) => ({ ...r, vsCheapest: Math.round((r.cost - cheapest) * 100) / 100 }));
}

export function describeCharger({ charger, ranking, condo = null, date, isResident = false, checkins = [] }) {
  const results = ranking?.results || [];
  const idx = results.findIndex((c) => c.charger.id === charger.id);
  const r = idx >= 0 ? results[idx] : null;
  const off = (ranking?.excluded || []).find((x) => x.charger.id === charger.id);

  let verdict;
  if (!(ranking?.kWh > 0)) verdict = 'No charge needed for this trip';
  else if (r) verdict = idx < 3 ? `CasCas pick #${idx + 1}` : `Ranked #${idx + 1} of ${results.length}`;
  else if (off) verdict = `Not suitable now: ${off.reason}`;
  else verdict = 'Not in range of this trip';

  const occupancy = r ? r.occupancy : occupancyAt(charger, date, condo).total;
  return {
    id: charger.id,
    name: charger.name,
    address: charger.address || '',
    operator: charger.operator,
    type: charger.type,
    kw: charger.kw,
    connectors: charger.connectors,
    bays: charger.bays,
    pilot: !!charger.pilot,
    faultBays: charger.faultBays || 0,
    live: charger.live || null,
    siteType: charger.siteType,
    highway: !!charger.highway,
    priceNow: r ? r.price : priceAt(charger, date, condo, isResident),
    priceEstimated: !!charger.priceEstimated,
    priceNote: priceNote(charger, date, condo),
    occupancyPct: Math.round(occupancy * 100),
    waitMin: Math.round(r ? r.waitMin : waitMinutes(occupancy)),
    reliabilityPct: Math.round(charger.reliability * 100),
    checkinCount: checkins.length,
    recentCheckins: [...checkins].sort((a, b) => b.at - a.at).slice(0, 3),
    access: accessLine(charger, condo, date, isResident),
    rank: r ? idx + 1 : null,
    verdict,
    reasons: r ? r.reasons : [],
    bookable: !!r,
    trip: r ? { cost: r.cost, kWh: r.deliveredKwh, addedKm: r.addedKm, walkMin: r.walkMin, detourMin: r.detourMin, full: r.full } : null,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${charger.lat},${charger.lng}`,
  };
}
