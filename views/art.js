// Illustrated site pictures (inline SVG): a mall, a condo, a public car park or a highway rest
// stop, each with a charger. Drawn in code, so there are no photo rights to clear and nothing
// to download. The colours vary by charger id, so neighbouring cards don't look identical.
const SKIES = [['#CFEFE7', '#F3FBF8'], ['#D6E8F7', '#F4F9FD'], ['#F9E6CF', '#FFF8EF'], ['#E3DDF6', '#F7F5FD']];
const WALLS = ['#2F6F64', '#3B5B7A', '#7A5A3B', '#5B4E86', '#356C83'];

function seed(id) {
  let h = 7;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function kindOf(charger) {
  if (charger.siteType === 'condo') return 'condo';
  if (charger.highway) return 'highway';
  if (charger.siteType === 'mall') return 'mall';
  return 'public';
}

const charger = (x, color) => `
  <g transform="translate(${x} 104)"><rect width="16" height="40" rx="3" fill="${color}"/><rect x="3" y="5" width="10" height="9" rx="1.5" fill="#E8FFF9"/>
  <path d="M9 18 5 25h4l-1 6 5-8H9z" fill="#FFFFFF"/><path d="M16 22c8 0 8 14 0 18" fill="none" stroke="#1F2B28" stroke-width="2"/></g>`;
const car = (x, color) => `
  <g transform="translate(${x} 118)"><path d="M4 18 12 6h30l10 12h6v10H0V18z" fill="${color}"/><path d="M15 9h11v8H10zM29 9h10l7 8H29z" fill="#DDEAF2"/>
  <circle cx="13" cy="28" r="6" fill="#1F2B28"/><circle cx="46" cy="28" r="6" fill="#1F2B28"/></g>`;
const tree = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-2" y="10" width="4" height="12" fill="#6B5233"/><circle r="12" fill="#3E9B6E"/><circle cx="7" cy="4" r="8" fill="#4FAF80"/></g>`;
const windows = (x, y, cols, rows, w, h, gx, gy, color) => {
  let out = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out += `<rect x="${x + c * gx}" y="${y + r * gy}" width="${w}" height="${h}" rx="1" fill="${color}"/>`;
  return out;
};

const SCENES = {
  mall: (wall, accent) => `
    <rect x="40" y="46" width="240" height="98" rx="6" fill="${wall}"/><rect x="40" y="62" width="240" height="22" fill="#BFE3F2" opacity="0.9"/>
    <rect x="120" y="36" width="80" height="20" rx="4" fill="#FFFFFF"/><rect x="132" y="43" width="56" height="6" rx="3" fill="${accent}"/>
    ${windows(52, 96, 9, 2, 18, 12, 25, 18, '#E8F4F8')}
    <rect x="0" y="144" width="320" height="36" fill="#9AA7A3"/><path d="M0 160h320" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="14 10"/>
    ${tree(26, 126, 0.9)}${tree(296, 128, 0.8)}${charger(84, accent)}${car(110, '#E9EEF0')}`,
  condo: (wall, accent) => `
    <rect x="58" y="14" width="78" height="130" rx="4" fill="${wall}"/><rect x="176" y="30" width="86" height="114" rx="4" fill="${wall}" opacity="0.88"/>
    ${windows(66, 24, 4, 9, 12, 8, 17, 13, '#F2E7C6')}${windows(184, 40, 5, 7, 11, 8, 16, 14, '#F2E7C6')}
    <rect x="0" y="144" width="320" height="36" fill="#8F9C98"/>${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${30 + i * 48} 146v30" stroke="#FFFFFF" stroke-width="2"/>`).join('')}
    ${tree(30, 124)}${tree(292, 126, 0.9)}${charger(140, accent)}${charger(160, accent)}${car(196, '#F4F6F7')}`,
  public: (wall, accent) => `
    <path d="M30 60h260l-14 18H44z" fill="${wall}"/><rect x="50" y="76" width="6" height="68" fill="#8C9A96"/><rect x="264" y="76" width="6" height="68" fill="#8C9A96"/>
    <rect x="0" y="144" width="320" height="36" fill="#A3AFAB"/><path d="M0 162h320" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="16 12"/>
    ${tree(18, 120, 1.1)}${tree(304, 118, 1)}${charger(96, accent)}${charger(150, accent)}${car(176, '#E3E9EC')}`,
  highway: (wall, accent) => `
    <path d="M0 132 L320 112 L320 180 L0 180z" fill="#97A4A0"/><path d="M0 156 L320 140" stroke="#FFFFFF" stroke-width="3" stroke-dasharray="18 14"/>
    <path d="M60 52h200l-10 16H70z" fill="${accent}"/><rect x="78" y="66" width="5" height="64" fill="#8C9A96"/><rect x="238" y="66" width="5" height="58" fill="#8C9A96"/>
    <rect x="200" y="24" width="70" height="22" rx="3" fill="#2F7D4F"/><rect x="208" y="31" width="40" height="5" rx="2" fill="#FFFFFF"/>
    ${tree(30, 112, 1)}${charger(110, wall)}${charger(130, wall)}${car(160, '#F1F4F5')}`,
};

// `label` is read out to screen readers; the picture itself is decorative.
export function siteArt(charger, label = '') {
  const s = seed(charger.id);
  const [top, bottom] = SKIES[s % SKIES.length];
  const wall = WALLS[(s >>> 3) % WALLS.length];
  const accent = charger.highway ? '#0B7A68' : ['#0B7A68', '#14937D', '#B76E0B'][(s >>> 5) % 3];
  const gid = `sky${s % 100000}`;
  return `<svg class="art" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label.replace(/"/g, '&quot;')}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#${gid})"/><circle cx="270" cy="34" r="16" fill="#FFFFFF" opacity="0.7"/>
    ${SCENES[kindOf(charger)](wall, accent)}</svg>`;
}

// A small coloured mark for the operator: its initial, not its logo.
const BRAND_COLORS = { gentari: '#5B2D90', chargev: '#1E3A8A', jomcharge: '#E5731A', tesla: '#B91C1C', condo: '#0B7A68', highway: '#475569' };
export function brandMark(operator = '') {
  const key = Object.keys(BRAND_COLORS).find((k) => operator.toLowerCase().includes(k)) || (/condo/i.test(operator) ? 'condo' : 'highway');
  const letter = operator.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?';
  return `<span class="brand-mark" style="background:${BRAND_COLORS[key]}" title="${operator.replace(/"/g, '&quot;')}" aria-hidden="true">${letter}</span>`;
}
