// Long-trip planning: which fast chargers to stop at, and how much to charge at each, so the
// driver arrives with at least the battery they asked for. It charges only what the next leg
// needs (never past 80%, where DC charging slows down), so stops stay short.
import { CONST } from '../config.js';
import { distanceKm } from './geo.js';
import { priceAt, round2 } from './pricing.js';

export const HIGHWAY_KMH = 90;
export const HIGHWAY_USE = 1.15;   // highway speeds use about 15% more energy than town driving
export const MIN_STOP_PCT = 10;    // never plan to reach a charger with less than this
export const MAX_CHARGE_PCT = 80;  // DC charging slows sharply above this
export const MARGIN_PCT = 3;       // spare on top of the arrival target
export const AVG_DC_SHARE = 0.85;  // average power over a session vs the peak rate
const MAX_DETOUR_KM = 15;   // or 8% of the distance left, on long trips

export const roadKm = (a, b) => distanceKm(a, b) * CONST.roadFactor;
const minutesFor = (km) => (km / HIGHWAY_KMH) * 60;

export function planTrip({ chargers, car, startPct, arriveMinPct = 20, origin, destination, date }) {
  const kWhPerKm = car.efficiencyKwhPerKm * HIGHWAY_USE;
  const pctFor = (km) => ((km * kWhPerKm) / car.batteryKwh) * 100;
  const fast = chargers.filter((c) => c.type === 'DC' && c.reliability >= 0.6 && c.connectors.some((p) => car.connectors.includes(p)));
  const legs = [];
  const stops = [];
  let pos = { ...origin, name: origin.name || 'Start' };
  let pct = startPct;
  let clock = date.getTime();
  const leg = (from, to, km, startP) => {
    const l = { from: from.name, to: to.name, km, minutes: minutesFor(km), startPct: startP, endPct: startP - pctFor(km) };
    legs.push(l);
    clock += l.minutes * 60000;
    return l;
  };

  for (let i = 0; i < 8; i++) {
    const toDest = roadKm(pos, destination);
    if (pct - pctFor(toDest) >= arriveMinPct - 1e-9) {
      const last = leg(pos, destination, toDest, pct);
      return finish({ ok: true, legs, stops, arrivePct: last.endPct, origin, destination });
    }
    const options = fast
      .filter((c) => !stops.some((s) => s.charger.id === c.id))
      .map((c) => ({ c, km: roadKm(pos, c), left: roadKm(c, destination) }))
      .filter((o) => o.left < toDest - 5 && o.km + o.left - toDest <= Math.max(MAX_DETOUR_KM, toDest * 0.08) && pct - pctFor(o.km) >= MIN_STOP_PCT);
    if (!options.length) {
      // Is there no charger on the way at all, or just none within the battery's reach?
      const onTheWay = fast.some((c) => !stops.some((x) => x.charger.id === c.id) && roadKm(c, destination) < toDest - 5
        && roadKm(pos, c) + roadKm(c, destination) - toDest <= Math.max(MAX_DETOUR_KM, toDest * 0.08));
      const error = onTheWay
        ? `Cannot reach a fast charger towards ${destination.name} from ${pos.name} with ${Math.round(pct)}%. Charge near home first.`
        : `CasSama has no fast chargers on the way to ${destination.name} in its data yet (the demo covers the North–South and East Coast highways). Charge to ${Math.min(100, Math.ceil(pctFor(toDest) + arriveMinPct))}% before you go, or pick a closer stop.`;
      return { ok: false, error, legs, stops };
    }
    // Go as far along as safely possible; a faster charger breaks near-ties.
    options.sort((a, b) => (a.left - b.left) || (b.c.kw - a.c.kw));
    const o = options[0];
    const l = leg(pos, o.c, o.km, pct);
    const arrivePct = l.endPct;
    const departPct = Math.min(MAX_CHARGE_PCT, Math.max(arrivePct, Math.ceil(pctFor(o.left) + arriveMinPct + MARGIN_PCT)));
    const kWh = ((departPct - arrivePct) / 100) * car.batteryKwh;
    const kw = Math.min(o.c.kw, car.dcKw) * AVG_DC_SHARE;
    const minutes = (kWh / kw) * 60;
    const price = priceAt(o.c, new Date(clock));
    stops.push({ charger: o.c, arrivePct, departPct, kWh, minutes, price, cost: round2(kWh * price), at: clock });
    clock += minutes * 60000;
    pos = o.c;
    pct = departPct;
  }
  return { ok: false, error: 'This trip needs too many stops to plan.', legs, stops };
}

export function finish(p) {
  const km = p.legs.reduce((s, l) => s + l.km, 0);
  const driveMin = p.legs.reduce((s, l) => s + l.minutes, 0);
  const chargeMin = p.stops.reduce((s, x) => s + x.minutes, 0);
  const cost = round2(p.stops.reduce((s, x) => s + x.cost, 0));
  const pts = (x) => `${x.lat},${x.lng}`;
  const way = p.stops.map((s) => pts(s.charger)).join('|');
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${pts(p.origin)}&destination=${pts(p.destination)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&travelmode=driving`;
  return { ...p, totals: { km, driveMin, chargeMin, totalMin: driveMin + chargeMin, cost }, directionsUrl };
}
