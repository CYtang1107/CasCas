import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePlate, isValidPlate, formatPlate, canAutoApprove, createPass, upcomingPasses, purgePasses,
} from '../engine/access.js';
import { CONDOS } from '../data/condos.js';

const DAY = 864e5;
const lumina = CONDOS.find((c) => c.id === 'lumina'); // shares weekdays 9–17

test('plates are tidied and checked loosely', () => {
  assert.equal(normalisePlate(' wxy-1234 '), 'WXY1234');
  assert.equal(normalisePlate('vep 88'), 'VEP88');
  for (const ok of ['WXY1234', 'VEP88', 'W1234A', 'PKN1']) assert.ok(isValidPlate(ok), ok);
  for (const bad of ['1234', 'ABC', 'A', 'ABCDEFGHIJ1', 'WXY 1234', '']) assert.ok(!isValidPlate(bad), bad);
});

test('plates are shown with spaces', () => {
  assert.equal(formatPlate('WXY1234'), 'WXY 1234');
  assert.equal(formatPlate('VEP88'), 'VEP 88');
  assert.equal(formatPlate('W1234A'), 'W 1234 A');
  assert.equal(formatPlate('A1B2'), 'A1B2'); // unusual shape left as typed
});

test('auto-approve only while the condo is sharing', () => {
  assert.equal(canAutoApprove(lumina, new Date(2026, 9, 21, 11)), true);  // Wed 11 AM
  assert.equal(canAutoApprove(lumina, new Date(2026, 9, 21, 20)), false); // Wed 8 PM
  assert.equal(canAutoApprove(lumina, new Date(2026, 9, 24, 11)), false); // Saturday
  assert.equal(canAutoApprove({ ...lumina, sharing: { ...lumina.sharing, enabled: false } }, new Date(2026, 9, 21, 11)), false);
  assert.equal(canAutoApprove(null, new Date()), false);
});

test('a pass covers the charge, rounded up to 30 minutes, at least an hour', () => {
  const start = new Date(2026, 9, 21, 11).getTime();
  const a = createPass({ id: 'p1', condoId: 'lumina', chargerId: 'cs-lumina', plate: 'WXY1234', slotStart: start, minutes: 45, now: start });
  assert.equal(a.slotEnd - a.slotStart, 60 * 60000);
  const b = createPass({ id: 'p2', condoId: 'lumina', chargerId: 'cs-lumina', plate: 'WXY1234', slotStart: start, minutes: 75, now: start });
  assert.equal(b.slotEnd - b.slotStart, 90 * 60000);
  assert.deepEqual(Object.keys(a).sort(), ['chargerId', 'condoId', 'createdAt', 'id', 'plate', 'slotEnd', 'slotStart']);
});

test('expected visitors: this condo, not finished, earliest first', () => {
  const now = 1000 * 60000;
  const p = (id, condoId, slotStart, slotEnd) => ({ id, condoId, slotStart, slotEnd });
  const list = [p('late', 'lumina', now + 120 * 60000, now + 180 * 60000), p('done', 'lumina', now - 120 * 60000, now - 60000),
    p('other', 'serini', now, now + 60000), p('soon', 'lumina', now - 10 * 60000, now + 50 * 60000)];
  assert.deepEqual(upcomingPasses(list, 'lumina', now).map((x) => x.id), ['soon', 'late']);
});

test('passes are deleted 30 days after the slot ends', () => {
  const now = 100 * DAY;
  const list = [{ id: 'old', slotEnd: now - 31 * DAY }, { id: 'recent', slotEnd: now - 29 * DAY }];
  assert.deepEqual(purgePasses(list, now).map((x) => x.id), ['recent']);
});
