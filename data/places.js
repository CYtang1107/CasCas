export const START = { lat: 3.2165, lng: 101.7250 }; // "You are here" inside KL East

export const PLACES = [
  { id: 'klem', name: 'KL East Mall', lat: 3.2126, lng: 101.7235 },
  { id: 'melawati', name: 'Melawati Mall', lat: 3.2107, lng: 101.7484 },
  { id: 'wangsa', name: 'Wangsa Maju LRT', lat: 3.2056, lng: 101.7318 },
  { id: 'klcc', name: 'KLCC', lat: 3.1579, lng: 101.7123 },
  { id: 'here', name: 'Just charge near me', lat: START.lat, lng: START.lng },
];

// Demo week: Mon 19 – Sun 25 Oct 2026. The first preset is the default.
export const CLOCK_PRESETS = [
  { id: 'wed11', label: 'Wed 11 AM · sharing open', date: () => new Date(2026, 9, 21, 11, 0) },
  { id: 'tue1830', label: 'Tue 6:30 PM · TNB peak', date: () => new Date(2026, 9, 20, 18, 30) },
  { id: 'sat10', label: 'Sat 10 AM · weekend', date: () => new Date(2026, 9, 24, 10, 0) },
  { id: 'wed2', label: 'Wed 2 AM · overnight', date: () => new Date(2026, 9, 21, 2, 0) },
  { id: 'now', label: 'Right now', date: () => new Date() },
];
