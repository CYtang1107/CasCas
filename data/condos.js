// Fictional condos placed around SDP's KL East township. Figures are simulated.
const share = (enabled, days, start, end, reservedBays) => ({ enabled, days, start, end, reservedBays, visitorPrice: 1.1 });

export const CONDOS = [
  { id: 'lumina', name: 'Residensi Lumina', lat: 3.2150, lng: 101.7205, units: 300, bays: 10, jmbShare: 0.7, monthlyFee: 400, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'weekdays', 9, 17, 2) },
  { id: 'serini', name: 'Serini Park', lat: 3.2185, lng: 101.7262, units: 420, bays: 12, jmbShare: 0.7, monthlyFee: 380, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'all', 10, 18, 3) },
  { id: 'kenanga', name: 'Kenanga Heights', lat: 3.2098, lng: 101.7190, units: 250, bays: 8, jmbShare: 0.7, monthlyFee: 420, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(false, 'weekdays', 9, 17, 2) },
  { id: 'vista', name: 'Vista Melati', lat: 3.2215, lng: 101.7225, units: 360, bays: 10, jmbShare: 0.7, monthlyFee: 390, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'weekdays', 8, 18, 2) },
  { id: 'azalea', name: 'Azalea Suites', lat: 3.2120, lng: 101.7290, units: 200, bays: 6, jmbShare: 0.7, monthlyFee: 450, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(false, 'weekdays', 9, 17, 2) },
  { id: 'teratai', name: 'Teratai Residence', lat: 3.2060, lng: 101.7240, units: 320, bays: 10, jmbShare: 0.7, monthlyFee: 400, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'weekdays', 9, 16, 3) },
];
