// Pilot condo sites (simulated) plus the demo public chargers. Live public chargers come from data/ocm.js.
import { CONDOS } from './condos.js';
import { DEMO_CHARGERS } from './chargers-demo.js';

export const CONDO_SITES = CONDOS.map((c) => ({
  id: `cs-${c.id}`, name: `${c.name} car park`, operator: 'Condo CPO partner',
  lat: c.lat, lng: c.lng, type: 'AC', kw: 7, connectors: ['Type2'], bays: c.bays,
  siteType: 'condo', condoId: c.id, reliability: 0.97, price: null, pilot: true,
}));

export const CHARGERS = [...CONDO_SITES, ...DEMO_CHARGERS];
