// TNB domestic Time-of-Use (from 1 Jul 2025), usage up to 1,500 kWh/month, before AFA.
export const TNB = { peakStartHour: 14, peakEndHour: 22, peakRate: 0.2852, offPeakRate: 0.2443 };

// Gentari trialled 15% off DC fast charging between 00:00 and 06:59.
export const EARLY_BIRD = { operator: 'Gentari', endHour: 7, discount: 0.15 };

export function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

export function isPeak(date) {
  if (isWeekend(date)) return false;
  const h = date.getHours();
  return h >= TNB.peakStartHour && h < TNB.peakEndHour;
}

export function tnbRate(date) {
  return isPeak(date) ? TNB.peakRate : TNB.offPeakRate;
}
