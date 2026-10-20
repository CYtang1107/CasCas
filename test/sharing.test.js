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

test('auto mode: shares when residents leave bays idle, keeps bays for them, never at night', () => {
  const auto = condo({ mode: 'auto', reservedBays: 2 });
  assert.equal(isOpenToVisitors(auto, wed(11)), true, 'weekday late morning: residents are at work');
  assert.equal(isOpenToVisitors(auto, wed(19)), false, 'evening: residents are coming home to charge');
  assert.equal(isOpenToVisitors(auto, wed(2)), false, 'no visitors overnight');
  assert.equal(isOpenToVisitors(auto, sat(11)), false, 'weekdays only, like the JMB set');
  assert.equal(isOpenToVisitors({ ...auto, sharing: { ...auto.sharing, days: 'all' } }, sat(11)), true);
  assert.ok(visitorBaysFree(auto, 0.1, wed(11)) > 0);
  assert.ok(visitorBaysFree(auto, 0.1, wed(11)) <= 8, 'always keeps 2 for residents');
  assert.equal(visitorBaysFree(auto, 1, wed(11)), 0, 'residents already charging come first');
});

test('auto mode opens hours that fixed 9-to-5 sharing misses', () => {
  const auto = condo({ mode: 'auto', days: 'all' });
  const fixed = condo({ days: 'all' });
  const open = (c) => Array.from({ length: 24 }, (_, h) => isOpenToVisitors(c, wed(h))).filter(Boolean).length;
  assert.ok(open(auto) > open(fixed), `${open(auto)} vs ${open(fixed)}`);
});

test('sharing mode must be hours or auto', () => {
  assert.equal(validateSharing({ ...condo().sharing, mode: 'auto' }, 10), null);
  assert.match(validateSharing({ ...condo().sharing, mode: 'magic' }, 10), /mode/i);
});
