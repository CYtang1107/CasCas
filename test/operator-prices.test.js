import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, DEFAULT_PRICE } from '../data/operator-prices.js';
import { CHARGERS, CONDO_SITES } from '../data/chargers.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';

test('known operators get their sourced rate, matched loosely', () => {
  assert.deepEqual(priceFor('Gentari Sdn Bhd', 'DC'), { price: 1.3, priceEstimated: false });
  assert.deepEqual(priceFor('ChargEV (Malaysia Green Technology Corp)', 'AC'), { price: 0.9, priceEstimated: false });
  assert.deepEqual(priceFor('jomcharge', 'AC'), { price: 1.1, priceEstimated: false });
  assert.deepEqual(priceFor('Tesla (Tesla-only charging)', 'DC'), { price: 1.8, priceEstimated: false });
});

test('unknown operator or missing rate falls back to an estimated default', () => {
  assert.deepEqual(priceFor('Unknown operator', 'AC'), { price: DEFAULT_PRICE.AC, priceEstimated: true });
  assert.deepEqual(priceFor(null, 'DC'), { price: DEFAULT_PRICE.DC, priceEstimated: true });
  assert.deepEqual(priceFor('Tesla Destination', 'AC'), { price: DEFAULT_PRICE.AC, priceEstimated: true });
});

test('demo world = pilot condo sites + demo public chargers', () => {
  assert.equal(CHARGERS.length, CONDO_SITES.length + DEMO_CHARGERS.length);
  assert.ok(CONDO_SITES.every((c) => c.siteType === 'condo' && c.pilot === true));
  assert.ok(DEMO_CHARGERS.every((c) => c.siteType !== 'condo'));
});
