import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteArt, kindOf, brandMark } from '../views/art.js';
import { CHARGERS } from '../data/chargers.js';
import { HIGHWAY_CHARGERS } from '../data/trips.js';

test('every charger gets a picture with real colours and a label', () => {
  for (const ch of [...CHARGERS, ...HIGHWAY_CHARGERS]) {
    const svg = siteArt(ch, ch.name);
    assert.ok(!svg.includes('undefined'), ch.id);
    assert.match(svg, /role="img"/);
  }
  assert.equal(kindOf({ siteType: 'condo' }), 'condo');
  assert.equal(kindOf({ siteType: 'public', highway: true }), 'highway');
});

test('brand marks use the initial, never a logo, and escape the name', () => {
  assert.match(brandMark('Gentari'), />G</);
  assert.ok(!brandMark('A "quoted" op').includes('"quoted"'));
});
