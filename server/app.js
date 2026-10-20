// CasCas shared server: serves the website and a small JSON API (bookings, passes, check-ins, JMB).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CONDOS } from '../data/condos.js';
import { loadChargers } from '../data/ocm.js';
import { normalisePlate, isValidPlate, canAutoApprove, createPass } from '../engine/access.js';
import { validateSharing } from '../engine/sharing.js';
import { followRate, savings, overstayTotals } from '../engine/insights.js';
import { validateEntry, cleanEntry, faultBays } from '../engine/maintenance.js';
import { createStore } from './store.js';
import { createCsms } from './ocpp.js';
import { createAuth } from './auth.js';
import { cleanSession, cleanBooking, cleanCheckin, cleanSharing } from './validate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['index.html', 'jmb.html', 'app.js', 'config.js', 'state.js', 'styles.css'];
const DIRS = ['data', 'engine', 'views'];
const MAX_SESSIONS = 5000;
const MAX_MAINTENANCE = 500;
const MAX_CHECKINS = 200;
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');

// Open Charge Map through the server: the key stays here. Live results are kept 24 h, fallbacks 10 min.
function chargerSource({ dataDir, fetchFn, key, now }) {
  const file = path.join(dataDir, 'ocm.json');
  const storage = {
    getItem: () => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } },
    setItem: (_k, v) => { try { fs.writeFileSync(file, v); } catch { /* memory only */ } },
  };
  let last = null;
  let at = 0;
  return async () => {
    const t = now();
    const ttl = last?.source === 'live' ? 24 * 3600e3 : 10 * 60e3;
    if (last && t - at < ttl) return last;
    last = await loadChargers({ fetchFn, storage, now: t, key });
    at = t;
    return last;
  };
}

