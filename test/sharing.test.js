import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenToVisitors, visitorBaysFree, validateSharing } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';

const condo = (over = {}) => ({
  id: 'c1', bays: 10,
  sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1, ...over },
});
const wed = (h, m = 0) => new Date(2026, 9, 21, h, m);
const sat = (h) => new Date(2026, 9, 24, h, 0);

test('open inside the weekday window only', () => {
  assert.equal(isOpenToVisitors(condo(), wed(9)), true);
  assert.equal(isOpenToVisitors(condo(), wed(16, 59)), true);
  assert.equal(isOpenToVisitors(condo(), wed(17)), false);
  assert.equal(isOpenToVisitors(condo(), wed(8, 59)), false);
  assert.equal(isOpenToVisitors(condo(), sat(11)), false);
  assert.equal(isOpenToVisitors(condo({ days: 'all' }), sat(11)), true);
  assert.equal(isOpenToVisitors(condo({ days: 'weekends' }), wed(11)), false);
  assert.equal(isOpenToVisitors(condo({ enabled: false }), wed(11)), false);
});

test('visitor bays respect reserved bays and residents already charging', () => {
  assert.equal(visitorBaysFree(condo(), 0.1, wed(11)), 8);
  assert.equal(visitorBaysFree(condo(), 0.5, wed(11)), 5);
  assert.equal(visitorBaysFree(condo({ reservedBays: 10 }), 0, wed(11)), 0);
  assert.equal(visitorBaysFree(condo(), 0.1, wed(20)), 0);
});

test('validateSharing rejects bad settings with a readable message', () => {
  assert.equal(validateSharing(condo().sharing, 10), null);
  assert.match(validateSharing({ ...condo().sharing, start: 18, end: 9 }, 10), /before closing/);
  assert.match(validateSharing({ ...condo().sharing, reservedBays: 11 }, 10), /between 0 and 10/);
  assert.match(validateSharing({ ...condo().sharing, reservedBays: 1.5 }, 10), /between 0 and 10/);
  assert.match(validateSharing({ ...condo().sharing, visitorPrice: 9 }, 10), /Visitor price/);
  assert.match(validateSharing({ ...condo().sharing, days: 'sometimes' }, 10), /weekdays/);
});

test('occupancy adds visitors only while a condo is open', () => {
  const site = { id: 'cs-c1', siteType: 'condo', condoId: 'c1' };
  const open = occupancyAt(site, wed(11), condo());
  assert.ok(open.visitor > 0);
  assert.ok(open.total <= 1);
  assert.equal(occupancyAt(site, wed(20), condo()).visitor, 0);
  const mall = occupancyAt({ id: 'm', siteType: 'mall' }, wed(18), null);
  assert.equal(mall.visitor, 0);
  assert.ok(mall.total > 0);
});
