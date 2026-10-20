import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseOcm, normaliseAll } from '../engine/normalise.js';

const pois = JSON.parse(readFileSync(new URL('./fixtures/ocm-sample.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(normaliseAll(pois).map((c) => [c.id, c]));

test('private and coordinate-less stations are dropped; the rest are kept', () => {
  assert.deepEqual(Object.keys(byId).sort(), ['ocm-101', 'ocm-102', 'ocm-103', 'ocm-104', 'ocm-107', 'ocm-108']);
  assert.equal(normaliseOcm(null), null);
});

test('DC detection, max kW, connectors and bays', () => {
  const g = byId['ocm-101'];
  assert.equal(g.type, 'DC');
  assert.equal(g.kw, 60);
  assert.deepEqual(g.connectors, ['CCS2', 'Type2']);
  assert.equal(g.bays, 3);
  assert.equal(g.address, 'Jalan Test 1, Kuala Lumpur');
  assert.equal(byId['ocm-102'].type, 'AC');
  assert.equal(byId['ocm-102'].bays, 2); // sum of connector quantities
  assert.equal(byId['ocm-103'].bays, 1); // nothing known → 1
  assert.equal(byId['ocm-104'].connectors[0], 'CHAdeMO');
  assert.deepEqual(byId['ocm-107'].connectors, ['CCS2']); // Tesla at DC power
  assert.deepEqual(byId['ocm-108'].connectors, ['Type2']); // Tesla at AC power
});

test('prices come from the operator table, otherwise an estimated default', () => {
  assert.equal(byId['ocm-101'].price, 1.3);
  assert.equal(byId['ocm-101'].priceEstimated, false);
  assert.equal(byId['ocm-102'].price, 0.9);
  assert.equal(byId['ocm-103'].operator, 'Unknown operator');
  assert.equal(byId['ocm-103'].priceEstimated, true);
  assert.equal(byId['ocm-107'].price, 1.8);
  assert.equal(byId['ocm-108'].priceEstimated, true); // Tesla AC has no sourced rate
});

test('non-operational stations get low reliability; every charger is a public OCM site', () => {
  assert.equal(byId['ocm-104'].reliability, 0.5);
  assert.equal(byId['ocm-101'].reliability, 0.9);
  for (const c of Object.values(byId)) {
    assert.equal(c.siteType, 'public');
    assert.equal(c.source, 'ocm');
    assert.ok(c.kw > 0 && c.connectors.length > 0);
  }
});

test('both of OCM spellings of an unknown operator become one', () => {
  const base = JSON.parse(JSON.stringify(pois.find((p) => p.ID === 101)));
  const named = (title) => normaliseOcm({ ...base, OperatorInfo: title === undefined ? undefined : { Title: title } }).operator;
  assert.equal(named('(Unknown Operator)'), 'Unknown operator');
  assert.equal(named('Unknown Operator'), 'Unknown operator');
  assert.equal(named(undefined), 'Unknown operator');
  assert.equal(named('Gentari'), 'Gentari');
});
