// "Ask CasCas": turn a plain-English request into trip settings. Rule-based, so it runs offline
// and every answer can be explained. Unknown words are ignored; nothing is guessed.
const OPERATORS = ['Gentari', 'ChargEV', 'JomCharge', 'Tesla'];
const PLACE_WORDS = { klem: ['kl east mall', 'kl east', 'klem'], melawati: ['melawati'], wangsa: ['wangsa'], klcc: ['klcc'], here: ['near me', 'nearby', 'around here'] };
const CAR_WORDS = { emas7: ['e.mas 7', 'emas 7', 'e.mas7', 'emas7'], emas5: ['e.mas 5', 'emas 5', 'e.mas5', 'emas5'], atto3: ['atto 3', 'atto3', 'atto'], modely: ['model y', 'tesla model'] };

function stayFor(minutes) {
  if (minutes <= 45) return '30m';
  if (minutes < 180) return '2h';
  if (minutes <= 480) return '4h';
  return 'overnight';
}

export function parseRequest(text, { cars, places }) {
  let t = ` ${String(text || '').toLowerCase()} `;
  const set = {};
  const understood = [];

  // "arrive with 23%" / "keep 30% when I get there": the battery to have left at the end of a trip.
  const arrive = t.match(/(?:arriv\w*|left|keep|reserve)[^%\d]{0,20}(\d{1,2})\s*(?:%|percent)/) || t.match(/(\d{1,2})\s*(?:%|percent)\s*(?:left|when i (?:get|arrive)|on arrival|at the end)/);
  if (arrive) {
    set.arriveMin = Math.min(50, Math.max(5, Number(arrive[1])));
    understood.push(`Arrive with at least ${set.arriveMin}%`);
    t = t.replace(arrive[0], ' ');
  }

  const batt = t.match(/(\d{1,3})\s*(%|percent)/) || t.match(/battery\D{0,12}(\d{1,3})/);
  if (batt) {
    set.battery = Math.min(100, Math.max(5, Number(batt[1])));
    understood.push(`Battery ${set.battery}%`);
  }

  for (const [id, words] of Object.entries(CAR_WORDS)) {
    if (words.some((w) => t.includes(w)) && cars.some((c) => c.id === id)) {
      set.carId = id;
      understood.push(cars.find((c) => c.id === id).name);
      break;
    }
  }

  const hit = (w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t);
  const placeWords = { ...Object.fromEntries(places.filter((p) => p.words).map((p) => [p.id, p.words])), ...PLACE_WORDS };
  for (const [id, words] of Object.entries(placeWords)) {
    if (words.some(hit) && places.some((p) => p.id === id)) {
      set.placeId = id;
      understood.push(id === 'here' ? 'Charge near me' : `Going to ${places.find((p) => p.id === id).name}`);
      break;
    }
  }

  if (/\bovernight\b/.test(t)) set.parkFor = 'overnight';
  else {
    const h = t.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
    const m = t.match(/(\d+)\s*(min|mins|minute|minutes)\b/);
    if (h) set.parkFor = stayFor(Number(h[1]) * 60);
    else if (m) set.parkFor = stayFor(Number(m[1]));
  }
  if (set.parkFor) understood.push(`Parking ${set.parkFor === 'overnight' ? 'overnight' : set.parkFor.replace('m', ' min').replace('h', ' h')}`);

  if (/no budget|any price/.test(t)) { set.maxPrice = null; understood.push('No price limit'); }
  else {
    const b = t.match(/(?:under|below|max|maximum|less than|budget|up to)\s*rm\s*(\d+(?:\.\d+)?)/) || t.match(/rm\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*kwh/);
    if (b) { set.maxPrice = Number(b[1]); understood.push(`Up to RM${set.maxPrice.toFixed(2)}/kWh`); }
  }

  if (/any speed|ac is fine|slow is fine/.test(t)) { set.fastOnly = false; understood.push('Any charging speed'); }
  else if (/\b(fast|dc|quick|rapid)\b/.test(t)) { set.fastOnly = true; understood.push('Fast DC chargers only'); }

  if (/any operator|any provider/.test(t)) { set.operator = null; understood.push('Any operator'); }
  else {
    const op = OPERATORS.find((o) => t.includes(o.toLowerCase()) && !(o === 'Tesla' && set.carId === 'modely' && !/supercharger|prefer tesla/.test(t)));
    if (op) { set.operator = op; understood.push(`Prefers ${op}`); }
  }

  return { set, understood };
}
