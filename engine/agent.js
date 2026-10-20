// The CasSama assistant's agents (pure): each "agent" is a tool the language model may call,
// and every tool runs CasSama's own engines, so numbers come from the engines, never the model.
// Guardrails live here too: what the assistant refuses, and checking that every amount it
// states came from a tool.
import { CARS } from '../data/cars.js';
import { PLACES } from '../data/places.js';
import { TRIP_PLACES, HIGHWAY_CHARGERS } from '../data/trips.js';
import { KNOWLEDGE } from '../data/knowledge.js';
import { rankChargers, formatDuration } from './score.js';
import { planTrip } from './trip.js';
import { bestWindow } from './schedule.js';
import { priceAt, round2 } from './pricing.js';
import { simulateCondoMonth } from './economics.js';
import { searchKnowledge } from './kb.js';
import { isTrip } from './geocode.js';
import { idleWindow } from './cpo.js';

const ALL_PLACES = [...PLACES.filter((p) => p.id !== 'here'), ...TRIP_PLACES];
// Open Charge Map often has names IN CAPITALS; show them in title case.
export const tidyName = (s) => (/[a-z]/.test(String(s)) ? String(s) : String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Dc|Ac|Kl|Lrt|Mrt|Ev|Tnb|Sdp)\b/g, (m) => m.toUpperCase()));
const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

export const TOOLS = [
  fn('find_chargers', 'Recommendation agent: rank chargers near the driver for a charge now, by battery, price, time and reliability. Use for "where should I charge".', {
    battery_pct: { type: 'number', description: 'Battery now, 5 to 100' },
    destination: { type: 'string', description: 'Where they are going nearby (a place name), optional' },
    park_for: { type: 'string', enum: ['30m', '2h', '4h', 'overnight'], description: 'How long they will park' },
    max_price: { type: 'number', description: 'Highest RM per kWh they accept, optional' },
    fast_only: { type: 'boolean' },
    operator: { type: 'string', description: 'Preferred operator, optional' },
  }, ['battery_pct']),
  fn('plan_trip', 'Journey planning agent: plan a long trip with fast-charging stops, charging only what each leg needs.', {
    destination: { type: 'string', description: 'Town or place, e.g. Melaka, Ipoh, Kuantan' },
    battery_pct: { type: 'number' },
    arrive_min_pct: { type: 'number', description: 'Battery to keep on arrival, default 20' },
  }, ['destination', 'battery_pct']),
  fn('best_time', 'Booking agent: find the cheapest open hour in the next 24 hours to charge at one charger.', {
    charger_id: { type: 'string' }, kwh: { type: 'number' },
  }, ['charger_id', 'kwh']),
  fn('estimate_cost', 'Cost estimation agent: kWh times the price at a charger right now.', {
    charger_id: { type: 'string' }, kwh: { type: 'number' },
  }, ['charger_id', 'kwh']),
  fn('condo_revenue', 'Revenue agent: a condo\'s monthly report: charging income, the JMB (30%) and CPO (70%) shares, saving per unit, bay use, and the idle hours when more bays could be shared.', {
    condo_id: { type: 'string', description: 'e.g. lumina, serini' },
  }, ['condo_id']),
  fn('search_knowledge', 'Look up how CasSama works: sharing, votes, fees, tariffs, privacy, trips, income.', {
    query: { type: 'string' },
  }, ['query']),
  fn('propose_booking', 'Offer the driver a button to book a charger. CasSama never books by itself; the driver must tap to confirm.', {
    charger_id: { type: 'string' }, reason: { type: 'string' },
  }, ['charger_id']),
  fn('fill_trip_form', 'Fill the Plan screen with what the driver said, so they can see and adjust it.', {
    battery_pct: { type: 'number' }, destination: { type: 'string' }, car: { type: 'string' },
    park_for: { type: 'string', enum: ['30m', '2h', '4h', 'overnight'] }, arrive_min_pct: { type: 'number' },
  }),
];

export const AGENT_OF = {
  find_chargers: 'Recommendation agent', plan_trip: 'Journey planning agent', best_time: 'Booking agent',
  estimate_cost: 'Cost estimation agent', condo_revenue: 'Revenue agent', search_knowledge: 'Knowledge base',
  propose_booking: 'Booking agent', fill_trip_form: 'Orchestrator',
};

const pct = (v, d) => Math.min(100, Math.max(5, Number.isFinite(Number(v)) ? Number(v) : d));
const findPlace = (name) => {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  return ALL_PLACES.find((p) => p.name.toLowerCase() === q || p.id === q || (p.words || []).includes(q))
    || ALL_PLACES.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())) || null;
};
const findCar = (name, fallback) => {
  const q = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return CARS.find((c) => q && (c.id === q || c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))) || fallback;
};

