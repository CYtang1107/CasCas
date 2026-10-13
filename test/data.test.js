import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARGERS } from '../data/chargers.js';
import { CONDOS } from '../data/condos.js';
import { CARS } from '../data/cars.js';
import { PLACES, CLOCK_PRESETS } from '../data/places.js';
import { baseOccupancy, visitorDemand } from '../data/demand.js';

test('every condo has exactly one condo charger site with matching bays', () => {
  for (const c of CONDOS) {
    const sites = CHARGERS.filter((ch) => ch.condoId === c.id);
    assert.equal(sites.length, 1, c.id);
    assert.equal(sites[0].bays, c.bays, c.id);
    assert.equal(sites[0].siteType, 'condo', c.id);
  }
});

test('charger ids are unique and fields are valid', () => {
  assert.equal(new Set(CHARGERS.map((c) => c.id)).size, CHARGERS.length);
  assert.ok(CHARGERS.length >= 20);
  for (const ch of CHARGERS) {
    assert.ok(['AC', 'DC'].includes(ch.type), ch.id);
    assert.ok(ch.connectors.length > 0, ch.id);
    assert.ok(ch.reliability > 0 && ch.reliability <= 1, ch.id);
    assert.ok(['condo', 'mall', 'public'].includes(ch.siteType), ch.id);
    if (ch.siteType !== 'condo') assert.ok(ch.price > 0, ch.id);
  }
});

test('occupancy stays within 0..1 for every charger, hour, weekday and weekend', () => {
  for (const ch of CHARGERS) {
    for (const day of [19, 24]) {
      for (let h = 0; h < 24; h++) {
        const v = baseOccupancy(ch, new Date(2026, 9, day, h));
        assert.ok(v >= 0 && v <= 1, `${ch.id} day ${day} h ${h}: ${v}`);
      }
    }
  }
  for (let h = 0; h < 24; h++) {
    const v = visitorDemand(new Date(2026, 9, 21, h));
    assert.ok(v >= 0 && v <= 1);
  }
});

test('cars, places and clock presets are usable', () => {
  for (const c of CARS) assert.ok(c.batteryKwh > 0 && c.acKw > 0 && c.dcKw > 0 && c.efficiencyKwhPerKm > 0, c.id);
  assert.ok(PLACES.some((p) => p.id === 'here'));
  assert.equal(CLOCK_PRESETS[0].date().getDay(), 3); // Wednesday default
});
