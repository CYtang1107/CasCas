// Simulated share of bays in use, by site type and hour (index 0 = midnight).
import { isWeekend } from './tariff.js';

const PROFILES = {
  condo: {
    weekday: [0.45, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.12, 0.08, 0.08, 0.08, 0.1, 0.1, 0.1, 0.1, 0.12, 0.15, 0.25, 0.45, 0.7, 0.85, 0.85, 0.7, 0.55],
    weekend: [0.45, 0.4, 0.35, 0.3, 0.3, 0.25, 0.2, 0.18, 0.18, 0.2, 0.22, 0.22, 0.22, 0.22, 0.2, 0.2, 0.25, 0.35, 0.5, 0.65, 0.75, 0.75, 0.65, 0.5],
  },
  mall: {
    weekday: [0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.15, 0.3, 0.45, 0.55, 0.5, 0.5, 0.55, 0.65, 0.75, 0.85, 0.8, 0.6, 0.35, 0.1, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.25, 0.5, 0.7, 0.85, 0.9, 0.9, 0.9, 0.85, 0.85, 0.8, 0.75, 0.55, 0.3, 0.1, 0],
  },
  public: {
    weekday: [0.1, 0.05, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 0.7, 0.5, 0.35, 0.35, 0.4, 0.4, 0.35, 0.4, 0.55, 0.8, 0.85, 0.7, 0.5, 0.35, 0.25, 0.15],
    weekend: [0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.6, 0.55, 0.55, 0.55, 0.6, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15],
  },
  visitor: {
    weekday: [0, 0, 0, 0, 0, 0, 0, 0.2, 0.35, 0.45, 0.5, 0.5, 0.55, 0.55, 0.5, 0.5, 0.45, 0.4, 0.3, 0.2, 0.1, 0, 0, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0.1, 0.25, 0.4, 0.5, 0.55, 0.55, 0.55, 0.5, 0.45, 0.4, 0.35, 0.25, 0.15, 0.1, 0, 0, 0],
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Stable ±0.1 variation per charger so sites do not look identical.
function jitter(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (h / 997 - 0.5) * 0.2;
}

function profile(kind, date) {
  return PROFILES[kind][isWeekend(date) ? 'weekend' : 'weekday'];
}

export function baseOccupancy(charger, date) {
  const hourly = profile(charger.siteType, date)[date.getHours()];
  if (hourly === 0) return 0;
  return clamp01(hourly + jitter(charger.id) + (charger.busyBias || 0));
}

export function visitorDemand(date) {
  return profile('visitor', date)[date.getHours()];
}
