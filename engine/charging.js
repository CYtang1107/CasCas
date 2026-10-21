// Booked-charge settlement: only linked OCPP meter start/stop readings can create revenue.
// Proposal 6.2 cost inputs are explicitly illustrative, not measured electricity bills.
import { costRecovery } from './recovery.js';
import { maintenanceCost } from './maintenance.js';

export const PILOT_COSTS = Object.freeze({ electricityRmPerKwh: 0.55, variableRmPerKwh: 0.05, fixedMonthlyRm: 500 });
export const roundMoney = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function settleMeteredCharge(session, meterStopWh, endedAt) {
  if (session.status !== 'charging') return { ...session, status: 'needs_review', reviewReason: 'No active transaction', endedAt };
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

export function chargingRevenueReport({ sessions, condo, maintenance, month }) {
  const bounds = monthBounds(month);
  if (!bounds) return null;
  const completed = sessions.filter(s => s.condoId === condo.id && s.status === 'completed' && s.endedAt >= bounds.from && s.endedAt < bounds.to);
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
    financials, costAssumptions: { ...PILOT_COSTS, jmbShare: condo.jmbShare },
    evidence: 'booked OCPP transactions; no forecasts or simulated month totals included',
    warning: 'Only energy and receipts are derived from linked meter readings. Electricity, variable/fixed costs and revenue share are illustrative assumptions; this is not an audited profit statement.',
  };
}
