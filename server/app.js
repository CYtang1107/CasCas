// CasSama shared server: serves the website and a small JSON API (bookings, passes, check-ins, JMB).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CONDOS } from '../data/condos.js';
import { condoSitesFor } from '../data/chargers.js';
import { loadChargers } from '../data/ocm.js';
import { normalisePlate, isValidPlate, canAutoApprove, createPass } from '../engine/access.js';
import { validateSharing } from '../engine/sharing.js';
import { followRate, savings, overstayTotals } from '../engine/insights.js';
import { validateEntry, cleanEntry, faultBays, bayStatus } from '../engine/maintenance.js';
import { chargingRevenueReport, malaysiaMonth } from '../engine/charging.js';
import { createStore } from './store.js';
import { createCsms } from './ocpp.js';
import { createTomTom, parsePoints, parseBbox } from './tomtom.js';
import { createProposal, castVote, tally, closeProposal } from '../engine/governance.js';
import { createAuth } from './auth.js';
import { createAgent } from './agent.js';
import { CARS } from '../data/cars.js';
import { START } from '../data/places.js';
import { cleanSession, cleanBooking, cleanCheckin, cleanSharing } from './validate.js';
import { checkCondoBooking, findAlternativeSlots } from '../engine/reservations.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['index.html', 'jmb.html', 'app.js', 'config.js', 'state.js', 'styles.css', 'design/logo.png'];
const DIRS = ['data', 'engine', 'views'];
const MAX_SESSIONS = 5000;
const MAX_MAINTENANCE = 500;
const MAX_CHECKINS = 200;
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');

// Open Charge Map through the server: the key stays here. Live results are kept 24 h, fallbacks 10 min.
function chargerSource({ dataDir, fetchFn, key, now, condoSites }) {
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
    last = await loadChargers({ fetchFn, storage, now: t, key, condoSites });
    at = t;
    return last;
  };
}