export function createApp({ dataDir, secret, pins, ocmKey = '', ocppPassword = crypto.randomBytes(16).toString('hex'), trafficKey = '', fetchFn = globalThis.fetch, now = () => Date.now() }) {
  const store = createStore(dataDir);
  const csms = createCsms({ store, condos: CONDOS, password: ocppPassword, now });
  const auth = createAuth({ secret, pins, now });
  const chargers = chargerSource({ dataDir, fetchFn, key: ocmKey, now });
  const app = express();
  app.disable('x-powered-by');
  // OCPP chargers connect over WebSocket: call app.locals.attachOcpp(httpServer) after listen().
  app.locals.attachOcpp = (server) => csms.attach(server);
  app.locals.sim = null;

  const condoWithSharing = (id) => {
    const c = CONDOS.find((x) => x.id === id);
    return c ? { ...c, sharing: { ...c.sharing, ...(store.data.sharing[id] || {}) } } : null;
  };
  const bad = (res, error, status = 400) => res.status(status).json({ error });
  const requireJmb = (req, res, next) => (auth.verify(req.headers.authorization, req.params.condoId) ? next() : bad(res, 'Log in with the condo PIN', 401));

  // Website: only the app's own files, never server data or config.
  app.get('/', (req, res) => { noCache(res); res.sendFile(path.join(ROOT, 'index.html')); });
  for (const f of FILES) app.get(`/${f}`, (req, res) => { noCache(res); res.sendFile(path.join(ROOT, f)); });
  for (const d of DIRS) app.use(`/${d}`, express.static(path.join(ROOT, d), { setHeaders: noCache, index: false }));

  app.use('/api', express.json({ limit: '50kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => res.json({ traffic: !!trafficKey }));

  // Live traffic map tiles from TomTom, fetched here so the key stays on the server. Each tile is
  // kept for a minute, which saves the free daily quota when many people look at the same area.
  const tiles = new Map();
  app.get('/api/traffic/:z/:x/:y.png', async (req, res) => {
    if (!trafficKey) return bad(res, 'Live traffic is not set up on this server', 404);
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return bad(res, 'Bad tile');
    const key = `${z}/${x}/${y}`;
    let hit = tiles.get(key);
    if (!hit || now() - hit.at > 60000) {
      try {
        const r = await fetchFn(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${key}.png?key=${encodeURIComponent(trafficKey)}&tileSize=256`);
        if (!r.ok) return bad(res, 'Traffic provider unavailable', 502);
        hit = { at: now(), body: Buffer.from(await r.arrayBuffer()) };
        if (tiles.size > 2000) tiles.clear();
        tiles.set(key, hit);
      } catch {
        return bad(res, 'Traffic provider unavailable', 502);
      }
    }
    res.set('Cache-Control', 'public, max-age=60').type('image/png').send(hit.body);
  });

  app.get('/api/chargers', async (req, res) => res.json(await chargers()));

  app.get('/api/world', (req, res) => {
    store.prune(now());
    const at = Number(req.query.at) || now();
    const activeBays = {};
    for (const b of store.data.bookings) if (b.start <= at && at < b.end) activeBays[b.chargerId] = (activeBays[b.chargerId] || 0) + 1;
    const out = {};
    for (const c of CONDOS) {
      const n = faultBays(store.data.maintenance[c.id] || [], c.bays);
      if (n) out[`cs-${c.id}`] = n;
    }
    res.json({ sharing: store.data.sharing, checkins: store.data.checkins, activeBays, faultBays: out, live: csms.summaries() });
  });

  app.post('/api/bookings', (req, res) => {
    const session = cleanSession(req.body?.session);
    if (!session) return bad(res, 'Invalid session');
    const booking = cleanBooking(req.body?.booking, session.chargerId);
    if (!booking) return bad(res, 'Invalid booking');
    const id = crypto.randomUUID();
    const cancelToken = crypto.randomBytes(16).toString('hex');
    let pass = null;
    if (req.body.pass) {
      const condo = condoWithSharing(session.condoId);
      if (!condo || session.chargerId !== `cs-${condo.id}`) return bad(res, 'Visitor passes are only for condo bays');
      const plate = normalisePlate(req.body.pass.plate);
      if (!isValidPlate(plate)) return bad(res, 'Enter a number plate with letters and numbers, for example WXY 1234.');
      if (req.body.pass.consent !== true) return bad(res, 'Tick the box to share your plate with the condo management.');
      if (!canAutoApprove(condo, new Date(booking.start))) return bad(res, `${condo.name} is not sharing at that time. Pick another charger.`, 409);
      pass = {
        ...createPass({ id: `pass-${id}`, condoId: condo.id, chargerId: session.chargerId, plate, slotStart: booking.start, minutes: (booking.end - booking.start) / 60000, now: now() }),
        bookingId: id,
      };
    }
    const d = store.data;
    d.sessions = [...d.sessions, session].slice(-MAX_SESSIONS);
    d.bookings.push({ id, ...booking, cancelToken, createdAt: now() });
    if (pass) d.passes.push(pass);
    store.save();
    res.status(201).json({ bookingId: id, cancelToken, pass });
  });

  app.delete('/api/bookings/:id', (req, res) => {
    const d = store.data;
    const b = d.bookings.find((x) => x.id === req.params.id);
    if (!b) return bad(res, 'Booking not found', 404);
    const given = Buffer.from(String(req.body?.cancelToken || ''));
    const real = Buffer.from(b.cancelToken);
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return bad(res, 'Not your booking', 403);
    d.bookings = d.bookings.filter((x) => x !== b);
    d.passes = d.passes.filter((p) => p.bookingId !== b.id);
    store.save();
    res.json({ ok: true });
  });

  app.post('/api/checkins', (req, res) => {
    const c = cleanCheckin(req.body);
    if (!c) return bad(res, 'Invalid check-in');
    const list = store.data.checkins[c.chargerId] || [];
    store.data.checkins[c.chargerId] = [...list, { ok: c.ok, note: c.note, at: c.at }].slice(-MAX_CHECKINS);
    store.save();
    res.status(201).json({ ok: true });
  });

  app.get('/api/condos/:condoId/summary', (req, res) => {
    if (!condoWithSharing(req.params.condoId)) return bad(res, 'Unknown condo', 404);
    const list = store.data.sessions.filter((s) => s.condoId === req.params.condoId);
    res.json({ count: list.length, followRate: followRate(list), savedRm: savings(list).totalRm, overstayFeesRm: overstayTotals(list).feesRm });
  });

  app.post('/api/jmb/login', (req, res) => {
    const r = auth.login(String(req.body?.condoId || ''), String(req.body?.pin || ''));
    if (r.status === 429) return bad(res, 'Too many tries. Wait 10 minutes.', 429);
    if (r.status !== 200) return bad(res, 'Wrong PIN.', 401);
    res.json({ token: r.token, expiresAt: r.expiresAt });
  });

  app.get('/api/jmb/:condoId', requireJmb, (req, res) => {
    const id = req.params.condoId;
    store.prune(now());
    res.json({
      sessions: store.data.sessions.filter((s) => s.condoId === id),
      passes: store.data.passes.filter((p) => p.condoId === id),
      sharing: condoWithSharing(id).sharing,
      maintenance: store.data.maintenance[id] || [],
    });
  });

  app.post('/api/jmb/:condoId/maintenance', requireJmb, (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    const e = req.body?.entry;
    const err = validateEntry(e, condo.bays);
    if (err) return bad(res, err);
    const list = store.data.maintenance[condo.id] || [];
    store.data.maintenance[condo.id] = [...list, cleanEntry(e)].slice(-MAX_MAINTENANCE);
    store.save();
    res.status(201).json({ maintenance: store.data.maintenance[condo.id] });
  });

  app.put('/api/jmb/:condoId/sharing', requireJmb, (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    const next = cleanSharing(req.body?.sharing);
    const err = next ? validateSharing(next, condo.bays) : 'Invalid settings';
    if (err) return bad(res, err);
    store.data.sharing[condo.id] = next;
    store.save();
    res.json({ sharing: next });
  });

  // Live OCPP status of a condo's bays: no personal data, so it is public like the map.
  app.get('/api/ocpp/:condoId', (req, res) => {
    if (!condoWithSharing(req.params.condoId)) return bad(res, 'Unknown condo', 404);
    res.json({ ...csms.snapshot(req.params.condoId), simulated: !!app.locals.sim });
  });

  // Demo control: make a simulated charger report a fault, or come back.
  app.post('/api/jmb/:condoId/ocpp/:bay', requireJmb, (req, res) => {
    const action = req.body?.action;
    if (!['fault', 'clear'].includes(action)) return bad(res, 'Action must be fault or clear');
    if (!app.locals.sim) return bad(res, 'The charger simulator is not running', 409);
    if (!app.locals.sim.inject(req.params.condoId, Number(req.params.bay), action)) return bad(res, 'That charger is not connected', 409);
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => bad(res, 'Not found', 404));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON' : 'Server error' });
  });
  return app;
}
