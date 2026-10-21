// JSON file store. Small, single process; writes go to a temp file then rename.
import fs from 'node:fs';
import path from 'node:path';
import { purgePasses } from '../engine/access.js';

const empty = () => ({ sharing: {}, checkins: {}, maintenance: {}, proposals: {}, residentKeys: {}, sessions: [], passes: [], bookings: [], chargingSessions: [] });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'store.json');
  const data = empty();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isObj(raw)) {
      for (const k of ['sharing', 'checkins', 'maintenance', 'proposals', 'residentKeys']) if (isObj(raw[k])) data[k] = raw[k];
      for (const k of ['sessions', 'passes', 'bookings', 'chargingSessions']) if (Array.isArray(raw[k])) data[k] = raw[k].filter(isObj);
    }
  } catch { /* missing or corrupt: start empty */ }

  return {
    get data() { return data; },
    save() {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
    prune(nowMs) {
      data.passes = purgePasses(data.passes, nowMs);
    
      const RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
    
      data.bookings = data.bookings.filter((b) => {
        // Discard invalid stored bookings.
        if (!Number.isFinite(b.end)) return false;
    
        // Keep all future and currently active bookings.
        // Remove completed bookings only after 48 hours.
        return b.end > nowMs - RETENTION_MS;
      });
    },
  };
}
