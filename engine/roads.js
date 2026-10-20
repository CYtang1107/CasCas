// Real roads: routes from OSRM (OpenStreetMap routing; free demo server, fair use), turned into
// km, minutes, map shapes and readable steps. Plus a typical-traffic estimate for Klang Valley
// rush hours, clearly an estimate: OSRM times assume free-flowing roads.
import { HIGHWAY_USE, MIN_STOP_PCT, MAX_CHARGE_PCT, MARGIN_PCT, AVG_DC_SHARE, finish } from './trip.js';
import { priceAt, round2 } from './pricing.js';

export function osrmUrl(points, { alternatives = false, steps = false } = {}) {
  const path = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const u = new URL(`https://router.project-osrm.org/route/v1/driving/${path}`);
  u.searchParams.set('overview', 'full');
  u.searchParams.set('geometries', 'geojson');
  u.searchParams.set('alternatives', String(alternatives));
  u.searchParams.set('steps', String(steps));
  return u.toString();
}

const km1 = (m) => Math.round(m / 100) / 10;

export function parseOsrm(json) {
  if (json?.code !== 'Ok') return [];
  return (json.routes || []).map((r) => ({
    km: km1(r.distance),
    minutes: Math.round(r.duration / 60),
    coords: (r.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    legs: (r.legs || []).map((l) => ({ km: km1(l.distance), minutes: Math.round(l.duration / 60), steps: l.steps || [] })),
  }));
}

export function stepText(step) {
  const m = step.maneuver || {};
  const road = step.name || step.ref || '';
  const onto = road ? ` onto ${road}` : '';
  const dir = m.modifier ? ` ${m.modifier}` : '';
  switch (m.type) {
    case 'depart': return road ? `Head off on ${road}` : 'Head off';
    case 'arrive': return 'Arrive';
    case 'turn': case 'end of road': return `Turn${dir}${onto}`;
    case 'on ramp': return `Take the ramp${dir}${onto}`;
    case 'off ramp': return `Take the exit${dir}${onto}`;
    case 'merge': return `Merge${dir}${onto}`;
    case 'fork': return `Keep${dir}${onto}`;
    case 'roundabout': case 'rotary': return `At the roundabout, take the exit${onto}`;
    default: return road ? `Continue on ${road}` : 'Continue';
  }
}

// Klang Valley weekday rush hours, from common experience; not live data.
export function typicalTraffic(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  let factor = 1;
  if (!weekend && ((h >= 7 && h < 9.5) || (h >= 17 && h < 20))) factor = 1.5;
  else if (!weekend && ((h >= 9.5 && h < 10.5) || (h >= 12 && h < 14) || (h >= 16 && h < 17))) factor = 1.2;
  else if (weekend && h >= 11 && h < 20) factor = 1.15;
  else if (h >= 22 || h < 6) factor = 1;
  else factor = 1.05;
  return { factor, level: factor >= 1.4 ? 'Heavy' : factor >= 1.12 ? 'Moderate' : 'Light' };
}

// Re-run the battery maths of a plan with the real road length and time of each leg.
export function refineTrip(plan, roadLegs, car, arriveMinPct, date) {
  const kWhPerKm = car.efficiencyKwhPerKm * HIGHWAY_USE;
  const pctFor = (km) => ((km * kWhPerKm) / car.batteryKwh) * 100;
  let pct = plan.legs[0].startPct;
  let clock = date.getTime();
  let shortfall = false;
  const legs = [];
  const stops = [];
  plan.legs.forEach((l, i) => {
    const road = roadLegs[i];
    const leg = { ...l, km: road.km, minutes: road.minutes, startPct: pct, endPct: pct - pctFor(road.km) };
    legs.push(leg);
    clock += leg.minutes * 60000;
    pct = leg.endPct;
    const s = plan.stops[i];
    if (!s) return;
    if (pct < MIN_STOP_PCT) shortfall = true;
    const next = roadLegs[i + 1];
    const departPct = Math.min(MAX_CHARGE_PCT, Math.max(pct, Math.ceil(pctFor(next.km) + arriveMinPct + MARGIN_PCT)));
    const kWh = Math.max(0, ((departPct - pct) / 100) * car.batteryKwh);
    const minutes = (kWh / (Math.min(s.charger.kw, car.dcKw) * AVG_DC_SHARE)) * 60;
    const price = priceAt(s.charger, new Date(clock));
    stops.push({ ...s, arrivePct: pct, departPct, kWh, minutes, price, cost: round2(kWh * price), at: clock });
    clock += minutes * 60000;
    pct = departPct;
  });
  if (pct < arriveMinPct - 0.5) shortfall = true;
  return { ...finish({ ...plan, legs, stops, arrivePct: pct }), byRoad: true, shortfall };
}
