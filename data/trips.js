// Longer trips out of KL East, and DC fast chargers along the highways for planning them.
// Charger sites are DEMO data at approximate highway rest-area locations, not a live list.
export const TRIP_PLACES = [
  { id: 'seremban', name: 'Seremban', lat: 2.7258, lng: 101.9424, words: ['seremban'], trip: true },
  { id: 'pd', name: 'Port Dickson', lat: 2.5226, lng: 101.7966, words: ['port dickson', 'pd'], trip: true },
  { id: 'melaka', name: 'Melaka', lat: 2.1896, lng: 102.2501, words: ['melaka', 'malacca'], trip: true },
  { id: 'ipoh', name: 'Ipoh', lat: 4.5975, lng: 101.0901, words: ['ipoh'], trip: true },
  { id: 'jb', name: 'Johor Bahru', lat: 1.4927, lng: 103.7414, words: ['johor bahru', 'johor', 'jb'], trip: true },
  { id: 'penang', name: 'Penang', lat: 5.4141, lng: 100.3288, words: ['penang', 'pulau pinang'], trip: true },
  { id: 'kuantan', name: 'Kuantan', lat: 3.8077, lng: 103.3260, words: ['kuantan'], trip: true },
];

const hw = (id, name, lat, lng, kw, price = 1.3) => ({
  id: `hw-${id}`, name: `${name} DC (demo)`, operator: 'Highway CPO (demo)', lat, lng, type: 'DC', kw, bays: 4,
  price, reliability: 0.93, siteType: 'public', connectors: ['CCS2'], highway: true,
});

export const HIGHWAY_CHARGERS = [
  hw('nilai', 'Nilai', 2.8170, 101.7980, 60),
  hw('seremban', 'Seremban R&R', 2.6930, 101.9050, 120),
  hw('rembau', 'Rembau', 2.5900, 102.0900, 60),
  hw('ayerkeroh', 'Ayer Keroh R&R', 2.2700, 102.2850, 120),
  hw('pagoh', 'Pagoh R&R', 2.1500, 102.7500, 120),
  hw('yongpeng', 'Yong Peng', 2.0100, 103.0600, 60),
  hw('machap', 'Machap R&R', 1.8800, 103.2500, 120),
  hw('rawang', 'Rawang R&R', 3.3200, 101.5500, 120),
  hw('tapah', 'Tapah R&R', 4.1950, 101.2650, 120),
  hw('gopeng', 'Gopeng', 4.4700, 101.1600, 60),
  hw('kualakangsar', 'Kuala Kangsar', 4.7700, 100.9300, 60),
  hw('semanggol', 'Gunung Semanggol R&R', 5.0800, 100.6200, 120),
  // East Coast (Karak and LPT)
  hw('gentingsempah', 'Genting Sempah R&R', 3.3600, 101.7900, 120),
  hw('bentong', 'Bentong', 3.5200, 101.9100, 60),
  hw('temerloh', 'Temerloh R&R', 3.4500, 102.4200, 120),
  hw('maran', 'Maran', 3.5900, 102.7700, 60),
  hw('gambang', 'Gambang R&R', 3.7100, 103.1000, 120),
];
