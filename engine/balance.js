export const BUSY = 0.8;
export const PENALTY = 0.25;

// In Saver mode, steer drivers away from nearly full chargers so low-battery drivers get them.
export function applyBalance(scored, mode) {
  if (mode !== 'saver' || scored.length === 0) return { results: scored, note: null };
  const before = scored[0];
  const results = scored
    .map((c) => (c.occupancy >= BUSY ? { ...c, score: c.score + PENALTY, balanced: true } : c))
    .sort((a, b) => a.score - b.score);
  const after = results[0];
  if (after.charger.id === before.charger.id) return { results, note: null };
  const saving = before.cost - after.cost;
  const tail = saving > 0.005 ? ` You save RM${saving.toFixed(2)}.` : '';
  return { results, note: `Leaving the busy charger at ${before.charger.name} for low-battery drivers.${tail}` };
}
