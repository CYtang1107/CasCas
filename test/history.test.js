import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateHistory, mulberry32 } from '../engine/history.js';
import { followRate, filterSessions, CHOICE_LABEL } from '../engine/insights.js';
import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';

const DAY = 864e5;
const lumina = CONDOS.find((c) => c.id === 'lumina');
const kenanga = CONDOS.find((c) => c.id === 'kenanga'); // sharing off
const site = (c) => CHARGERS.find((ch) => ch.condoId === c.id);
const end = new Date(2026, 9, 21, 11).getTime();

test('the PRNG is repeatable', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('same condo and end time → identical history', () => {
  assert.deepEqual(simulateHistory(lumina, site(lumina), end), simulateHistory(lumina, site(lumina), end));
});

test('history covers the 182 days before today, sorted, with valid records', () => {
  const h = simulateHistory(lumina, site(lumina), end);
  const today = new Date(end); today.setHours(0, 0, 0, 0);
  assert.ok(h.length >= 182 * 2); // at least 2 sessions a day
  for (let i = 0; i < h.length; i++) {
    const s = h[i];
    assert.ok(s.at >= today.getTime() - 182 * DAY && s.at < today.getTime(), new Date(s.at).toString());
    if (i) assert.ok(s.at >= h[i - 1].at);
    assert.ok(s.choice in CHOICE_LABEL);
    assert.ok(['urgent', 'balanced', 'saver'].includes(s.mode));
    assert.equal(s.condoId, 'lumina');
    assert.equal(s.simulated, true);
    assert.ok(s.kWh > 0 && s.costRm > 0);
    assert.ok(!('plate' in s));
  }
  assert.ok(h.some((s) => s.role === 'visitor') && h.some((s) => s.role === 'resident'));
});

test('a condo that does not share has no visitor sessions', () => {
  assert.ok(simulateHistory(kenanga, site(kenanga), end).every((s) => s.role === 'resident'));
});

test('follow rate rises over the six months', () => {
  const h = simulateHistory(lumina, site(lumina), end);
  const first = filterSessions(h, { to: h[0].at + 28 * DAY });
  const last = filterSessions(h, { from: end - 29 * DAY });
  assert.ok(followRate(last) > followRate(first), `${followRate(first)} → ${followRate(last)}`);
});
