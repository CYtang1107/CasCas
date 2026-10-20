// Map filters, like the Filters sheet in the operator apps. Options inside one group are OR-ed
// (AC or DC), groups are AND-ed (DC and Gentari and available now).
export const FAST_KW = 50;

export const emptyFilters = () => ({ types: [], plugs: [], brands: [], available: false, condoShared: false, maxPrice: null, promo: false });

export function countFilters(f) {
  return f.types.length + f.plugs.length + f.brands.length + (f.available ? 1 : 0) + (f.condoShared ? 1 : 0) + (f.maxPrice != null ? 1 : 0) + (f.promo ? 1 : 0);
}

// `info` describes one charger right now: { type, kw, connectors, operator, free, condoSharedNow, price, promo }.
export function matchesFilters(info, f) {
  if (f.types.length) {
    const ok = f.types.some((t) => (t === 'ac' && info.type === 'AC') || (t === 'dc' && info.type === 'DC') || (t === 'fast' && info.type === 'DC' && info.kw >= FAST_KW));
    if (!ok) return false;
  }
  if (f.plugs.length && !f.plugs.some((p) => info.connectors.includes(p))) return false;
  if (f.brands.length && !f.brands.some((b) => String(info.operator || '').toLowerCase().includes(b.toLowerCase()))) return false;
  if (f.available && !(info.free > 0)) return false;
  if (f.condoShared && !info.condoSharedNow) return false;
  if (f.maxPrice != null && info.price > f.maxPrice + 1e-9) return false;
  if (f.promo && !info.promo) return false;
  return true;
}
