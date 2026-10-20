// Search chargers by name, operator, kind of place, charger type or address.
// Every word has to match something; names that start with the search come first, then nearest.
export function categoryOf(charger) {
  if (charger.siteType === 'condo') return 'Residential condo';
  if (charger.highway) return 'Highway';
  if (charger.siteType === 'mall') return 'Shopping mall';
  return 'Public';
}

const norm = (s) => String(s || '').toLowerCase();

// `sites`: [{ id, name, operator, category, type, address, km }]
export function searchSites(sites, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const hits = sites.filter((s) => {
    const hay = norm(`${s.name} ${s.operator} ${s.category} ${s.type} ${s.address}`);
    return words.every((w) => hay.includes(w));
  });
  const q = norm(query).trim();
  return hits.sort((a, b) => (q ? Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)) : 0) || a.km - b.km);
}

export const MAX_HISTORY = 6;
export function remember(history, query) {
  const q = String(query || '').trim();
  if (!q) return history;
  return [q, ...history.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY);
}