// env: { world: { chargers, condos }, car, origin, clock, homeId, parkFor, prefs }
export function runTool(name, args, env) {
  const a = args || {};
  const condoOf = (ch) => env.world.condos.find((c) => c.id === ch.condoId) || null;
  const charger = (id) => [...env.world.chargers, ...HIGHWAY_CHARGERS].find((c) => c.id === id);
  switch (name) {
    case 'find_chargers': {
      const place = findPlace(a.destination);
      const r = rankChargers({
        ...env.world, car: env.car, batteryPct: pct(a.battery_pct, 35), origin: env.origin,
        destination: place && !place.trip ? place : null, date: env.clock, residentCondoId: env.homeId || null,
        parkFor: a.park_for || env.parkFor || '30m',
        prefs: { maxPrice: a.max_price ?? env.prefs?.maxPrice ?? null, fastOnly: a.fast_only ?? env.prefs?.fastOnly ?? false, operator: a.operator ?? env.prefs?.operator ?? null },
      });
      return {
        mode: r.mode, charge_to_pct: r.target, kwh_needed: round2(r.kWh),
        picks: r.results.slice(0, 5).map((c) => ({
          charger_id: c.charger.id, name: tidyName(c.charger.name), operator: c.charger.operator, type: `${c.charger.type} ${c.charger.kw} kW`,
          price_per_kwh: c.price, cost_rm: round2(c.full ? c.cost : c.deliveredKwh * c.price), kwh: round2(c.full ? c.kWh : c.deliveredKwh),
          distance_km: round2(c.km), reasons: c.reasons, shared_condo_bay: c.isSharedVisit, your_condo: c.isResident,
        })),
        not_suitable: r.excluded.slice(0, 4).map((x) => `${x.charger.name}: ${x.reason}`),
      };
    }
    case 'plan_trip': {
      const dest = findPlace(a.destination);
      if (!dest) return { ok: false, error: `I do not know "${a.destination}". Known trips: ${TRIP_PLACES.map((p) => p.name).join(', ')}.` };
      if (!isTrip(env.origin, dest)) return { ok: false, error: `${dest.name} is nearby, so no trip plan is needed; use find_chargers instead.` };
      const t = planTrip({ chargers: [...HIGHWAY_CHARGERS, ...env.world.chargers], car: env.car, startPct: pct(a.battery_pct, 35), arriveMinPct: pct(a.arrive_min_pct, 20), origin: { ...env.origin, name: env.origin.name || 'Start' }, destination: dest, date: env.clock });
      if (!t.ok) return { ok: false, error: t.error };
      return {
        ok: true, destination: dest.name, total_time: formatDuration(t.totals.totalMin), km: Math.round(t.totals.km),
        charging_time: formatDuration(t.totals.chargeMin), charging_cost_rm: t.totals.cost, arrive_pct: Math.round(t.arrivePct),
        stops: t.stops.map((x) => ({ charger_id: x.charger.id, name: tidyName(x.charger.name), arrive_pct: Math.round(x.arrivePct), leave_pct: x.departPct, minutes: Math.round(x.minutes), cost_rm: x.cost })),
        note: 'Distances are estimates; the Plan screen re-checks them on real roads with traffic.',
      };
    }
    case 'best_time': {
      const ch = charger(a.charger_id);
      if (!ch) return { error: 'Unknown charger_id' };
      const condo = condoOf(ch);
      const b = bestWindow({ charger: ch, condo, isResident: !!condo && condo.id === env.homeId, from: env.clock, hours: 24, kWh: Number(a.kwh) || 20 });
      if (!b.best) return { charger: ch.name, open: false, note: 'Not open to you in the next 24 hours.' };
      const when = (d) => d.toLocaleString('en-MY', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      return { charger: ch.name, now_cost_rm: b.now.cost, best_time: when(b.best.at), best_cost_rm: b.best.cost, saving_rm: b.savingRm, now_is_best: b.isNow };
    }
    case 'estimate_cost': {
      const ch = charger(a.charger_id);
      if (!ch) return { error: 'Unknown charger_id' };
      const condo = condoOf(ch);
      const price = priceAt(ch, env.clock, condo, !!condo && condo.id === env.homeId);
      const kwh = Math.max(0, Number(a.kwh) || 0);
      return { charger: ch.name, price_per_kwh: price, kwh, cost_rm: round2(kwh * price) };
    }
    case 'condo_revenue': {
      const condo = env.world.condos.find((c) => c.id === String(a.condo_id || '').toLowerCase()) || env.world.condos.find((c) => c.name.toLowerCase().includes(String(a.condo_id || '').toLowerCase()));
      if (!condo) return { error: `Unknown condo. Known: ${env.world.condos.map((c) => c.id).join(', ')}` };
      const site = env.world.chargers.find((c) => c.condoId === condo.id);
      const sim = simulateCondoMonth(condo, site, new Date(env.clock.getFullYear(), env.clock.getMonth(), 1));
      const r = sim.recovery;
      const idle = idleWindow(condo, site, sim);
      const s = condo.sharing;
      const hour = (h) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
      return {
        condo: condo.name, bays: condo.bays, month_receipts_rm: round2(r.revenue), kwh_delivered: Math.round(r.kWh),
        visitor_kwh_pct: Math.round((sim.kWhSold ? sim.visitorKwh / sim.kWhSold : 0) * 100), bay_use_pct: Math.round(sim.utilisation * 100),
        operating_surplus_rm: round2(r.operatingSurplus), jmb_income_rm: round2(r.jmbIncome), cpo_income_rm: round2(r.partnerIncome),
        jmb_share_pct: Math.round(condo.jmbShare * 100), saving_per_unit_rm: round2(r.perUnit),
        break_even_kwh: r.breakEvenKwh ? Math.round(r.breakEvenKwh) : null,
        sharing: !s.enabled ? 'off' : s.mode === 'auto' ? 'auto (7 AM to 10 PM when residents are not expected)' : `${hour(s.start)} to ${hour(s.end)}, ${s.days}`,
        idle_hours: idle ? { from: hour(idle.start), to: hour(idle.end), residents_use_pct: Math.round(idle.avgUse * 100) } : null,
        idle_already_shared: !!idle && s.enabled && (s.mode === 'auto' || (idle.start >= s.start && idle.end <= s.end)),
        simulated: true,
      };
    }
    case 'search_knowledge':
      return { passages: searchKnowledge(KNOWLEDGE, a.query || '').map(({ id, title, text }) => ({ id, title, text })) };
    case 'propose_booking': {
      const ch = env.world.chargers.find((c) => c.id === a.charger_id);
      if (!ch) return { error: 'Unknown charger_id' };
      return { proposed: true, charger_id: ch.id, name: tidyName(ch.name), note: 'A Book button is shown to the driver; nothing is booked until they tap it.' };
    }
    case 'fill_trip_form': {
      const place = findPlace(a.destination);
      const car = a.car ? findCar(a.car, null) : null;
      return { filled: true, place_id: place?.id || null, car_id: car?.id || null, battery_pct: a.battery_pct != null ? pct(a.battery_pct, 35) : null, park_for: a.park_for || null, arrive_min_pct: a.arrive_min_pct != null ? pct(a.arrive_min_pct, 20) : null };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

// Guardrail on the way in: no payment or account secrets, and a sane length.
export function guardInput(text) {
  const t = String(text || '');
  if (!t.trim()) return { block: true, reply: 'Ask me about charging: where to charge, a trip, prices, or how condo sharing works.' };
  if (t.length > 600) return { block: true, reply: 'That is a long message. Please ask in a sentence or two.' };
  if (/\b(?:\d[ -]?){13,19}\b/.test(t) || /\b(cvv|cvc|card number|kad kredit|password|kata laluan|pin number|online banking)\b/i.test(t)) {
    return { block: true, reply: 'Please don\'t share card numbers, passwords or PINs here. CasSama never takes payments or secrets in chat.' };
  }
  return { block: false };
}

// Guardrail on the way out: every RM amount must come from a tool result or the driver's words.
export function amountsGrounded(reply, sources) {
  const nums = (s) => [...String(s).matchAll(/RM\s?(\d[\d,]*(?:\.\d+)?)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
  const known = new Set();
  for (const src of sources) {
    for (const m of String(src).matchAll(/-?\d+(?:\.\d+)?/g)) {
      const v = Number(m[0]);
      known.add(round2(v).toFixed(2));
      known.add(Math.round(v).toFixed(2));
    }
  }
  const missing = nums(reply).filter((v) => !known.has(round2(v).toFixed(2)));
  return { ok: missing.length === 0, missing };
}

export function systemPrompt({ clock, carName, originName, homeName }) {
  return [
    'You are CasSama, the assistant in a shared EV charging app for Sime Darby Property townships in Malaysia (KL East).',
    'Orchestrate: understand what the driver wants, call the right tools, then answer briefly (2 to 4 short sentences) in plain English, or Malay if they wrote in Malay.',
    'How to write the answer:',
    '- Start with the answer itself, e.g. "Charge at X: RM5.50 for 6 kWh, 2 km away." Then one line on why, and one useful tip if there is one.',
    '- The app shows the top chargers as cards and the Book / Open in Plan buttons under your reply, so do not describe buttons, cards, tools or agents, and do not say "I have put" or "I called".',
    '- Name at most two options. You may use **bold** for the charger name and "- " bullets; no headings, tables or links.',
    '- For a shared condo bay, mention residents come first and the sharing hours if relevant.',
    'Rules you must follow:',
    '- Every price, cost, time, distance and battery figure must come from a tool result in this conversation. Never estimate numbers yourself.',
    '- Use search_knowledge for questions about how CasSama works, and say which fact you used.',
    '- You cannot book or pay. To offer a booking, call propose_booking; the driver confirms with a button.',
    '- Residents come first at condo bays; never suggest getting around sharing hours or resident priority.',
    '- Never ask for or accept card numbers, passwords or PINs.',
    '- Stay on EV charging, trips and CasSama. For anything else, say briefly that you can only help with charging.',
    '- When the driver gives a trip or battery level, also call fill_trip_form so the Plan screen matches.',
    `Context: demo time ${clock.toLocaleString('en-MY', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}; car ${carName}; starting from ${originName}${homeName ? `; lives at ${homeName}` : ''}.`,
  ].join('\n');
}
