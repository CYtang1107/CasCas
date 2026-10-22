import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, askRoute, looksLikeQuestion } from '../engine/assistant.js';
import { CARS } from '../data/cars.js';
import { PLACES } from '../data/places.js';

const ask = (t) => parseRequest(t, { cars: CARS, places: PLACES });

test('reads battery, place, stay and car from plain English', () => {
  const r = ask('My Atto 3 is at 20%, going to KL East Mall for 2 hours');
  assert.deepEqual(r.set, { carId: 'atto3', battery: 20, placeId: 'klem', parkFor: '2h' });
  assert.ok(r.understood.includes('Battery 20%'));
  assert.ok(r.understood.includes('Going to KL East Mall'));
});

test('reads budget, fast charging and operator preferences', () => {
  const r = ask('need a fast charge under RM1.20/kWh, prefer Gentari, battery 12 percent');
  assert.equal(r.set.battery, 12);
  assert.equal(r.set.maxPrice, 1.2);
  assert.equal(r.set.fastOnly, true);
  assert.equal(r.set.operator, 'Gentari');
});

test('minutes and overnight map to the nearest stay option', () => {
  assert.equal(ask('stopping 20 min at klcc').set.parkFor, '30m');
  assert.equal(ask('parking 3 hours').set.parkFor, '4h');
  assert.equal(ask('charge overnight near me').set.parkFor, 'overnight');
  assert.equal(ask('charge overnight near me').set.placeId, 'here');
  assert.equal(ask('stopping 20 min at klcc').set.placeId, 'klcc');
});

test('battery is clamped and nonsense sets nothing', () => {
  assert.equal(ask('battery 2%').set.battery, 5);
  const r = ask('hello there');
  assert.deepEqual(r.set, {});
  assert.equal(r.understood.length, 0);
});

test('"no budget", "any operator" and "any speed" clear those preferences', () => {
  const r = ask('any operator, no budget limit, any speed');
  assert.equal(r.set.maxPrice, null);
  assert.equal(r.set.operator, null);
  assert.equal(r.set.fastOnly, false);
});

// Regression: the Plan search box must not send genuine questions to the
// trip-only parser when the live AI agent is available.
test('Home and Plan both route Ask CasSama to AI when enabled', () => {
  for (const tab of ['home', 'plan']) {
    assert.equal(askRoute(tab, true), 'chat');
    assert.equal(askRoute(tab, false), 'preferences');
  }
  assert.equal(askRoute('map', true), 'preferences');
});

test('scheduling, booking, revenue and cost prompts are questions, not just preferences', () => {
  const prompts = [
    'I need to charge for two hours. When should I charge to save money?',
    'Can I book a residential charger at Lumina tonight?',
    'How much revenue has Lumina generated for its JMB this month?',
    'How much will it cost to fully charge my car?',
  ];
  for (const prompt of prompts) assert.equal(looksLikeQuestion(prompt), true, prompt);
  assert.equal(looksLikeQuestion('Atto 3 71% going to Melaka'), false);
});
