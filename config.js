export const APP = {
  name: 'CasSama',
  tagline: 'Charge together. Earn together.',
  township: 'KL East',
};

export const CONST = {
  hardwarePerBay: 6000,   // RM per shared AC bay incl. sub-meter (research: RM4,500–8,000)
  gridKgPerKwh: 0.74,     // Peninsular Malaysia grid emission factor, 2024 provisional
  petrolKgPerKm: 0.16,    // 7 L/100 km × 2.31 kg CO2 per litre
  evKwhPerKm: 0.15,
  roadFactor: 1.3,        // road distance ÷ straight-line distance
  avgKmh: 30,             // urban average speed
  targetPct: 80,
  rangeBuffer: 0.1,
  holdMinutes: 15,
  drawFactor: 0.5,        // share of an occupied hour a car actually draws power
  walkKmh: 4.8,           // walking speed for charger → destination
  overstayRmPer10Min: 1,  // fee per started 10 minutes after the slot ends (goes to the JMB)
  otherCostPerKwh: 0.05,  // payment fees, platform and other variable costs (proposal 6.2)
  fixedPerBayMonthly: 125, // network, insurance and service contract: RM500 a month for 4 bays (proposal 6.2)
};

// Open Charge Map. Get a free key at https://openchargemap.org (My Profile → My Apps). Empty = skip the live fetch.
export const OCM = {
  key: '',
  radiusKm: 15,
  maxResults: 200,
  timeoutMs: 6000,
  cacheMaxAgeDays: 7,
};
