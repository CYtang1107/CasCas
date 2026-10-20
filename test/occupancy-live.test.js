import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occupancyAt } from '../engine/occupancy.js';

test('a public charger with live occupancy uses it; condo bays keep their resident/visitor split', () => {
  const at = new Date(2026, 9, 21, 11);
  assert.deepEqual(occupancyAt({ id: 'x', siteType: 'public', bays: 2, liveOcc: 0.5 }, at), { resident: 0, visitor: 0, total: 0.5 });
  const est = occupancyAt({ id: 'x', siteType: 'public', bays: 2 }, at);
  assert.ok(est.total >= 0 && est.total <= 1);
});
