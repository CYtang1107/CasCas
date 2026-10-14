import { CONST } from '../config.js';
import { distanceKm, driveMinutes, detourMinutes } from './geo.js';
import { priceAt, priceNote } from './pricing.js';
import { isOpenToVisitors, visitorBaysFree } from './sharing.js';
import { occupancyAt } from './occupancy.js';
import { applyBalance } from './balance.js';

export const MODES = {
  urgent: { label: 'Urgent', wCost: 0.1, wTime: 0.6, wRisk: 0.3 },
  balanced: { label: 'Balanced', wCost: 0.4, wTime: 0.4, wRisk: 0.2 },
  saver: { label: 'Saver', wCost: 0.6, wTime: 0.25, wRisk: 0.15 },
};

// Below this reliability a charger is treated as faulty and never recommended.
export const FAULTY = 0.6;

// How long the driver will park. Charging inside the stop costs no time; a charger that cannot add
// MIN_USEFUL_KWH in the stop is dropped (this keeps slow condo AC bays away from quick stops).
export const PARK = { '30m': { min: 30, label: '30 min' }, '2h': { min: 120, label: '2 h' }, '4h': { min: 240, label: '4 h' }, overnight: { min: 720, label: 'overnight' } };
const MIN_USEFUL_KWH = 5;

export function modeFor(batteryPct) {
  if (batteryPct <= 15) return 'urgent';
  if (batteryPct <= 50) return 'balanced';
  return 'saver';
}

export function rangeKm(car, batteryPct) {
  return ((car.batteryKwh * batteryPct) / 100 / car.efficiencyKwhPerKm) * (1 - CONST.rangeBuffer);
}

export function waitMinutes(occupancy) {
  return occupancy < 0.6 ? 0 : ((Math.min(occupancy, 1) - 0.6) / 0.4) * 20;
}

// Blend a charger's base reliability with this device's check-ins (base counts as 20 visits).
export function effectiveReliability(base, checkins = []) {
  const worked = checkins.filter((c) => c.ok).length;
  return (base * 20 + worked) / (20 + checkins.length);
}

export function formatDuration(min) {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function rankChargers({
  chargers, condos = [], car, batteryPct, origin, destination = null, date,
  residentCondoId = null, parkFor = '30m', occupancyFn = occupancyAt,
}) {
  const mode = modeFor(batteryPct);
  const w = MODES[mode];
  const dest = destination || origin;
  const target = Math.min(100, Math.max(CONST.targetPct, batteryPct + 10));
  const kWh = Math.max(0, ((target - batteryPct) / 100) * car.batteryKwh);
  const range = rangeKm(car, batteryPct);
  const condoById = Object.fromEntries(condos.map((c) => [c.id, c]));
  const candidates = [];
  const excluded = [];

  for (const charger of chargers) {
    const condo = charger.condoId ? condoById[charger.condoId] || null : null;
    const isResident = !!condo && condo.id === residentCondoId;
    const km = distanceKm(origin, charger);
    const skip = (reason) => excluded.push({ charger, reason, km });

    if (!charger.connectors.some((p) => car.connectors.includes(p))) { skip('Plug not compatible'); continue; }
    if (charger.reliability < FAULTY) { skip('Many recent problem reports'); continue; }
    if (km > range) { skip(`Out of range (${km.toFixed(1)} km)`); continue; }

    const arrival = new Date(date.getTime() + driveMinutes(km) * 60000);
    const occ = occupancyFn(charger, arrival, condo);
    if (condo && !isResident) {
      if (!isOpenToVisitors(condo, arrival)) { skip('Residents only right now'); continue; }
      if (visitorBaysFree(condo, occ.resident, arrival) <= 0) { skip('No visitor bays free'); continue; }
    }

    const power = charger.type === 'DC' ? Math.min(charger.kw, car.dcKw) : Math.min(charger.kw, car.acKw);
    const chargeMin = (kWh / power) * 60;
    const park = PARK[parkFor] || PARK['30m'];
    const deliveredKwh = Math.min(kWh, (power * park.min) / 60);
    if (kWh > 0 && deliveredKwh < Math.min(kWh, MIN_USEFUL_KWH)) { skip(`Too slow for a ${park.label} stop`); continue; }
    const price = priceAt(charger, arrival, condo, isResident);
    const detourMin = detourMinutes(origin, charger, dest);
    const waitMin = waitMinutes(occ.total);
    candidates.push({
      charger, condo, isResident, isSharedVisit: !!condo && !isResident,
      km, arrival, price, kWh, cost: kWh * price, chargeMin, detourMin, waitMin,
      occupancy: occ.total, reliability: charger.reliability,
      deliveredKwh, full: deliveredKwh >= kWh - 1e-9, parkLabel: park.label,
      addedKm: deliveredKwh / car.efficiencyKwhPerKm,
      timeMin: detourMin + waitMin + Math.max(0, chargeMin - park.min),
    });
  }

  if (candidates.length) {
    const nCost = normaliser(candidates.map((c) => c.cost));
    const nTime = normaliser(candidates.map((c) => c.timeMin));
    for (const c of candidates) {
      c.score = w.wCost * nCost(c.cost) + w.wTime * nTime(c.timeMin) + w.wRisk * (1 - c.reliability);
      c.reasons = reasonsFor(c, target);
    }
    candidates.sort((a, b) => a.score - b.score);
  }
  const { results, note } = applyBalance(candidates, mode);
  return { mode, target, kWh, results, excluded, balanceNote: note };
}

function normaliser(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (v) => (hi === lo ? 0 : (v - lo) / (hi - lo));
}

function reasonsFor(c, target) {
  const kWh = c.full ? c.kWh : c.deliveredKwh;
  const r = [`RM${(kWh * c.price).toFixed(2)} for ${Math.round(kWh)} kWh`];
  r.push(c.detourMin < 1 ? 'On your way' : `+${Math.round(c.detourMin)} min detour`);
  if (c.waitMin >= 1) r.push(`~${Math.round(c.waitMin)} min wait`);
  if (c.kWh > 0) r.push(c.full ? `${formatDuration(c.chargeMin)} to ${target}%` : `+${Math.round(c.addedKm)} km in your ${c.parkLabel} stop`);
  r.push(`${Math.round(c.reliability * 100)}% reliable`);
  const note = priceNote(c.charger, c.arrival, c.condo);
  if (note) r.push(note);
  if (c.isSharedVisit) r.push('Shared condo bay');
  if (c.isResident) r.push('Your condo bay');
  return r;
}
