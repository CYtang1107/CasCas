import { baseOccupancy, visitorDemand } from '../data/demand.js';
import { visitorBaysFree } from './sharing.js';

// Share of a site's bays in use at `date`, split by who is using them.
export function occupancyAt(charger, date, condo = null) {
  // Live occupancy (TomTom), set only while the demo clock is close to the real time.
  if (charger.liveOcc != null && charger.siteType !== 'condo') return { resident: 0, visitor: 0, total: charger.liveOcc };
  // Real bookings from the shared server (bookedBays) come on top of the simulated pattern.
  const base = Math.min(1, baseOccupancy(charger, date) + (charger.bookedBays ? charger.bookedBays / charger.bays : 0));
  if (charger.siteType !== 'condo' || !condo) return { resident: 0, visitor: 0, total: base };
  const free = visitorBaysFree(condo, base, date);
  const visitor = Math.min(visitorDemand(date), free / condo.bays);
  return { resident: base, visitor, total: Math.min(1, base + visitor) };
}
