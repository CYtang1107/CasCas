import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationsFromSearch, parseAvailability, parseTtRoute, parseIncidents, incidentsNear, attachLive, INCIDENT_KINDS } from '../engine/tomtom.js';

const search = { results: [
  { id: 'a1', poi: { name: 'ChargeN Go', brands: [{ name: 'ChargeN Go' }] }, position: { lat: 3.205468, lon: 101.719957 },
    chargingPark: { connectors: [{ connectorType: 'IEC62196Type2Outlet', ratedPowerKW: 7, currentType: 'AC1' }, { connectorType: 'IEC62196Type2Outlet', ratedPowerKW: 7, currentType: 'AC1' }] },
    dataSources: { chargingAvailability: { id: 'av-1' } } },
  { id: 'a2', poi: { name: 'AEON DC', brands: [] }, position: { lat: 3.21, lon: 101.73 },
    chargingPark: { connectors: [{ connectorType: 'IEC62196Type2CCS', ratedPowerKW: 60, currentType: 'DC' }, { connectorType: 'Chademo', ratedPowerKW: 50, currentType: 'DC' }] } },
  { id: 'a3', poi: { name: 'No plugs' }, position: { lat: 3.2, lon: 101.7 }, chargingPark: { connectors: [] } },
] };

test('EV stations become chargers: type, top power, plugs, bays and the availability id', () => {
  const [s1, s2] = stationsFromSearch(search);
  assert.equal(stationsFromSearch(search).length, 2);
  assert.deepEqual([s1.id, s1.type, s1.kw, s1.bays, s1.availabilityId, s1.operator], ['tt-a1', 'AC', 7, 2, 'av-1', 'ChargeN Go']);
  assert.deepEqual(s1.connectors, ['Type2']);
  assert.deepEqual([s2.type, s2.kw, s2.operator], ['DC', 60, 'Unknown operator']);
  assert.deepEqual(s2.connectors, ['CCS2', 'CHAdeMO']);
  assert.equal(s2.availabilityId, null);
});

test('availability adds up every connector', () => {
  const a = parseAvailability({ connectors: [
    { type: 'IEC62196Type2Outlet', total: 2, availability: { current: { available: 1, occupied: 1, reserved: 0, unknown: 0, outOfService: 0 } } },
    { type: 'IEC62196Type2CCS', total: 1, availability: { current: { available: 0, occupied: 0, reserved: 0, unknown: 0, outOfService: 1 } } },
  ] });
  assert.deepEqual(a, { total: 3, available: 1, occupied: 1, outOfService: 1, unknown: 0 });
  assert.equal(parseAvailability(null), null);
});

test('live availability attaches to a charger within 150 m; others are added as new chargers', () => {
  const chargers = [{ id: 'ocm-1', name: 'Taman Melati', lat: 3.20550, lng: 101.71996, type: 'AC', bays: 2 }, { id: 'far', lat: 3.3, lng: 101.8, type: 'AC', bays: 2 }];
  const stations = [
    { id: 'tt-a1', lat: 3.205468, lng: 101.719957, type: 'AC', live: { total: 2, available: 1, occupied: 1, outOfService: 0, unknown: 0 } },
    { id: 'tt-a9', lat: 3.25, lng: 101.75, type: 'DC', live: { total: 1, available: 1, occupied: 0, outOfService: 0, unknown: 0 } },
    { id: 'tt-x', lat: 3.26, lng: 101.76, type: 'DC', live: null },
  ];
  const out = attachLive(chargers, stations);
  const m = out.find((c) => c.id === 'ocm-1');
  assert.equal(m.liveAvail.available, 1);
  assert.equal(out.find((c) => c.id === 'far').liveAvail, undefined);
  assert.ok(out.some((c) => c.id === 'tt-a9' && c.liveAvail.available === 1));
  assert.ok(!out.some((c) => c.id === 'tt-x'), 'stations without live data are not added');
});

const route = { routes: [{
  summary: { lengthInMeters: 12662, travelTimeInSeconds: 880, trafficDelayInSeconds: 120, noTrafficTravelTimeInSeconds: 760 },
  legs: [{ summary: { lengthInMeters: 12662, travelTimeInSeconds: 880 }, points: [{ latitude: 3.2164, longitude: 101.7248 }, { latitude: 3.2, longitude: 101.72 }, { latitude: 3.1579, longitude: 101.7123 }] }],
  sections: [{ startPointIndex: 0, endPointIndex: 1, sectionType: 'TRAFFIC', magnitudeOfDelay: 3, delayInSeconds: 120, simpleCategory: 'JAM' }],
  guidance: { instructions: [{ message: 'Leave from Jalan Tumbuhan', routeOffsetInMeters: 0 }, { message: 'Turn right onto Jalan Genting Kelang', routeOffsetInMeters: 910 }, { message: 'You have arrived', routeOffsetInMeters: 12662 }] },
}] };

test('TomTom routes carry live traffic: delay, jam sections and steps', () => {
  const [r] = parseTtRoute(route);
  assert.equal(r.km, 12.7);
  assert.equal(r.minutes, 15);
  assert.equal(r.delayMin, 2);
  assert.equal(r.live, true);
  assert.deepEqual(r.coords[0], [3.2164, 101.7248]);
  assert.deepEqual(r.traffic, [{ from: 0, to: 1, level: 3 }]);
  assert.equal(r.legs[0].steps[1].text, 'Turn right onto Jalan Genting Kelang');
  assert.equal(r.legs[0].steps[1].km, 0.91);
  assert.deepEqual(parseTtRoute({}), []);
});

const incidents = { incidents: [
  { type: 'Feature', properties: { id: 'i1', iconCategory: 9, magnitudeOfDelay: 0, from: 'Jalan Elmo', to: 'Jalan Budi', delay: 68, events: [{ description: 'Roadworks' }] },
    geometry: { type: 'LineString', coordinates: [[101.6492, 3.1175], [101.6494, 3.1173]] } },
  { type: 'Feature', properties: { id: 'i2', iconCategory: 6, magnitudeOfDelay: 3, from: 'E1', delay: 600, events: [{ description: 'Stationary traffic' }] },
    geometry: { type: 'Point', coordinates: [101.72, 3.20] } },
] };

test('incidents get a kind, a place and a delay', () => {
  const [a, b] = parseIncidents(incidents);
  assert.deepEqual([a.kind, a.label, a.lat, a.lng, a.delayMin], ['roadworks', 'Roadworks', 3.1175, 101.6492, 1]);
  assert.equal(a.where, 'Jalan Elmo → Jalan Budi');
  assert.equal(b.kind, 'jam');
  assert.equal(INCIDENT_KINDS[8], 'closed');
});

test('incidents near a route are the ones within a few hundred metres of it', () => {
  const list = parseIncidents(incidents);
  const near = incidentsNear(list, [[3.2164, 101.7248], [3.2, 101.72], [3.1579, 101.7123]], 400);
  assert.deepEqual(near.map((i) => i.id), ['i2']);
});
