import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';
import { effectiveReliability } from './score.js';

// Apply this device's JMB settings and check-ins on top of the simulated data.
export function buildWorld(state, condos = CONDOS, chargers = CHARGERS) {
  return {
    condos: condos.map((c) => ({ ...c, sharing: { ...c.sharing, ...(state.sharing[c.id] || {}) } })),
    chargers: chargers.map((ch) => ({ ...ch, reliability: effectiveReliability(ch.reliability, state.checkins[ch.id]) })),
  };
}
