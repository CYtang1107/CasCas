// OCPP 1.6-J helpers (pure): message frames, charge point ids, load sharing and meter values.
// Frames are JSON arrays: [2, id, action, payload] CALL, [3, id, payload] CALLRESULT,
// [4, id, errorCode, description, details] CALLERROR.

export function parseFrame(text) {
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(m) || typeof m[1] !== 'string' || m[1].length > 36) return null;
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (m[0] === 2 && typeof m[2] === 'string' && obj(m[3])) return { type: 'call', id: m[1], action: m[2], payload: m[3] };
  if (m[0] === 3 && obj(m[2])) return { type: 'result', id: m[1], payload: m[2] };
  if (m[0] === 4 && typeof m[2] === 'string') return { type: 'error', id: m[1], code: m[2], description: String(m[3] ?? '') };
  return null;
}

export const call = (id, action, payload) => JSON.stringify([2, id, action, payload]);
export const callResult = (id, payload) => JSON.stringify([3, id, payload]);
export const callError = (id, code, description) => JSON.stringify([4, id, code, description, {}]);

// One charge point per condo bay: "lumina-3" is bay 3 at Residensi Lumina.
export function parsePointId(id, condos) {
  const m = /^([a-z]{1,20})-(\d{1,2})$/.exec(String(id));
  if (!m) return null;
  const condo = condos.find((c) => c.id === m[1]);
  const bay = Number(m[2]);
  return condo && bay >= 1 && bay <= condo.bays ? { condoId: condo.id, bay } : null;
}

// Safe total charging power for a condo car park. Until a real electrical assessment sets
// loadLimitKw, assume 60% of the nameplate total (7 kW per bay).
export const BAY_KW = 7;
export function siteLimitKw(condo) {
  return condo.loadLimitKw ?? Math.round(condo.bays * BAY_KW * 0.6);
}

export function shareLoad(limitKw, charging, maxKw = BAY_KW) {
  return charging > 0 ? Math.min(maxKw, limitKw / charging) : maxKw;
}

export function chargingProfile(kw) {
  return {
    connectorId: 1,
    csChargingProfiles: {
      chargingProfileId: 1, stackLevel: 0, chargingProfilePurpose: 'TxDefaultProfile', chargingProfileKind: 'Relative',
      chargingSchedule: { chargingRateUnit: 'W', chargingSchedulePeriod: [{ startPeriod: 0, limit: Math.round(kw * 1000) }] },
    },
  };
}

// Latest energy register (Wh) and power (W) from a MeterValues payload. Energy is the default measurand.
export function meterReading(payload) {
  let energyWh = null;
  let powerW = null;
  for (const mv of payload?.meterValue || []) {
    for (const sv of mv?.sampledValue || []) {
      const v = Number(sv?.value);
      if (!Number.isFinite(v)) continue;
      const k = String(sv.unit || '').toLowerCase().startsWith('k') ? 1000 : 1;
      if (!sv.measurand || sv.measurand === 'Energy.Active.Import.Register') energyWh = v * k;
      else if (sv.measurand === 'Power.Active.Import') powerW = v * k;
    }
  }
  return { energyWh, powerW };
}

export function liveSummary(points, bays) {
  const n = (s) => points.filter((p) => p.status === s).length;
  const charging = n('Charging');
  const available = n('Available');
  const faulted = n('Faulted');
  const other = points.length - charging - available - faulted;
  return { charging, available, faulted, other, offline: Math.max(0, bays - points.length), total: bays };
}
