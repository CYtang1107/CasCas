// Simulated OCPP 1.6-J chargers, one per condo bay, so the demo has live chargers to talk to.
// They boot, report status, start and stop sessions, send meter values and obey charging limits.
// Time runs 60x faster for energy, matching the driver's charging screen (1 second = 1 minute).
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { parseFrame, call, callResult, callError, BAY_KW } from '../engine/ocpp.js';

const SPEED = 60;

export function startSimulator({ url, password, condos, tickMs = 5000, rand = Math.random, pStart = 0.15, pStop = 0.08 }) {
  const chargers = new Map();
  let stopped = false;

  function charger(condoId, bay) {
    const id = `${condoId}-${bay}`;
    const c = { id, ws: null, status: 'Available', limitKw: BAY_KW, energyWh: Math.round(rand() * 5e6), txId: null, open: false };
    const send = (action, payload) => {
      if (!c.open) return;
      const msgId = crypto.randomUUID();
      c.waiting.set(msgId, action);
      c.ws.send(call(msgId, action, payload));
    };
    c.waiting = new Map();
    c.send = send;
    c.demoLinked = false;
    c.demoPending = false;
    c.demoStartWh = null;
    c.demoCapWh = 0;
    // Await actual OCPP CALLRESULT frames; don't fabricate a completed session.
    c.rpc = (action, payload) => new Promise((resolve, reject) => {
      if (!c.open || c.ws.readyState !== WebSocket.OPEN) return reject(new Error('Simulated charger disconnected'));
      const msgId = crypto.randomUUID();
      const timer = setTimeout(() => { c.waiting.delete(msgId); reject(new Error(`OCPP ${action} timed out`)); }, 3000);
      c.waiting.set(msgId, { action, resolve: (frame) => {
        clearTimeout(timer);
        if (frame.type !== 'result') reject(new Error(`OCPP ${action} failed`));
        else resolve(frame.payload);
      }, reject: (reason) => { clearTimeout(timer); reject(reason); } });
      try { c.ws.send(call(msgId, action, payload)); }
      catch { c.waiting.delete(msgId); clearTimeout(timer); reject(new Error('Simulated charger disconnected')); }
    });
    c.status_ = (status, errorCode = 'NoError') => { c.status = status; send('StatusNotification', { connectorId: 1, status, errorCode, timestamp: new Date().toISOString() }); };

    function open() {
      if (stopped) return;
      const auth = Buffer.from(`${id}:${password}`).toString('base64');
      c.ws = new WebSocket(`${url}/ocpp/${id}`, 'ocpp1.6', { headers: { authorization: `Basic ${auth}` } });
      c.ws.on('open', () => {
        c.open = true;
        send('BootNotification', { chargePointVendor: 'CasSama Sim', chargePointModel: 'AC 7 kW' });
        c.status_(c.status === 'Faulted' ? 'Faulted' : 'Available');
      });
      c.ws.on('message', (data) => {
        const f = parseFrame(String(data));
        if (!f) return;
        if (f.type === 'call') {
          if (f.action === 'SetChargingProfile') {
            const limit = f.payload?.csChargingProfiles?.chargingSchedule?.chargingSchedulePeriod?.[0]?.limit;
            if (Number.isFinite(limit)) c.limitKw = Math.min(BAY_KW, limit / 1000);
            c.ws.send(callResult(f.id, { status: 'Accepted' }));
          } else c.ws.send(callError(f.id, 'NotImplemented', `${f.action} is not simulated`));
          return;
        }
        const pending = c.waiting.get(f.id);
        c.waiting.delete(f.id);
        if (typeof pending === 'object') pending.resolve(f);
        else if (pending === 'StartTransaction' && f.type === 'result' && f.payload?.idTagInfo?.status === 'Accepted')
          c.txId = f.payload.transactionId;
      });
      c.ws.on('close', () => {
        c.open = false;
        c.txId = null;
        c.demoLinked = false;
        c.demoStartWh = null;
        c.demoCapWh = 0;
        for (const entry of c.waiting.values()) if (typeof entry === 'object') entry.reject(new Error('Charger disconnected'));
        c.waiting.clear();
        if (!stopped) setTimeout(open, 3000);
      });
      c.ws.on('error', () => {});
    }
    c.connect = open;
    return c;
  }

  const start = (c) => { c.send('StartTransaction', { connectorId: 1, idTag: 'CASSAMA', meterStart: c.energyWh, timestamp: new Date().toISOString() }); c.status_('Charging'); };
  const stop = (c) => { c.send('StopTransaction', { transactionId: c.txId ?? 0, meterStop: c.energyWh, timestamp: new Date().toISOString() }); c.txId = null; };

  for (const condo of condos) for (let b = 1; b <= condo.bays; b++) {
    const c = charger(condo.id, b);
    chargers.set(c.id, c);
    c.connect();
  }

  const timer = setInterval(() => {
    for (const c of chargers.values()) {
      if (!c.open || c.status === 'Faulted') continue;
      if (c.status === 'Available' && rand() < pStart) { start(c); continue; }
      if (c.status !== 'Charging' || (c.demoLinked && c.demoPending)) continue;
      const kw = c.limitKw * (0.9 + rand() * 0.1);
      const nextWh = c.energyWh + Math.round(kw * 1000 * (tickMs / 3600e3) * SPEED);
      // Booking-linked demo charging reports genuine OCPP MeterValues throughout
      // the animation. The accelerator is an explicitly simulated 60x clock.
      // Never go beyond the server-selected sample cap or auto-settle a booking.
      c.energyWh = c.demoLinked
        ? Math.min(c.demoStartWh + c.demoCapWh, nextWh)
        : nextWh;
      c.send('MeterValues', { connectorId: 1, transactionId: c.txId ?? 0, meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [
        { value: String(c.energyWh), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
        { value: String(Math.round(c.demoLinked && c.energyWh >= c.demoStartWh + c.demoCapWh ? 0 : kw * 1000)), measurand: 'Power.Active.Import', unit: 'W' },
      ] }] });
      if (!c.demoLinked && rand() < pStop) { stop(c); c.status_('Available'); }
    }
  }, tickMs);
  timer.unref?.();

  return {
    // Demo controls below ONLY operate the WebSocket clients created by this simulator.
    // Production hardware cannot be started by these methods.
    ownsConnection(condoId, bay, ws) {
      const c = chargers.get(`${condoId}-${bay}`);
      // The CSMS and simulator own opposite ends of the WebSocket connection.
      // Match the TCP peer port to this simulator's local port, so a different
      // real/third-party charger connecting under the same bay ID is rejected.
      return !!c?.open && c.ws?.readyState === WebSocket.OPEN &&
        Number.isInteger(ws?._socket?.remotePort) &&
        ws._socket.remotePort === c.ws?._socket?.localPort &&
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ws._socket.remoteAddress);
    },
    async startBooking(condoId, bay, idTag, maxEnergyKwh = 5) {
      const c = chargers.get(`${condoId}-${bay}`);
      if (!c?.open || c.status !== 'Available' || c.txId != null || c.demoPending)
        throw new Error('The simulated bay is not available');
      if (!Number.isFinite(maxEnergyKwh) || maxEnergyKwh <= 0 || maxEnergyKwh > 5)
        throw new Error('Invalid simulated session energy cap');
      c.demoPending = true;
      try {
        const auth = await c.rpc('Authorize', { idTag });
        if (auth?.idTagInfo?.status !== 'Accepted') throw new Error('Charger authorization failed');
        const started = await c.rpc('StartTransaction', {
          connectorId: 1, idTag, meterStart: c.energyWh, timestamp: new Date().toISOString(),
        });
        if (started?.idTagInfo?.status !== 'Accepted' || !Number.isSafeInteger(started.transactionId) || started.transactionId < 1)
          throw new Error('Charger refused the booking transaction');
        c.txId = started.transactionId;
        c.demoStartWh = c.energyWh;
        c.demoCapWh = Math.round(maxEnergyKwh * 1000);
        c.demoLinked = true;
        c.status_('Charging');
        return { transactionId: c.txId };
      } finally { c.demoPending = false; }
    },
    async finishBooking(condoId, bay, energyKwh) {
      const c = chargers.get(`${condoId}-${bay}`);
      if (!c?.open || !c.demoLinked || !Number.isSafeInteger(c.txId) || c.txId < 1 || c.demoPending)
        throw new Error('No simulated booking transaction is charging on this bay');
      if (!Number.isFinite(energyKwh) || energyKwh <= 0 || energyKwh > 20)
        throw new Error('Invalid demo energy');
      c.demoPending = true;
      try {
        // Preserve the interim readings already sent via OCPP. For immediate
        // demo completion, deliver a bounded 0.1 kWh minimum sample so the
        // transaction still has a nonzero, explicitly simulated meter delta.
        const capWh = c.demoStartWh + c.demoCapWh;
        const nextWh = Math.min(capWh, Math.max(c.energyWh, c.demoStartWh + 100));
        await c.rpc('MeterValues', { connectorId: 1, transactionId: c.txId,
          meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [
            { value: String(nextWh), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
          ] }],
        });
        const ended = await c.rpc('StopTransaction', {
          transactionId: c.txId, meterStop: nextWh, timestamp: new Date().toISOString(),
        });
        if (ended?.idTagInfo?.status !== 'Accepted') throw new Error('Charger did not confirm StopTransaction');
        const deliveredKwh = (nextWh - c.demoStartWh) / 1000;
        c.energyWh = nextWh;
        c.txId = null;
        c.demoLinked = false;
        c.demoStartWh = null;
        c.demoCapWh = 0;
        c.status_('Available');
        return { energyKwh: Math.round(deliveredKwh * 1000) / 1000 };
      } finally { c.demoPending = false; }
    },
    // Demo controls for the JMB page: break a bay or bring it back.
    inject(condoId, bay, action) {
      const c = chargers.get(`${condoId}-${bay}`);
      if (!c || !c.open) return false;
      if (action === 'fault') { if (c.status === 'Charging') stop(c); c.status_('Faulted', 'GroundFailure'); }
      else c.status_('Available');
      return true;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const c of chargers.values()) c.ws?.terminate();
    },
  };
}
