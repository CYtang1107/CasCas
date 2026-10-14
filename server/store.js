// JSON file store. Small, single process; writes go to a temp file then rename.
import fs from 'node:fs';
import path from 'node:path';
import { purgePasses } from '../engine/access.js';

const empty = () => ({ sharing: {}, checkins: {}, sessions: [], passes: [], bookings: [] });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'store.json');
  const data = empty();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isObj(raw)) {
      for (const k of ['sharing', 'checkins']) if (isObj(raw[k])) data[k] = raw[k];
      for (const k of ['sessions', 'passes', 'bookings']) if (Array.isArray(raw[k])) data[k] = raw[k].filter(isObj);
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
      data.bookings = data.bookings.filter((b) => nowMs - b.createdAt < 2 * 864e5);
    },
  };
}
