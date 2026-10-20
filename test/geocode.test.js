import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoton, localMatches, isTrip, photonUrl } from '../engine/geocode.js';

test('Photon results become places with a readable label', () => {
  const json = { features: [
    { geometry: { coordinates: [102.2501, 2.1896] }, properties: { name: 'Melaka', state: 'Melaka', country: 'Malaysia', osm_value: 'city' } },
    { geometry: { coordinates: [101.6, 3.1] }, properties: { name: 'The Starling', street: 'Jalan SS 21/37', city: 'Petaling Jaya', state: 'Selangor', country: 'Malaysia' } },
    { geometry: { coordinates: [101.6, 3.1] }, properties: { country: 'Malaysia' } },
  ] };
  const r = parsePhoton(json);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: 'Melaka', sub: 'Melaka, Malaysia', lat: 2.1896, lng: 102.2501, source: 'search' });
  assert.equal(r[1].sub, 'Jalan SS 21/37, Petaling Jaya, Selangor');
  assert.deepEqual(parsePhoton(null), []);
});

test('the search URL is limited to Malaysia and leans towards where you are', () => {
  const u = new URL(photonUrl('KL East Mall', { lat: 3.2165, lng: 101.7262 }));
  assert.equal(u.hostname, 'photon.komoot.io');
  assert.equal(u.searchParams.get('q'), 'KL East Mall');
  assert.equal(u.searchParams.get('lat'), '3.22');
  assert.equal(u.searchParams.get('lon'), '101.73');
  assert.ok(u.searchParams.get('bbox'));
});

test('local places match by any word, start-of-name first', () => {
  const places = [{ id: 'klem', name: 'KL East Mall' }, { id: 'klcc', name: 'KLCC' }, { id: 'melaka', name: 'Melaka' }, { id: 'x', name: 'Mall of KL' }];
  assert.deepEqual(localMatches('mel', places).map((p) => p.id), ['melaka']);
  assert.deepEqual(localMatches('kl', places).map((p) => p.id), ['klem', 'klcc', 'x']);
  assert.deepEqual(localMatches('', places), []);
});

test('a trip is anything more than about 40 km by road', () => {
  const kl = { lat: 3.2165, lng: 101.725 };
  assert.equal(isTrip(kl, { lat: 2.1896, lng: 102.2501 }), true); // Melaka
  assert.equal(isTrip(kl, { lat: 3.1579, lng: 101.7123 }), false); // KLCC
});
