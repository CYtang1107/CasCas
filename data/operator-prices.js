// Public 2026 rates in RM/kWh from the research brief. Add an operator only with a sourced rate.
export const OPERATOR_PRICES = {
  gentari: { AC: 1.0, DC: 1.3 },
  chargev: { AC: 0.9, DC: 1.3 },
  jomcharge: { AC: 1.1, DC: 1.3 },
  tesla: { DC: 1.8 },
};

export const DEFAULT_PRICE = { AC: 1.0, DC: 1.3 };

// Open Charge Map operator titles vary ("Gentari Sdn Bhd"), so match by substring.
export function priceFor(operator, type) {
  const name = String(operator || '').toLowerCase();
  const key = Object.keys(OPERATOR_PRICES).find((k) => name.includes(k));
  const rate = key ? OPERATOR_PRICES[key][type] : undefined;
  return rate ? { price: rate, priceEstimated: false } : { price: DEFAULT_PRICE[type], priceEstimated: true };
}
