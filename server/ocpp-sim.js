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
    c.status_ = (status, errorCode = 'NoError') => { c.status = status; send('StatusNotification', { connectorId: 1, status, errorCode, timestamp: new Date().toISOString() }); };

    function open() {
      if (stopped) return;
      const auth = Buffer.from(`${id}:${password}`).toString('base64');
      c.ws = new WebSocket(`${url}/ocpp/${id}`, 'ocpp1.6', { headers: { authorization: `Basic ${auth}` } });
      c.ws.on('open', () => {
        c.open = true;
        send('BootNotification', { chargePointVendor: 'CasCas Sim', chargePointModel: 'AC 7 kW' });
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
        const action = c.waiting.get(f.id);
        c.waiting.delete(f.id);
        if (action === 'StartTransaction' && f.type === 'result') c.txId = f.payload.transactionId;
      });
      c.ws.on('close', () => { c.open = false; if (!stopped) setTimeout(open, 3000); });
      c.ws.on('error', () => {});
    }
    c.connect = open;
    return c;
  }

  const start = (c) => { c.send('StartTransaction', { connectorId: 1, idTag: 'CASCAS', meterStart: c.energyWh, timestamp: new Date().toISOString() }); c.status_('Charging'); };
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
      if (c.status !== 'Charging') continue;
      const kw = c.limitKw * (0.9 + rand() * 0.1);
      c.energyWh += Math.round(kw * 1000 * (tickMs / 3600e3) * SPEED);
      c.send('MeterValues', { connectorId: 1, transactionId: c.txId ?? 0, meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [
        { value: String(c.energyWh), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
        { value: String(Math.round(kw * 1000)), measurand: 'Power.Active.Import', unit: 'W' },
      ] }] });
      if (rand() < pStop) { stop(c); c.status_('Available'); }
    }
  }, tickMs);
  timer.unref?.();

  return {
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
