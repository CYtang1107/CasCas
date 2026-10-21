import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDOS } from '../data/condos.js';
import { checkCondoBooking, findAlternativeSlots } from '../engine/reservations.js';

const condo = CONDOS.find(c => c.id === 'lumina');
const start = new Date(2026, 9, 21, 10).getTime();
const end = start + 2 * 3600000;

const booking = {
  chargerId: 'cs-lumina',
  start,
  end
};

const visitorBookings = Array.from({ length: 8 }, () => ({
  ...booking,
  role: 'visitor'
}));

test('Visitors cannot exceed allocated capacity', () => {
  const result = checkCondoBooking({
    condo,
    booking,
    role: 'visitor',
    existing: visitorBookings
  });

  assert.equal(result.ok, false);
});

test('Residents can use reserved capacity', () => {
  const result = checkCondoBooking({
    condo,
    booking,
    role: 'resident',
    existing: visitorBookings
  });

  assert.equal(result.ok, true);
});

test('Visitors cannot book outside sharing hours', () => {
  const late = new Date(2026, 9, 21, 20).getTime();

  const result = checkCondoBooking({
    condo,
    booking: {
      ...booking,
      start: late,
      end: late + 3600000
    },
    role: 'visitor'
  });

  assert.equal(result.ok, false);
});

test('Suggests available slots after a fully booked period', () => {
    const requested = {
      chargerId: 'cs-lumina',
      start,
      end: start + 3600000
    };
  
    const existing = Array.from({ length: 8 }, () => ({
      ...booking,
      role: 'visitor'
    }));
  
    const alternatives = findAlternativeSlots({
      condo,
      booking: requested,
      role: 'visitor',
      existing
    });
  
    assert.equal(alternatives.length, 3);
  
    // All eight visitor bays are occupied until 12 PM.
    assert.equal(alternatives[0].start, end);
  
    // Original one-hour duration is preserved.
    assert.equal(
      alternatives[0].end - alternatives[0].start,
      3600000
    );
  
    // Every suggestion must pass booking validation.
    for (const slot of alternatives) {
      assert.equal(
        checkCondoBooking({
          condo,
          booking: { ...requested, ...slot },
          role: 'visitor',
          existing
        }).ok,
        true
      );
    }
  });