import { CONST } from '../config.js';
import { tnbRate } from '../data/tariff.js';
import { priceAt } from './pricing.js';
import { occupancyAt } from './occupancy.js';

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

export function simulateCondoMonth(condo, charger, start, { occupancyFn = occupancyAt, days = 30 } = {}) {
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
    electricityCost += (rK + vK) * tnbRate(t);
    residentByHour[h] += rK / days;
    visitorByHour[h] += vK / days;
  });

  const econ = monthlyEconomics({
    residentKwh, visitorKwh, residentRevenue, visitorRevenue, electricityCost,
    jmbShare: condo.jmbShare, units: condo.units, bays: condo.bays,
  });
  const utilisation = (residentKwh + visitorKwh) / (condo.bays * charger.kw * 24 * days);
  return { ...econ, residentKwh, visitorKwh, residentRevenue, visitorRevenue, residentByHour, visitorByHour, utilisation };
}

export function siteMonthlyKwh(charger, start, { occupancyFn = occupancyAt, days = 30 } = {}) {
  let kWh = 0;
  eachHour(start, days, (t) => { kWh += occupancyFn(charger, t, null).total * charger.bays * charger.kw * CONST.drawFactor; });
  return kWh;
}

export function townshipSummary(condos, chargers, start, opts = {}) {
  const perCondo = condos.map((condo) => {
    const charger = chargers.find((ch) => ch.condoId === condo.id);
    return { condo, ...simulateCondoMonth(condo, charger, start, opts) };
  });
  const sdpSiteKwh = chargers
    .filter((ch) => ch.siteType !== 'condo' && ch.sdp)
    .reduce((s, ch) => s + siteMonthlyKwh(ch, start, opts), 0);
  const condoKwh = perCondo.reduce((s, r) => s + r.kWhSold, 0);
  const condoBays = condos.reduce((s, c) => s + c.bays, 0);
  const utilisation = perCondo.reduce((s, r) => s + r.utilisation * r.condo.bays, 0) / condoBays;
  return {
    perCondo,
    totals: {
      condoKwh, sdpSiteKwh, kWh: condoKwh + sdpSiteKwh,
      jmbIncome: perCondo.reduce((s, r) => s + r.jmbIncome, 0),
      co2Kg: co2AvoidedKg(condoKwh + sdpSiteKwh),
      condoBays, utilisation,
    },
  };
}

export function scaleUp(totals, townships) {
  const bays = totals.condoBays * townships;
  return {
    townships, bays,
    jmbIncomeYear: totals.jmbIncome * 12 * townships,
    co2TonnesYear: (totals.co2Kg * 12 * townships) / 1000,
    shareOfNationalTarget: bays / CONST.nationalTarget2030,
  };
}

// Six months ending at `value`, a simple simulated ramp-up as EV ownership grows.
export function rampSeries(value) {
  return [0.62, 0.7, 0.78, 0.85, 0.93, 1].map((f) => value * f);
}
