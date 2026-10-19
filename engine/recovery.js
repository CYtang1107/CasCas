// Maintenance cost recovery, the way the proposal (section 6.2) counts it:
// receipts − electricity − other variable costs − fixed costs − maintenance = operating surplus.
export function costRecovery({ kWh, revenue, electricityCost, variablePerKwh, fixedMonthly, maintenanceRm = 0, jmbShare, units }) {
  const variableCost = kWh * variablePerKwh;
  const operatingSurplus = revenue - electricityCost - variableCost - fixedMonthly - maintenanceRm;
  const jmbIncome = Math.max(0, operatingSurplus) * jmbShare;
  const perKwh = kWh > 0 ? (revenue - electricityCost) / kWh - variablePerKwh : 0;
  return {
    kWh, revenue, electricityCost, variableCost, fixedMonthly, maintenanceRm, operatingSurplus,
    jmbIncome, partnerIncome: Math.max(0, operatingSurplus) - jmbIncome, perUnit: jmbIncome / units,
    breakEvenKwh: perKwh > 0 ? (fixedMonthly + maintenanceRm) / perKwh : null,
  };
}

// Stretches of at least `minHours` where under `threshold` of capacity is used (use[h] is 0–1).
export function quietWindows(use, threshold = 0.25, minHours = 2) {
  const out = [];
  let start = null;
  for (let h = 0; h <= 24; h++) {
    const quiet = h < 24 && use[h] < threshold;
    if (quiet && start === null) start = h;
    if (!quiet && start !== null) {
      if (h - start >= minHours) {
        const slice = use.slice(start, h);
        out.push({ start, end: h, avgUse: slice.reduce((a, b) => a + b, 0) / slice.length });
      }
      start = null;
    }
  }
  return out.sort((a, b) => (b.end - b.start) - (a.end - a.start));
}
