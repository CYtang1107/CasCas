import { test } from 'node:test';
import assert from 'node:assert/strict';
import { osrmUrl, parseOsrm, stepText, typicalTraffic, refineTrip } from '../engine/roads.js';
import { planTrip } from '../engine/trip.js';
import { HIGHWAY_CHARGERS, TRIP_PLACES } from '../data/trips.js';
import { CARS } from '../data/cars.js';

const KL = { lat: 3.2165, lng: 101.725, name: 'KL East' };

test('the OSRM URL lists points as lng,lat and asks for road shapes', () => {
  const u = new URL(osrmUrl([KL, { lat: 2.1896, lng: 102.2501 }], { alternatives: true, steps: true }));
  assert.equal(u.hostname, 'router.project-osrm.org');
  assert.ok(u.pathname.endsWith('/101.72500,3.21650;102.25010,2.18960'));
  assert.equal(u.searchParams.get('geometries'), 'geojson');
  assert.equal(u.searchParams.get('alternatives'), 'true');
  assert.equal(u.searchParams.get('steps'), 'true');
});

const osrm = { code: 'Ok', routes: [
  { distance: 151800, duration: 7320, geometry: { coordinates: [[101.725, 3.2165], [102.25, 2.19]] },
    legs: [{ distance: 151800, duration: 7320, steps: [
      { distance: 500, maneuver: { type: 'depart' }, name: 'Jalan Melati' },
      { distance: 1200, maneuver: { type: 'turn', modifier: 'left' }, name: 'Jalan Genting Klang' },
      { distance: 150000, maneuver: { type: 'on ramp', modifier: 'slight right' }, name: '', ref: 'E2' },
      { distance: 0, maneuver: { type: 'arrive' }, name: '' }] }] },
  { distance: 164200, duration: 7860, geometry: { coordinates: [[101.725, 3.2165], [102.25, 2.19]] }, legs: [{ distance: 164200, duration: 7860, steps: [] }] },
] };

test('OSRM routes become km, minutes, [lat, lng] shapes and legs', () => {
  const [best, alt] = parseOsrm(osrm);
  assert.equal(best.km, 151.8);
  assert.equal(best.minutes, 122);
  assert.deepEqual(best.coords[0], [3.2165, 101.725]);
  assert.equal(best.legs.length, 1);
  assert.equal(best.legs[0].steps.length, 4);
  assert.equal(alt.km, 164.2);
  assert.deepEqual(parseOsrm({ code: 'NoRoute' }), []);
});

test('steps read like directions', () => {
  const s = osrm.routes[0].legs[0].steps;
  assert.equal(stepText(s[0]), 'Head off on Jalan Melati');
  assert.equal(stepText(s[1]), 'Turn left onto Jalan Genting Klang');
  assert.equal(stepText(s[2]), 'Take the ramp slight right onto E2');
  assert.equal(stepText(s[3]), 'Arrive');
});

test('typical traffic: KL rush hours are slower than a weekday mid-morning or Sunday night', () => {
  const rush = typicalTraffic(new Date(2026, 9, 20, 18, 0));
  const calm = typicalTraffic(new Date(2026, 9, 21, 11, 0));
  const night = typicalTraffic(new Date(2026, 9, 25, 23, 0));
  assert.ok(rush.factor > calm.factor && calm.factor >= night.factor);
  assert.equal(rush.level, 'Heavy');
  assert.equal(night.level, 'Light');
});

test('a trip is re-checked on real roads: leg lengths, charge amounts and arrival follow the road km', () => {
  const car = CARS.find((c) => c.id === 'emas5');
  const plan = planTrip({ chargers: HIGHWAY_CHARGERS, car, startPct: 50, arriveMinPct: 20, origin: KL, destination: TRIP_PLACES.find((p) => p.id === 'melaka'), date: new Date(2026, 9, 21, 9) });
  assert.equal(plan.stops.length, 1);
  const roads = plan.legs.map((l) => ({ km: l.km * 0.9, minutes: l.minutes * 0.95 })); // roads a bit shorter than the estimate
  const r = refineTrip(plan, roads, car, 20, new Date(2026, 9, 21, 9));
  assert.equal(r.byRoad, true);
  assert.ok(Math.abs(r.totals.km - plan.totals.km * 0.9) < 1e-6);
  assert.ok(r.stops[0].arrivePct > plan.stops[0].arrivePct, 'shorter first leg, more battery left');
  assert.ok(r.stops[0].departPct <= plan.stops[0].departPct, 'shorter last leg, less charge needed');
  assert.ok(r.arrivePct >= 20);
  assert.equal(r.shortfall, false);
});

test('if the roads are much longer than estimated, the plan says it falls short', () => {
  const car = CARS.find((c) => c.id === 'emas5');
  const plan = planTrip({ chargers: HIGHWAY_CHARGERS, car, startPct: 50, arriveMinPct: 20, origin: KL, destination: TRIP_PLACES.find((p) => p.id === 'melaka'), date: new Date(2026, 9, 21, 9) });
  const r = refineTrip(plan, plan.legs.map((l) => ({ km: l.km * 1.6, minutes: l.minutes * 1.6 })), car, 20, new Date(2026, 9, 21, 9));
  assert.equal(r.shortfall, true);
});
