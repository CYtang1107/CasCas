import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopedFlashHtml } from '../views/flash.js';

test('booking errors render only on Activity, not Home or Plan', () => {
  const notice = 'Booking unavailable: Charging site fully booked Suggested times: Wed 1:30 pm–4:00 pm';
  assert.equal(scopedFlashHtml(notice, 'activity', 'home'), '');
  assert.equal(scopedFlashHtml(notice, 'activity', 'plan'), '');
  assert.match(scopedFlashHtml(notice, 'activity', 'activity'), /Booking unavailable/);
  assert.match(scopedFlashHtml(notice, 'activity', 'activity'), /Suggested times/);
});

test('form feedback stays on the page that owns it', () => {
  assert.match(scopedFlashHtml('Resident verification is required.', 'plan', 'plan'), /Resident verification/);
  assert.equal(scopedFlashHtml('Resident verification is required.', 'plan', 'activity'), '');
  assert.equal(scopedFlashHtml('', 'activity', 'activity'), '');
});

test('user-visible notices escape markup', () => {
  const html = scopedFlashHtml('<img src=x onerror=alert(1)>', 'activity', 'activity');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
