// Display logic only: never alters recommendation ranking or booking eligibility.
export const RECOMMENDED_MAP_LIMIT = 3;

export function visibleMapChargerIds(filteredChargers, rankedResults, mode = 'all') {
  const allowed = new Set(filteredChargers.map((charger) => charger.id));
  if (mode !== 'recommended') return allowed;
  const ids = new Set();
  for (const candidate of rankedResults) {
    const id = candidate?.charger?.id;
    if (allowed.has(id)) ids.add(id);
    if (ids.size === RECOMMENDED_MAP_LIMIT) break;
  }
  return ids;
}
