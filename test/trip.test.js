import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, roadKm } from '../engine/trip.js';
import { HIGHWAY_CHARGERS, TRIP_PLACES } from '../data/trips.js';
import { CARS } from '../data/cars.js';
import { parseRequest } from '../engine/assistant.js';
import { PLACES } from '../data/places.js';

const KL = { lat: 3.2165, lng: 101.7250 };
const place = (id) => TRIP_PLACES.find((p) => p.id === id);
const car = (id) => CARS.find((c) => c.id === id);
const plan = (opts) => planTrip({ chargers: HIGHWAY_CHARGERS, origin: KL, date: new Date(2026, 9, 21, 9), arriveMinPct: 20, ...opts });

test('KL to Melaka is about 165 km by road', () => {
  const km = roadKm(KL, place('melaka'));
  assert.ok(km > 150 && km < 180, String(km));
});

test('a full enough battery needs no stop', () => {
  const p = plan({ car: car('emas7'), startPct: 90, destination: place('melaka') });
  assert.equal(p.ok, true);
  assert.equal(p.stops.length, 0);
  assert.ok(p.arrivePct >= 20);
  assert.equal(p.legs.length, 1);
});

test('one short DC stop, charging only what is needed to arrive with the target', () => {
  const p = plan({ car: car('emas5'), startPct: 50, destination: place('melaka') });
  assert.equal(p.ok, true);
  assert.equal(p.stops.length, 1);
  const s = p.stops[0];
  assert.ok(s.charger.type === 'DC');
  assert.ok(s.arrivePct >= 10, `arrives at the charger with ${s.arrivePct}%`);
  assert.ok(s.departPct <= 80);
  assert.ok(s.minutes < 40, `${s.minutes} min`);
  assert.ok(p.arrivePct >= 20 && p.arrivePct <= 30, `arrives with ${p.arrivePct}%`);
  assert.equal(p.legs.length, 2);
  assert.ok(Math.abs(p.totals.km - p.legs.reduce((a, l) => a + l.km, 0)) < 1e-6);
  assert.ok(p.totals.totalMin > p.totals.driveMin);
  assert.ok(p.totals.cost > 0);
});

test('a long trip on a small battery makes several stops, each one further along', () => {
  const p = plan({ car: car('emas5'), startPct: 40, destination: place('jb') });
  assert.equal(p.ok, true);
  assert.ok(p.stops.length >= 2, String(p.stops.length));
  const toGo = p.stops.map((s) => roadKm(s.charger, place('jb')));
  for (let i = 1; i < toGo.length; i++) assert.ok(toGo[i] < toGo[i - 1]);
  assert.ok(p.arrivePct >= 20);
});

test('when no charger is reachable it says so', () => {
  const p = plan({ car: car('emas5'), startPct: 6, destination: place('penang') });
  assert.equal(p.ok, false);
  assert.match(p.error, /reach/i);
});

test('Ask CasCas understands a trip and the arrival target', () => {
  const r = parseRequest('Atto 3 at 71%, going to Melaka, arrive with 23%', { cars: CARS, places: [...PLACES, ...TRIP_PLACES] });
  assert.equal(r.set.battery, 71);
  assert.equal(r.set.placeId, 'melaka');
  assert.equal(r.set.arriveMin, 23);
  assert.ok(r.understood.includes('Arrive with at least 23%'));
  const r2 = parseRequest('keep 30% when I get to Ipoh, battery 80%', { cars: CARS, places: [...PLACES, ...TRIP_PLACES] });
  assert.equal(r2.set.battery, 80);
  assert.equal(r2.set.arriveMin, 30);
  assert.equal(r2.set.placeId, 'ipoh');
});
