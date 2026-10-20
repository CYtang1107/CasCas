import { CONST } from '../config.js';
import { priceAt } from './pricing.js';
import { occupancyAt } from './occupancy.js';
import { costRecovery } from './recovery.js';

export function co2AvoidedKg(kWh) {
  return (kWh / CONST.evKwhPerKm) * (CONST.petrolKgPerKm - CONST.evKwhPerKm * CONST.gridKgPerKwh);
}

export function monthlyEconomics({ residentKwh, visitorKwh, residentRevenue, visitorRevenue, electricityCost, jmbShare, units, bays }) {
  const kWhSold = residentKwh + visitorKwh;
  const revenue = residentRevenue + visitorRevenue;
  const margin = revenue - electricityCost;
  const jmbIncome = margin * jmbShare;
  return {
    kWhSold, revenue, electricityCost, margin, jmbIncome,
    perUnitSaving: jmbIncome / units,
    paybackMonths: margin > 0 ? Math.ceil((bays * CONST.hardwarePerBay) / margin) : null,
    co2AvoidedKg: co2AvoidedKg(kWhSold),
  };
}

function eachHour(start, days, fn) {
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) fn(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, h, 30), h);
  }
}

// `maintenanceRm` is what the JMB logged for repairs and services this month.
export function simulateCondoMonth(condo, charger, start, { occupancyFn = occupancyAt, days = 30, maintenanceRm = 0 } = {}) {
  const residentByHour = Array(24).fill(0);
  const visitorByHour = Array(24).fill(0);
  let residentKwh = 0, visitorKwh = 0, residentRevenue = 0, visitorRevenue = 0, electricityCost = 0;
  const kwPerBay = charger.kw * CONST.drawFactor;

  eachHour(start, days, (t, h) => {
    const occ = occupancyFn(charger, t, condo);
    const rK = occ.resident * condo.bays * kwPerBay;
    const vK = occ.visitor * condo.bays * kwPerBay;
    residentKwh += rK;
    visitorKwh += vK;
    residentRevenue += rK * priceAt(charger, t, condo, true);
    visitorRevenue += vK * priceAt(charger, t, condo, false);
    electricityCost += (rK + vK) * CONST.electricityCostPerKwh;
    residentByHour[h] += rK / days;
    visitorByHour[h] += vK / days;
  });

  const econ = monthlyEconomics({
    residentKwh, visitorKwh, residentRevenue, visitorRevenue, electricityCost,
    jmbShare: condo.jmbShare, units: condo.units, bays: condo.bays,
  });
  const utilisation = (residentKwh + visitorKwh) / (condo.bays * charger.kw * 24 * days);
  // The JMB is paid from the operating surplus after every cost, not just electricity.
  const recovery = costRecovery({
    kWh: econ.kWhSold, revenue: econ.revenue, electricityCost, variablePerKwh: CONST.otherCostPerKwh,
    fixedMonthly: CONST.fixedPerBayMonthly * condo.bays * (days / 30), maintenanceRm, jmbShare: condo.jmbShare, units: condo.units,
  });
  return {
    ...econ, residentKwh, visitorKwh, residentRevenue, visitorRevenue, residentByHour, visitorByHour, utilisation, recovery,
    jmbIncome: recovery.jmbIncome, perUnitSaving: recovery.perUnit,
    paybackMonths: recovery.operatingSurplus > 0 ? Math.ceil((condo.bays * CONST.hardwarePerBay) / recovery.operatingSurplus) : null,
  };
}

// Six months ending at `value`, a simple simulated ramp-up as EV ownership grows.
export function rampSeries(value) {
  return [0.62, 0.7, 0.78, 0.85, 0.93, 1].map((f) => value * f);
}
