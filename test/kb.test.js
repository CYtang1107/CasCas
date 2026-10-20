import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchKnowledge } from '../engine/kb.js';
import { KNOWLEDGE } from '../data/knowledge.js';

const top = (q) => searchKnowledge(KNOWLEDGE, q)[0]?.id;

test('questions find the right fact', () => {
  assert.equal(top('what happens if I stay too long after my slot'), 'kb-overstay');
  assert.equal(top('how do residents vote on sharing'), 'kb-vote');
  assert.equal(top('when is TNB peak tariff'), 'kb-tariff');
  assert.equal(top('is my number plate private'), 'kb-privacy');
  assert.equal(top('where does the charging income go maintenance fund'), 'kb-income');
});

test('nonsense finds nothing; results are capped', () => {
  assert.deepEqual(searchKnowledge(KNOWLEDGE, 'the and of'), []);
  assert.ok(searchKnowledge(KNOWLEDGE, 'charging bays residents condo', 3).length <= 3);
});

test('every knowledge entry has an id, title and text', () => {
  const ids = new Set();
  for (const k of KNOWLEDGE) {
    assert.ok(k.id && k.title && k.text.length > 40, k.id);
    assert.ok(!ids.has(k.id));
    ids.add(k.id);
  }
});
