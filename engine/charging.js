// Booked-charge settlement: only linked OCPP meter start/stop readings can create revenue.
// Proposal 6.2 cost inputs are explicitly illustrative, not measured electricity bills.
import { costRecovery } from './recovery.js';
import { maintenanceCost } from './maintenance.js';

export const PILOT_COSTS = Object.freeze({ electricityRmPerKwh: 0.55, variableRmPerKwh: 0.05, fixedMonthlyRm: 500 });
export const roundMoney = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function settleMeteredCharge(session, meterStopWh, endedAt) {
  if (session.status !== 'charging') return { ...session, status: 'needs_review', reviewReason: 'No active transaction', endedAt };
  if (!Number.isFinite(session.meterStartWh) || session.meterStartWh < 0 ||
      !Number.isFinite(session.priceRmPerKwh) || session.priceRmPerKwh < 0 ||
      (Number.isFinite(session.startedAt) && endedAt < session.startedAt))
    return { ...session, status: 'needs_review', reviewReason: 'Invalid start meter, rate or timing', endedAt };
  const difference = (meterStopWh - session.meterStartWh) / 1000;
  if (!Number.isFinite(meterStopWh) || !Number.isFinite(difference) || difference < 0 || difference > 200) {
    return { ...session, status: 'needs_review', reviewReason: 'Invalid OCPP stop meter value', endedAt };
  }
  const energyKwh = Math.round(difference * 1000) / 1000;
  return {
    ...session, status: 'completed', endedAt, meterStopWh,
    energyKwh, revenueRm: roundMoney(energyKwh * session.priceRmPerKwh),
    electricityCostRm: roundMoney(energyKwh * PILOT_COSTS.electricityRmPerKwh),
    variableCostRm: roundMoney(energyKwh * PILOT_COSTS.variableRmPerKwh),
  };
}

export function malaysiaMonth(at) {
  // Malaysia has observed UTC+08 year-round. Finance periods use local calendar months.
  return new Date(at + 8 * 3600000).toISOString().slice(0, 7);
}

export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, m] = month.split('-').map(Number);
  if (year < 2000 || year > 2200) return null;
  return { from: Date.UTC(year, m - 1, 1) - 8 * 3600000, to: Date.UTC(year, m, 1) - 8 * 3600000 };
}

// Check the persisted OCPP evidence again at reporting time. This prevents a
// corrupted or duplicated stored row from being treated as a financial receipt.
// All detected exceptions require review; none is silently 'repaired' or billed.
export function completedChargeIssue(s) {
  if (!s || s.status !== 'completed') return 'not_completed';
  if (typeof s.id !== 'string' || !s.id || typeof s.bookingId !== 'string' || !s.bookingId ||
      !Number.isInteger(s.bay) || s.bay < 1 || !Number.isSafeInteger(s.transactionId) || s.transactionId < 1)
    return 'missing_transaction_identity';
  const fields = ['startedAt', 'endedAt', 'meterStartWh', 'meterStopWh',
    'energyKwh', 'priceRmPerKwh', 'revenueRm', 'electricityCostRm'];
  if (!fields.every(k => typeof s[k] === 'number' && Number.isFinite(s[k]) && s[k] >= 0))
    return 'invalid_meter_or_amount';
  if (s.endedAt < s.startedAt || s.meterStopWh < s.meterStartWh)
    return 'invalid_meter_or_time_order';
  const delivered = Math.round((s.meterStopWh - s.meterStartWh)) / 1000;
  if (Math.abs(delivered - s.energyKwh) > 0.001 ||
      Math.abs(roundMoney(s.energyKwh * s.priceRmPerKwh) - s.revenueRm) > 0.01 ||
      Math.abs(roundMoney(s.energyKwh * PILOT_COSTS.electricityRmPerKwh) - s.electricityCostRm) > 0.01)
    return 'inconsistent_meter_or_pricing';
  return null;
}

