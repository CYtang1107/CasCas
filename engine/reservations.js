import {
    isOpenToVisitors,
    visitorBaysFree
  } from './sharing.js';

export function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
}

export function checkCondoBooking({
    condo,
    booking,
    role,
    existing = [],
    faults = 0
}) {
    const capacity = Math.max(0, condo.bays - faults);

    if (capacity === 0) {
        return { ok: false, error: 'All bays are unavailable' };
    }

    // Only consider bookings for the same charging site
    const relevant = existing.filter(b =>
        b.chargerId === booking.chargerId &&
        overlaps(b, booking)
    );

    // Check all booking boundaries and every minute
    // to detect changes in visitor-sharing rules.
    const times = new Set([booking.start, booking.end]);

    for (const b of relevant) {
        if (b.start > booking.start && b.start < booking.end)
            times.add(b.start);
        if (b.end > booking.start && b.end < booking.end)
            times.add(b.end);
    }

    for (
        let t = (Math.floor(booking.start / 60000) + 1) * 60000;
        t < booking.end;
        t += 60000
    ) {
        times.add(t);
    }

    const sorted = [...times].sort((a, b) => a - b);

    for (const at of sorted.slice(0, -1)) {
        const active = relevant.filter(
        b => b.start <= at && at < b.end
        );

        const residents = active.filter(
        b => b.role === 'resident'
        ).length;

        // Treat legacy bookings without a role as visitors
        const visitors = active.length - residents;

        if (active.length >= capacity) {
        return { ok: false, error: 'Charging site fully booked' };
        }

        if (role === 'visitor') {
            const date = new Date(at);

            if (!isOpenToVisitors(condo, date)) {
                return { ok: false, error: 'Visitor sharing is closed' };
            }

            const visitorLimit = Math.max(
                0,
                visitorBaysFree(
                condo,
                residents / condo.bays,
                date
                ) - faults
            );

            if (visitors >= visitorLimit) {
                return {
                ok: false,
                error: 'No visitor bays available'
                };
            }
        }
    }

    return { ok: true };
}

export function findAlternativeSlots(
    args,
    { count = 3, stepMinutes = 30, hours = 72 } = {}
  ) {
    const alternatives = [];
  
    const step = stepMinutes * 60 * 1000;
    const duration = args.booking.end - args.booking.start;
    const searchEnd = args.booking.start + hours * 3600000;
  
    // Start searching after the rejected booking's start time
    let candidateStart =
      Math.ceil((args.booking.start + 1) / step) * step;
  
    while (
      candidateStart <= searchEnd &&
      alternatives.length < count
    ) {
      const candidate = {
        ...args.booking,
        start: candidateStart,
        end: candidateStart + duration
      };
  
      const result = checkCondoBooking({
        ...args,
        booking: candidate
      });
  
      if (result.ok) {
        alternatives.push({
          start: candidate.start,
          end: candidate.end
        });
      }
  
      candidateStart += step;
    }
  
    return alternatives;
}