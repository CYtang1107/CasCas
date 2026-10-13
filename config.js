export const APP = {
  name: 'CasCas',
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
  nationalTarget2030: 30000,
  sdpTownships: 28,
};
