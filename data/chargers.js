// Simulated charger network around KL East. Prices reflect 2026 public rates (research doc).
import { CONDOS } from './condos.js';

const condoSites = CONDOS.map((c) => ({
  id: `cs-${c.id}`, name: `${c.name} car park`, operator: 'Condo CPO partner',
  lat: c.lat, lng: c.lng, type: 'AC', kw: 7, connectors: ['Type2'], bays: c.bays,
  siteType: 'condo', condoId: c.id, reliability: 0.97, price: null,
}));

const site = (id, name, operator, lat, lng, type, kw, bays, price, reliability, siteType, extra = {}) => ({
  id, name, operator, lat, lng, type, kw, bays, price, reliability, siteType,
  connectors: type === 'DC' ? ['CCS2'] : ['Type2'], ...extra,
});

export const CHARGERS = [
  ...condoSites,
  site('klem-dc', 'KL East Mall DC', 'Gentari', 3.2126, 101.7235, 'DC', 60, 4, 1.30, 0.96, 'mall', { sdp: true, busyBias: 0.12 }),
  site('klem-ac', 'KL East Mall AC', 'Gentari', 3.2129, 101.7240, 'AC', 11, 6, 1.00, 0.95, 'mall', { sdp: true }),
  site('wwalk-ac', 'Wangsa Walk Mall AC', 'ChargEV', 3.2057, 101.7377, 'AC', 22, 4, 0.90, 0.90, 'mall'),
  site('wwalk-dc', 'Wangsa Walk Mall DC', 'JomCharge', 3.2060, 101.7381, 'DC', 60, 2, 1.30, 0.88, 'mall'),
  site('melawati-dc', 'Melawati Mall DC', 'Gentari', 3.2107, 101.7484, 'DC', 120, 4, 1.30, 0.97, 'mall'),
  site('melawati-ac', 'Melawati Mall AC', 'ChargEV', 3.2104, 101.7480, 'AC', 22, 4, 0.90, 0.90, 'mall'),
  site('setapak-ac', 'Setapak Central AC', 'JomCharge', 3.2040, 101.7180, 'AC', 11, 4, 1.10, 0.85, 'mall'),
  site('setapak-dc', 'Setapak Central DC', 'ChargEV', 3.2044, 101.7184, 'DC', 50, 2, 1.30, 0.62, 'mall'),
  site('genting-dc', 'Jalan Genting Klang DC', 'Gentari', 3.1985, 101.7090, 'DC', 120, 4, 1.30, 0.95, 'public'),
  site('duke-dc', 'DUKE Highway DC', 'Gentari', 3.2205, 101.7105, 'DC', 180, 6, 1.70, 0.94, 'public'),
  site('melati-ac', 'Taman Melati LRT AC', 'ChargEV', 3.2196, 101.7193, 'AC', 7, 2, 0.90, 0.87, 'public'),
  site('gombak-dc', 'Gombak Terminal DC', 'JomCharge', 3.2312, 101.7243, 'DC', 60, 2, 1.40, 0.83, 'public'),
  site('danau-ac', 'Danau Kota AC', 'JomCharge', 3.2081, 101.7175, 'AC', 22, 2, 1.10, 0.90, 'public'),
  site('ampang-ac', 'Ampang Point AC', 'Gentari', 3.1600, 101.7500, 'AC', 11, 4, 1.00, 0.93, 'mall'),
  site('klcc-tesla', 'KLCC Supercharger', 'Tesla', 3.1586, 101.7140, 'DC', 250, 8, 1.80, 0.99, 'mall'),
];
