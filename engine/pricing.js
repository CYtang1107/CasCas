import { isPeak, EARLY_BIRD } from '../data/tariff.js';

export function round2(n) {
  return Math.round(n * 100) / 100;
}

function earlyBird(charger, date) {
  return charger.operator === EARLY_BIRD.operator && charger.type === 'DC' && date.getHours() < EARLY_BIRD.endHour;
}

// RM/kWh a driver pays at `date`. `condo` is the condo that owns the site, if any.
export function priceAt(charger, date, condo = null, isResident = false) {
  if (charger.siteType === 'condo' && condo) {
    const base = isResident ? condo.residentPrice : condo.sharing.visitorPrice;
    return round2(base + (isPeak(date) ? condo.peakSurcharge : 0));
  }
  if (earlyBird(charger, date)) return round2(charger.price * (1 - EARLY_BIRD.discount));
  return charger.price;
}

export function priceNote(charger, date, condo) {
  if (charger.siteType === 'condo' && condo) return isPeak(date) ? 'Peak-hour price' : 'Off-peak price';
  if (earlyBird(charger, date)) return 'Early-bird rate';
  return null;
}
