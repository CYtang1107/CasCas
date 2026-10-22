import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { visibleMapChargerIds } from '../engine/map-visibility.js';

const chargers = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const ranking = ['c', 'a', 'e', 'd', 'b'].map((id) => ({ charger: { id } }));

test('recommended view displays only the top three eligible ranked chargers', () => {
  assert.deepEqual([...visibleMapChargerIds(chargers, ranking, 'recommended')], ['c', 'a', 'e']);
});

test('all view retains every filtered station, including excluded recommendations', () => {
  assert.deepEqual([...visibleMapChargerIds(chargers, ranking, 'all')], ['a','b','c','d','e']);
});

test('recommended view respects other filters, de-duplicates, and handles no recommendations', () => {
  const allowed = [{ id: 'a' }, { id: 'b' }, { id: 'e' }];
  assert.deepEqual([...visibleMapChargerIds(allowed, ranking, 'recommended')], ['a', 'e', 'b']);
  assert.deepEqual([...visibleMapChargerIds(chargers, [], 'recommended')], []);
  assert.deepEqual([...visibleMapChargerIds([], ranking, 'all')], []);
});

test('the Plan mode toggle, selection focus, blank-map reset, and list reveal are wired', () => {
  const source = readFileSync(new URL('../views/driver.js', import.meta.url), 'utf8');
  assert.match(source, /mapMode: 'recommended'/);
  assert.match(source, /data-map-mode="recommended"/);
  assert.match(source, /data-map-mode="all"/);
  assert.match(source, /tab === 'plan' \? ui\.mapMode : 'all'/);
  assert.match(source, /fromList && tab === 'plan' && !markers\.has\(id\)/);
  assert.match(source, /highlightMarker\(null\)/);
  assert.match(source, /classList\.toggle\('is-muted'/);
  assert.match(source, /visible\.has\(ch\.id\)/);
});