export function createApp({ dataDir, secret, pins, ocmKey = '', ocppPassword = crypto.randomBytes(16).toString('hex'), trafficKey = '', ai = null, fetchFn = globalThis.fetch, now = () => Date.now(), condos = CONDOS }) {
  const store = createStore(dataDir);
  // The OCPP transaction context is held in the charger connection. After a
  // server restart, an interrupted session must be reviewed, not auto-billed.
  let interrupted = false;
  for (const session of store.data.chargingSessions) {
    if (session.status === 'charging') {
      session.status = 'needs_review';
      session.reviewReason = 'Server restarted before verified StopTransaction';
      interrupted = true;
    }
  }
  if (interrupted) store.save();
  const csms = createCsms({ store, condos, password: ocppPassword, now });
  const auth = createAuth({ secret, pins, now });
  const keyHash = (key) =>
    crypto.createHash('sha256')
      .update(key)
      .digest('hex');

  const isResidentKey = (key, condoId) => {
    if (
      typeof key !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(key)
    ) {
      return false;
    }

    const entry = store.data.residentKeys[keyHash(key)];

    return (
      entry?.condoId === condoId &&
      entry.expiresAt > now()
    );
  };
  const chargers = chargerSource({ dataDir, fetchFn, key: ocmKey, now, condoSites: condoSitesFor(condos) });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render sits in front: rate limits need the real client address
  // OCPP chargers connect over WebSocket: call app.locals.attachOcpp(httpServer) after listen().
  app.locals.attachOcpp = (server) => csms.attach(server);
  app.locals.sim = null;

  const condoWithSharing = (id) => {
    const c = condos.find((x) => x.id === id);
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
  app.get('/api/config', (req, res) => res.json({ traffic: !!trafficKey, ai: !!ai?.key }));

  // The CasSama assistant: an orchestrator model calling CasSama's own engines as tools.
  const agent = ai?.key ? createAgent({ ...ai, fetchFn, now }) : null;
  app.post('/api/agent', async (req, res) => {
    if (!agent) return bad(res, 'The AI assistant is not set up on this server', 404);
    if (!agent.allow(req.ip || 'x')) return bad(res, 'Too many questions; try again in a few minutes', 429);
    const b = req.body || {};
    const text = String(b.text || '').slice(0, 2000);
    const c = b.context || {};
    const car = CARS.find((x) => x.id === c.carId) || CARS[0];
    const lat = Number(c.lat), lng = Number(c.lng);
    const origin = lat > 0.5 && lat < 7.5 && lng > 99 && lng < 120 ? { lat, lng, name: String(c.originName || 'your location').slice(0, 60) } : { ...START, name: 'KL East' };
    const t = new Date(c.clock);
    const clock = Number.isNaN(t.getTime()) ? new Date(now()) : t;
    const home = condos.find((x) => x.id === c.homeId) || null;
    const history = Array.isArray(b.history) ? b.history.slice(-6) : [];
    try {
      const world = { chargers: (await chargers()).chargers, condos: condos.map((x) => condoWithSharing(x.id)) };
      const env = { world, car, origin, clock, homeId: home?.id || null, parkFor: c.parkFor, prefs: c.prefs || {} };
      res.json(await agent.ask({ text, history, env, context: { clock, carName: car.name, originName: origin.name, homeName: home?.name } }));
    } catch (e) {
      console.warn('AI assistant failed:', e.message); // provider status and message, never the key
      bad(res, 'The AI assistant is unavailable right now', 502);
    }
  });

  // Live TomTom data (same key as the traffic tiles): bays, routes with traffic, incidents.
  const tt = trafficKey ? createTomTom({ key: trafficKey, fetchFn, now }) : null;
  const ttOff = (res) => bad(res, 'Live TomTom data is not set up on this server', 404);
  app.get('/api/tt/stations', async (req, res) => {
    if (!tt) return ttOff(res);
    try { res.json(await tt.stations()); } catch { bad(res, 'TomTom unavailable', 502); }
  });
  app.get('/api/tt/route', async (req, res) => {
    if (!tt) return ttOff(res);
    const pts = parsePoints(req.query.pts);
    if (!pts) return bad(res, 'Give 2 to 6 points as lat,lng;lat,lng');
    try { res.json(await tt.route(pts, req.query.alt === '1')); } catch { bad(res, 'TomTom unavailable', 502); }
  });
  app.get('/api/tt/incidents', async (req, res) => {
    if (!tt) return ttOff(res);
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) return bad(res, 'Give bbox as west,south,east,north');
    try { res.json(await tt.incidents(bbox)); } catch { bad(res, 'TomTom unavailable', 502); }
  });

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
    for (const c of condos) {
      const n = faultBays(store.data.maintenance[c.id] || [], c.bays);
      if (n) out[`cs-${c.id}`] = n;
    }
    res.json({ sharing: store.data.sharing, checkins: store.data.checkins, activeBays, faultBays: out, live: csms.summaries() });
  });

  app.post(
    '/api/jmb/:condoId/resident-keys',
    requireJmb,
    (req, res) => {
      const condo = condoWithSharing(req.params.condoId);
  
      if (!condo) {
        return bad(res, 'Unknown condo', 404);
      }
  
      const residentKey =
        crypto.randomBytes(24).toString('base64url');
  
      const expiresAt = now() + 30 * 864e5;
  
      store.data.residentKeys[keyHash(residentKey)] = {
        condoId: condo.id,
        expiresAt
      };
  
      store.save();
  
      res.status(201).json({
        residentKey,
        expiresAt
      });
    }
  );

  app.post('/api/bookings', (req, res) => {
    const session = cleanSession(req.body?.session);
    if (!session) return bad(res, 'Invalid session');

    const booking = cleanBooking(req.body?.booking, session.chargerId);
    if (!booking) return bad(res, 'Invalid booking');

    const condo = condos.find(
      c => session.chargerId === `cs-${c.id}`
    );
    
    if (session.chargerId.startsWith('cs-') && !condo) {
      return bad(res, 'Unknown residential charging site', 404);
    }
    
    if (condo && session.condoId !== condo.id) {
      return bad(res, 'Condo does not match charger');
    }
    
    if (condo && session.role === 'visitor' && !req.body.pass) {
      return bad(res, 'Visitor pass details are required');
    }
    
    if (req.body.pass && (!condo || session.role !== 'visitor')) {
      return bad(res, 'Visitor passes are only for condo visitors');
    }

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

    if (condo) {
      const configured = condoWithSharing(condo.id);
    
      const availabilityArgs = {
        condo: configured,
        booking,
        role: session.role,
        existing: d.bookings,
        faults: faultBays(
          d.maintenance[condo.id] || [],
          condo.bays
        )
      };

      if (
        condo &&
        session.role === 'resident' &&
        !isResidentKey(req.body?.residentKey, condo.id)
      ) {
        return bad(
          res,
          'A JMB-issued resident access key is required for this condo',
          403
        );
      }
    
      const result = checkCondoBooking(availabilityArgs);
    
      if (!result.ok) {
        const alternatives = findAlternativeSlots(
          availabilityArgs
        );
    
        return res.status(409).json({
          error: result.error,
          alternatives
        });
      }
    }

    d.sessions = [...d.sessions, session].slice(-MAX_SESSIONS);
    d.bookings.push({
      id,
      ...booking,
      role: session.role,
      condoId: condo?.id || null,
      cancelToken,
      createdAt: now()
    });
    if (pass) d.passes.push(pass);
    store.save();
    res.status(201).json({ bookingId: id, cancelToken, pass });
  });

  // Booking -> physical bay check-in -> OCPP transaction. The cancel token is a
  // pilot bearer credential: never include it in the public world/JMB summary.
  const ownedBooking = (req, res) => {
    const booking = store.data.bookings.find(b => b.id === req.params.id);
    if (!booking) { bad(res, 'Booking not found', 404); return null; }
    const given = Buffer.from(String(req.body?.cancelToken || ''));
    const real = Buffer.from(booking.cancelToken);
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
      bad(res, 'Not your booking', 403);
      return null;
    }
    return booking;
  };

  app.post('/api/bookings/:id/check-in', (req, res) => {
    const booking = ownedBooking(req, res);
    if (!booking) return;
    const condo = condoWithSharing(booking.condoId);
    if (!condo) return bad(res, 'Check-in requires a residential charger', 409);
    const at = now();
    if (at < booking.start || at >= booking.end) return bad(res, 'Check-in is only allowed during the booked interval', 409);
    const bay = req.body?.bay;
    if (!Number.isInteger(bay) || bay < 1 || bay > condo.bays) return bad(res, 'Choose a valid bay');
    if (bayStatus(store.data.maintenance[condo.id] || [], condo.bays)[bay - 1]?.status === 'fault')
      return bad(res, 'This bay is out of service', 409);
    const point = csms.points.get(`${condo.id}-${bay}`);
    if (!point || point.status !== 'Available' || point.txId !== null)
      return bad(res, 'This charger is not currently available', 409);
    if (store.data.chargingSessions.some(s => s.bookingId === booking.id))
      return bad(res, 'This booking has already been checked in', 409);
    if (store.data.chargingSessions.some(s => s.condoId === condo.id && s.bay === bay &&
      (s.status === 'charging' || (s.status === 'awaiting_charge' && s.bookingEnd > at))))
      return bad(res, 'This bay is assigned to another charging session', 409);
    // OCPP idTag has a 20-character limit. Bind it to one booking and one bay.
    const idTag = `CS${crypto.randomBytes(8).toString('hex')}`;
    const record = {
      id: crypto.randomUUID(), bookingId: booking.id, condoId: condo.id, chargerId: booking.chargerId,
      role: booking.role, bay, status: 'awaiting_charge', bookingStart: booking.start,
      bookingEnd: booking.end, checkedInAt: at, tagHash: crypto.createHash('sha256').update(idTag).digest('hex'),
    };
    store.data.chargingSessions.push(record);
    store.save();
    // The frontend may show this tag to the resident or compatible charger.
    // The code does NOT remotely start a charger; charging must be initiated at the device.
    return res.status(201).json({ sessionId: record.id, bay, status: record.status, idTag });
  });

  app.post('/api/bookings/:id/charging-status', (req, res) => {
    const booking = ownedBooking(req, res);
    if (!booking) return;
    const s = store.data.chargingSessions.find(x => x.bookingId === booking.id);
    if (!s) return res.json({ status: 'not_checked_in' });
    const { id, bay, status, checkedInAt, startedAt, endedAt, energyKwh, revenueRm, reviewReason } = s;
    return res.json({ id, bay, status, checkedInAt, startedAt, endedAt, energyKwh, revenueRm, reviewReason });
  });

  app.get('/api/jmb/:condoId/charging-revenue', requireJmb, (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    if (!condo) return bad(res, 'Unknown condo', 404);
    const month = typeof req.query.month === 'string' ? req.query.month : malaysiaMonth(now());
    const report = chargingRevenueReport({
      sessions: store.data.chargingSessions, condo,
      maintenance: store.data.maintenance[condo.id] || [], month,
    });
    if (!report) return bad(res, 'Month must be YYYY-MM');
    return res.json(report);
  });

  app.delete('/api/bookings/:id', (req, res) => {
    const d = store.data;
    const b = d.bookings.find((x) => x.id === req.params.id);
    if (!b) return bad(res, 'Booking not found', 404);
    const given = Buffer.from(String(req.body?.cancelToken || ''));
    const real = Buffer.from(b.cancelToken);
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return bad(res, 'Not your booking', 403);
    const charging = d.chargingSessions.find((s) => s.bookingId === b.id);
    if (charging?.status === 'charging' || charging?.status === 'completed' || charging?.status === 'needs_review')
      return bad(res, 'Cannot cancel a booking after charging has started', 409);
    d.chargingSessions = d.chargingSessions.filter((s) => s.bookingId !== b.id);
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

  // ---- Residents vote on sharing changes ----
  const publicProposal = (condo) => {
    const p = store.data.proposals[condo.id];
    if (!p) return { proposal: null };
    const { votes, ...rest } = p;
    return { proposal: rest, tally: tally(p, condo.units) };
  };
  const voterKey = (id) => crypto.createHash('sha256').update(`cascas-vote:${id}`).digest('hex').slice(0, 24);

  app.get('/api/condos/:condoId/proposal', (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    if (!condo) return bad(res, 'Unknown condo', 404);
    res.json(publicProposal(condo));
  });

  app.post('/api/condos/:condoId/proposal/vote', (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    const p = condo && store.data.proposals[condo.id];
    if (!p) return bad(res, 'No vote is open for this condo', 404);
    const voter = String(req.body?.voterId || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(voter)) return bad(res, 'Invalid voter');
    const r = castVote(p, voterKey(voter), req.body?.vote, now());
    if (r.error) return bad(res, r.error, r.error.includes('closed') ? 409 : 400);
    store.data.proposals[condo.id] = r.proposal;
    store.save();
    res.json(publicProposal(condo));
  });

  app.post('/api/jmb/:condoId/proposal', requireJmb, (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    const next = cleanSharing(req.body?.settings);
    const err = next ? validateSharing(next, condo.bays) : 'Invalid settings';
    if (err) return bad(res, err);
    store.data.proposals[condo.id] = createProposal({ id: crypto.randomUUID(), condoId: condo.id, settings: next, now: now() });
    store.save();
    res.status(201).json(publicProposal(condo));
  });

  app.post('/api/jmb/:condoId/proposal/close', requireJmb, (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    const p = store.data.proposals[condo.id];
    if (!p || p.status !== 'open') return bad(res, 'No open vote', 409);
    const closed = closeProposal(p, condo.units, now());
    store.data.proposals[condo.id] = closed;
    if (closed.status === 'passed') store.data.sharing[condo.id] = closed.settings;
    store.save();
    res.json(publicProposal(condoWithSharing(condo.id)));
  });

  // Demo only: fill in votes from simulated residents, labelled as such in the proposal.
  app.post('/api/jmb/:condoId/proposal/sample', requireJmb, (req, res) => {
    const condo = condoWithSharing(req.params.condoId);
    let p = store.data.proposals[condo.id];
    if (!p || p.status !== 'open') return bad(res, 'No open vote', 409);
    const n = Math.min(condo.units, Math.max(1, Math.round(condo.units * 0.18)));
    for (let i = 0; i < n; i++) p = castVote(p, `sample-${i}`, i % 10 < 7 ? 'yes' : 'no', now()).proposal;
    p = { ...p, sampleVotes: n };
    store.data.proposals[condo.id] = p;
    store.save();
    res.json(publicProposal(condo));
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