export function chargingRevenueReport({ sessions, condo, maintenance, month }) {
  const bounds = monthBounds(month);
  if (!bounds) return null;
  // Duplicates may be introduced by a corrupted store, import, or a legacy
  // server restart reusing an OCPP transaction number. Count globally so two
  // records across separate reporting months cannot both be billed.
  const completedAll = sessions.filter(s => s.status === 'completed');
  const keyCounts = new Map();
  for (const s of completedAll) {
    for (const key of [
      s.id && `id:${s.id}`,
      s.bookingId && `booking:${s.bookingId}`,
      Number.isSafeInteger(s.transactionId) && `ocpp:${s.transactionId}`,
    ]) {
      if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
  }
  const candidates = completedAll.filter(s => s.condoId === condo.id &&
    s.endedAt >= bounds.from && s.endedAt < bounds.to);
  const completed = [];
  const reviewItems = [];
  let excludedCompletedCount = 0;
  for (const s of candidates) {
    const duplicate = [s.id && `id:${s.id}`, s.bookingId && `booking:${s.bookingId}`,
      Number.isSafeInteger(s.transactionId) && `ocpp:${s.transactionId}`]
      .some(key => key && keyCounts.get(key) > 1);
    const reason = duplicate ? 'duplicate_transaction' : completedChargeIssue(s);
    if (reason) {
      excludedCompletedCount++;
      reviewItems.push({ id: s.id, bookingId: s.bookingId, bay: s.bay, reason });
    } else completed.push(s);
  }
  // Reconciliation exceptions are dated by check-in (or charging start), not
  // completion, because interrupted sessions don't have a valid end reading.
  for (const s of sessions) {
    if (s.condoId !== condo.id || s.status !== 'needs_review') continue;
    const at = s.startedAt ?? s.checkedInAt;
    if (typeof at === 'number' && at >= bounds.from && at < bounds.to)
      reviewItems.push({ id: s.id, bookingId: s.bookingId, bay: s.bay,
        reason: s.reviewReason || 'charging_session_requires_review' });
  }
  // Keep the same output shape for the existing JMB UI and sort the ledger
  // deterministically for easier comparison/export.
  completed.sort((a, b) => a.endedAt - b.endedAt || a.id.localeCompare(b.id));
  const energyKwh = completed.reduce((a, s) => a + s.energyKwh, 0);
  const receipts = completed.reduce((a, s) => a + s.revenueRm, 0);
  const electricityCostRm = completed.reduce((a, s) => a + s.electricityCostRm, 0);
  const maintenanceRm = maintenanceCost(maintenance, bounds.from, bounds.to);
  const financials = costRecovery({
    kWh: Math.round(energyKwh * 1000) / 1000,
    revenue: roundMoney(receipts), electricityCost: roundMoney(electricityCostRm),
    variablePerKwh: PILOT_COSTS.variableRmPerKwh, fixedMonthly: PILOT_COSTS.fixedMonthlyRm,
    maintenanceRm, jmbShare: condo.jmbShare, units: condo.units,
  });
  const safeRows = completed.map(({ id, bookingId, bay, role, startedAt, endedAt, energyKwh, priceRmPerKwh, revenueRm }) =>
    ({ id, bookingId, bay, role, startedAt, endedAt, energyKwh, priceRmPerKwh, revenueRm }));
  return {
    condoId: condo.id, month, sessionCount: completed.length, sessions: safeRows,
    reconciliation: { reviewCount: reviewItems.length, excludedCompletedCount, items: reviewItems },
    financials, costAssumptions: { ...PILOT_COSTS, jmbShare: condo.jmbShare },
    evidence: 'booked OCPP transactions; no forecasts or simulated month totals included',
    warning: 'Only energy and receipts are derived from linked meter readings. Electricity, variable/fixed costs and revenue share are illustrative assumptions; this is not an audited profit statement.',
  };
}
