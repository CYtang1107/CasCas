// A small OCPP 1.6-J central system for the condo bays. Chargers connect over WebSocket to
// /ocpp/<condo>-<bay> with the "ocpp1.6" subprotocol and HTTP Basic auth (OCPP security profile 1).
// It keeps live status and meter values, logs faults in the JMB maintenance log, and caps each
// charging bay with SetChargingProfile so a condo never exceeds its safe load limit.
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { parseFrame, call, callResult, callError, parsePointId, siteLimitKw, shareLoad, chargingProfile, meterReading, liveSummary, BAY_KW } from '../engine/ocpp.js';
import { cleanEntry } from '../engine/maintenance.js';
import { priceAt } from '../engine/pricing.js';
import { settleMeteredCharge } from '../engine/charging.js';

const MAX_MAINTENANCE = 500;
const CALL_TIMEOUT_MS = 10000;

function passwordOk(header, id, password) {
  const m = /^Basic (.+)$/.exec(String(header || ''));
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  const given = Buffer.from(rest.join(':'));
  const real = Buffer.from(password);
  return user === id && given.length === real.length && crypto.timingSafeEqual(given, real);
}

export function createCsms({ store, condos, password, now = () => Date.now() }) {
  const points = new Map(); // id -> live state
  const pending = new Map(); // our CALL id -> resolve
  // Sequence is persisted in the store so reconnects/restarts cannot reuse
  // OCPP transaction ids from previously settled charging sessions.
  const hashTag = (tag) => crypto.createHash('sha256').update(tag).digest('hex');
  const activeTag = (p, idTag) => store.data.chargingSessions.find(s =>
    s.tagHash === hashTag(idTag) && s.condoId === p.condoId && s.bay === p.bay &&
    s.status === 'awaiting_charge' && s.bookingStart <= now() && s.bookingEnd > now()
  );
  // Demo OCPP simulator uses CASSAMA, not issued reservation tags. Those transactions
  // remain unlinked and are deliberately excluded from the financial ledger.
  const bookedTag = (tag) => typeof tag === 'string' && /^CS[a-f0-9]{16}$/.test(tag);


  const log = (p, kind, note) => {
    const list = store.data.maintenance[p.condoId] || [];
    store.data.maintenance[p.condoId] = [...list, cleanEntry({ bay: p.bay, kind, costRm: 0, at: now(), note })].slice(-MAX_MAINTENANCE);
    store.save();
  };

  const send = (p, action, payload) => new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, CALL_TIMEOUT_MS);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    try { p.ws.send(call(id, action, payload)); } catch { pending.delete(id); clearTimeout(timer); resolve(null); }
  });

  // Share the condo's safe limit between the bays that are charging right now.
  function rebalance(condoId) {
    const condo = condos.find((c) => c.id === condoId);
    const charging = [...points.values()].filter((p) => p.condoId === condoId && p.status === 'Charging');
    const kw = shareLoad(siteLimitKw(condo), charging.length);
    for (const p of charging) {
      if (Math.abs(p.limitKw - kw) < 0.01) continue;
      p.limitKw = kw;
      send(p, 'SetChargingProfile', chargingProfile(kw));
    }
  }

  const handlers = {
    BootNotification: (p, m) => { p.model = String(m.chargePointModel || '').slice(0, 40); return { status: 'Accepted', currentTime: new Date(now()).toISOString(), interval: 60 }; },
    Heartbeat: () => ({ currentTime: new Date(now()).toISOString() }),
    Authorize: (p, m) => ({ idTagInfo: {
      status: bookedTag(m.idTag) && (!activeTag(p, m.idTag) || p.status === 'Faulted') ? 'Invalid' : 'Accepted',
    } }),
    StatusNotification: (p, m) => {
      if (m.connectorId === 0) return {};
      const prev = p.status;
      p.status = String(m.status || 'Unknown');
      p.errorCode = String(m.errorCode || 'NoError');
      if (p.status === 'Faulted' && prev !== 'Faulted') log(p, 'fault', `OCPP: charger reported ${p.errorCode}`);
      if (prev === 'Faulted' && p.status !== 'Faulted') log(p, 'repair', 'OCPP: charger back in service');
      if (p.status !== 'Charging') { p.powerW = 0; p.limitKw = BAY_KW; }
      rebalance(p.condoId);
      return {};
    },
    StartTransaction: (p, m) => {
      const tag = String(m.idTag || '');
      const matched = bookedTag(tag) ? activeTag(p, tag) : null;
      const meterStart = m.meterStart;
      if (p.txId !== null || p.status === 'Faulted' ||
          (bookedTag(tag) && !matched) ||
          (matched && (!Number.isFinite(meterStart) || meterStart < 0))) {
        return { transactionId: -1, idTagInfo: { status: 'Invalid' } };
      }
      if (!Number.isSafeInteger(store.data.nextOcppTransactionId) ||
          store.data.nextOcppTransactionId >= Number.MAX_SAFE_INTEGER)
        return { transactionId: -1, idTagInfo: { status: 'Invalid' } };
      p.txId = store.data.nextOcppTransactionId++;
      // Persist allocation before acknowledging StartTransaction, including
      // non-booked simulator activity. Prevents id reuse after a restart.
      store.save();
      p.energyWh = Number.isFinite(meterStart) && meterStart >= 0 ? meterStart : 0;
      p.sessionStartWh = p.energyWh;
      p.linkedSessionId = matched?.id || null;
      if (matched) {
        const condo = condos.find(c => c.id === p.condoId);
        const configured = { ...condo, sharing: { ...condo.sharing, ...(store.data.sharing[condo.id] || {}) } };
        matched.status = 'charging';
        matched.startedAt = now();
        matched.meterStartWh = p.energyWh;
        matched.transactionId = p.txId;
        matched.priceRmPerKwh = priceAt({ siteType: 'condo' }, new Date(now()), configured, matched.role === 'resident');
        store.save();
      }
      return { transactionId: p.txId, idTagInfo: { status: 'Accepted' } };
    },
    StopTransaction: (p, m) => {
      if (p.txId === null || m.transactionId !== p.txId)
        return { idTagInfo: { status: 'Invalid' } };
      if (p.linkedSessionId) {
        const n = store.data.chargingSessions.findIndex(s => s.id === p.linkedSessionId);
        if (n !== -1) {
          // Billing requires a valid stop reading from the OCPP charger, not client input.
          const stopWh = typeof m.meterStop === 'number' ? m.meterStop : NaN;
          store.data.chargingSessions[n] = settleMeteredCharge(store.data.chargingSessions[n], stopWh, now());
          store.save();
        }
      }
      p.linkedSessionId = null;
      p.txId = null;
      p.powerW = 0;
      p.limitKw = BAY_KW;
      return { idTagInfo: { status: 'Accepted' } };
    },
    MeterValues: (p, m) => {
      // A linked session must not display readings from a different transaction.
      if (p.linkedSessionId && m.transactionId != null && m.transactionId !== p.txId) return {};
      const r = meterReading(m);
      if (r.energyWh != null) p.energyWh = r.energyWh;
      if (r.powerW != null) p.powerW = r.powerW;
      return {};
    },
  };

  function connect(ws, id, where) {
    const old = points.get(id);
    if (old) old.ws.terminate();
    const p = { id, ...where, ws, status: 'Unknown', errorCode: 'NoError', powerW: 0, energyWh: 0, sessionStartWh: 0, limitKw: BAY_KW, txId: null, linkedSessionId: null, lastSeen: now(), model: '' };
    points.set(id, p);
    ws.on('message', (data) => {
      p.lastSeen = now();
      const f = parseFrame(String(data));
      if (!f) { ws.send(callError('-1', 'FormationViolation', 'Not an OCPP-J frame')); return; }
      if (f.type === 'call') {
        const h = handlers[f.action];
        ws.send(h ? callResult(f.id, h(p, f.payload)) : callError(f.id, 'NotImplemented', `${f.action} is not supported`));
        return;
      }
      const done = pending.get(f.id);
      if (done) { pending.delete(f.id); done(f); }
    });
    ws.on('close', () => {
      // Do not auto-bill on disconnection. The session remains pending reconciliation
      // with a valid OCPP StopTransaction/meter stop reading.
      if (p.linkedSessionId) {
        const session = store.data.chargingSessions.find(s => s.id === p.linkedSessionId);
        if (session?.status === 'charging') {
          session.status = 'needs_review';
          session.reviewReason = 'Charger disconnected before StopTransaction';
          store.save();
        }
      }
      if (points.get(id) === p) { points.delete(id); rebalance(p.condoId); }
    });
  }

  function attach(httpServer) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, handleProtocols: (ps) => (ps.has('ocpp1.6') ? 'ocpp1.6' : false) });
    httpServer.on('upgrade', (req, socket, head) => {
      const m = /^\/ocpp\/([^/?]+)$/.exec(req.url || '');
      const id = m ? decodeURIComponent(m[1]) : '';
      const where = parsePointId(id, condos);
      if (!where) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
      if (!passwordOk(req.headers.authorization, id, password)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => connect(ws, id, where));
    });
    return wss;
  }

  function snapshot(condoId) {
    const condo = condos.find((c) => c.id === condoId);
    const list = [...points.values()].filter((p) => p.condoId === condoId).sort((a, b) => a.bay - b.bay);
    return {
      protocol: 'OCPP 1.6-J',
      limitKw: siteLimitKw(condo),
      loadKw: list.reduce((s, p) => s + p.powerW, 0) / 1000,
      summary: liveSummary(list, condo.bays),
      points: list.map((p) => ({
        bay: p.bay, status: p.status, errorCode: p.errorCode, powerKw: p.powerW / 1000, limitKw: p.limitKw,
        sessionKwh: p.txId ? (p.energyWh - p.sessionStartWh) / 1000 : 0, lastSeen: p.lastSeen,
      })),
    };
  }

  function summaries() {
    const out = {};
    for (const c of condos) {
      const list = [...points.values()].filter((p) => p.condoId === c.id);
      if (list.length) out[`cs-${c.id}`] = liveSummary(list, c.bays);
    }
    return out;
  }

  return { attach, snapshot, summaries, points };
}
