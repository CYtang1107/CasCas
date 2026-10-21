import { CONST } from '../config.js';
import { CARS } from '../data/cars.js';
import { PLACES, START } from '../data/places.js';
import { rankChargers, MODES, formatDuration } from '../engine/score.js';
import { priceAt } from '../engine/pricing.js';
import { isOpenToVisitors } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';
import { buildSession } from '../engine/insights.js';
import { describeCharger, priceComparison, availability, monthSummary } from '../engine/detail.js';
import { distanceKm } from '../engine/geo.js';
import { emptyFilters, countFilters, matchesFilters, FAST_KW } from '../engine/filters.js';
import { priceNote } from '../engine/pricing.js';
import { siteArt, brandMark } from './art.js';
import { co2AvoidedKg as co2Kg, simulateCondoMonth } from '../engine/economics.js';
import { residentStatement } from '../engine/governance.js';
import { describeSharing, proposalFor, proposalHtml, bindProposal } from './governance.js';
import { searchSites, categoryOf, remember } from '../engine/search.js';
import { searchPlaces, localMatches, isTrip } from '../engine/geocode.js';
import { CONDOS } from '../data/condos.js';
import { osrmUrl, parseOsrm, stepText, typicalTraffic, refineTrip } from '../engine/roads.js';
import { parseTtRoute, parseIncidents, incidentsNear } from '../engine/tomtom.js';
import { bestWindow } from '../engine/schedule.js';
import { parseRequest } from '../engine/assistant.js';
import { planTrip } from '../engine/trip.js';
import { TRIP_PLACES, HIGHWAY_CHARGERS } from '../data/trips.js';
import { normalisePlate, isValidPlate, formatPlate, canAutoApprove, createPass } from '../engine/access.js';
import { addSession, anonNumber } from '../state.js';
import { esc, rm, rm0, fmtTime, fmtClock } from './format.js';
import { aiAvailable, aiOn, chat, chatHtml, sendChat, chatAction } from './chat.js';
import { notify, notifyState, askPermission } from './notify.js';

const PARK_OPTIONS = [['30m', '30 min'], ['2h', '2 h'], ['4h', '4 h'], ['overnight', 'Overnight']];
const BUDGETS = [['', 'Any price'], ['0.9', 'Up to RM0.90/kWh'], ['1', 'Up to RM1.00/kWh'], ['1.2', 'Up to RM1.20/kWh'], ['1.5', 'Up to RM1.50/kWh']];
const OPERATORS = ['Gentari', 'ChargEV', 'JomCharge', 'Tesla'];
const noPrefs = () => ({ maxPrice: null, fastOnly: false, operator: null });
// Quick chips above the map; each one toggles part of the full filter set.
const QUICK = [
  ['available', 'Available', (f) => f.available, (f) => { f.available = !f.available; }],
  ['fast', 'Fast DC', (f) => f.types.includes('fast'), (f) => { f.types = f.types.includes('fast') ? f.types.filter((x) => x !== 'fast') : [...f.types, 'fast']; }],
  ['condo', 'Condo shared', (f) => f.condoShared, (f) => { f.condoShared = !f.condoShared; }],
  ['cheap', '≤ RM1.00', (f) => f.maxPrice === 1, (f) => { f.maxPrice = f.maxPrice === 1 ? null : 1; }],
];
const PRICE_CAPS = [[null, 'Any price'], [0.9, '≤ RM0.90'], [1, '≤ RM1.00'], [1.2, '≤ RM1.20']];
let draft = null; // the Filters sheet's working copy while it is open
let search = { open: false, q: '', saved: false };
const ALL_PLACES = [...PLACES, ...TRIP_PLACES];
const svg = (d, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const IC = {
  bolt: svg('M13 2 4 14h6l-1 8 9-12h-6z', 'ic fill'),
  pin: svg('M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  nav: svg('M3 11 21 3l-8 18-2-8-8-2z'),
  clock: svg('M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'),
  home: svg('M4 11 12 4l8 7v9h-5v-6H9v6H4z'),
  search: svg('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm5-2 4 4'),
  route: svg('M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7'),
  map: svg('M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14'),
  filter: svg('M4 6h16M7 12h10M10 18h4'),
  close: svg('M6 6l12 12M18 6 6 18'),
  check: svg('M5 12.5 10 17l9-10'),
  alert: svg('M12 3 2 21h20zM12 10v5M12 18h.01'),
  locate: svg('M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 2v3M12 19v3M2 12h3M19 12h3M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  back: svg('M15 5 8 12l7 7'),
  car: svg('M5 16h14M6 16l1.5-5h9L18 16v3H6zM8 19v1M16 19v1M8.5 13.5h.01M15.5 13.5h.01'),
  tag: svg('M3 12V4h8l10 10-8 8z M7.5 7.5h.01'),
  sun: svg('M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'),
  help: svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01'),
  shield: svg('M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z'),
  doc: svg('M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6'),
  building: svg('M4 21V7l8-4 8 4v14M9 21v-5h6v5M8 10h2M14 10h2M8 13h2M14 13h2'),
  bookmark: svg('M7 4h10v16l-5-4-5 4z'),
};
const availChip = (ch, occ) => { const a = availability(ch, occ); return `<span class="chip avail ${a.free ? 'on' : 'warn'}">${a.live ? '<span class="live-dot" title="Live from TomTom"></span>' : ''}${ch.type} ${a.free}/${a.total} free</span>`; };
const navUrl = (ch) => `https://www.google.com/maps/dir/?api=1&destination=${ch.lat},${ch.lng}`;
// ---- Real roads (OSRM) ----
// Routes are fetched once per set of points and kept; while one loads, the plan shows the estimate.
const roads = new Map(); // key -> { status: 'loading' | 'ok' | 'failed', routes }
const roadKey = (pts, alt) => `${alt ? 'a' : 'r'}:${pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';')}`;
function road(points, { alternatives = false } = {}) {
  // Only a rounded point (about 100 m) goes to the route service, never the exact GPS fix.
  const pts = points.map((p) => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 }));
  const viaTT = trafficAvailable === true;
  const key = `${viaTT ? 'tt' : 'osrm'}:${roadKey(pts, alternatives)}`;
  const hit = roads.get(key);
  if (hit) return hit;
  const entry = { status: 'loading', routes: [] };
  roads.set(key, entry);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const url = viaTT ? `api/tt/route?pts=${pts.map((p) => `${p.lat},${p.lng}`).join(';')}&alt=${alternatives ? 1 : 0}` : osrmUrl(pts, { alternatives, steps: true });
  fetch(url, { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      entry.routes = viaTT ? parseTtRoute(j)
        : parseOsrm(j).map((r) => ({ ...r, legs: r.legs.map((l) => ({ ...l, steps: l.steps.map((x) => ({ text: stepText(x), km: x.distance / 1000 })) })) }));
      entry.status = entry.routes.length ? 'ok' : 'failed';
      if (viaTT && entry.routes[0]) loadIncidentsFor(entry);
    })
    .catch(() => { entry.status = 'failed'; })
    .finally(() => {
      clearTimeout(timer);
      if (current && (tab === 'plan' || tab === 'map' || tab === 'home')) update(current.root, current.ctx);
    });
  return entry;
}
// Traffic incidents along a route, from the server (TomTom), fetched once per route.
const incidentCache = new Map();
async function fetchIncidents(bbox) {
  const key = bbox.map((v) => v.toFixed(2)).join(',');
  if (!incidentCache.has(key)) {
    incidentCache.set(key, fetch(`api/tt/incidents?bbox=${key}`).then((r) => (r.ok ? r.json() : null)).then(parseIncidents).catch(() => []));
  }
  return incidentCache.get(key);
}
function loadIncidentsFor(entry) {
  const c = entry.routes[0].coords;
  const lats = c.map((x) => x[0]);
  const lngs = c.map((x) => x[1]);
  const bbox = [Math.min(...lngs) - 0.01, Math.min(...lats) - 0.01, Math.max(...lngs) + 0.01, Math.max(...lats) + 0.01];
  fetchIncidents(bbox).then((list) => {
    entry.incidents = incidentsNear(list, c, 250);
    if (current && (tab === 'plan' || tab === 'map')) update(current.root, current.ctx);
  });
}
let incidentsOn = false;
let incidentLayer = null;

let trafficOn = false;
let trafficLayer = null;
let trafficAvailable = null; // null = not asked yet
async function checkTraffic(ctx) {
  if (trafficAvailable !== null || !ctx.api) { if (!ctx.api) trafficAvailable = false; return; }
  try { trafficAvailable = !!(await (await fetch('api/config')).json()).traffic; } catch { trafficAvailable = false; }
  if (current && tab === 'map') { const bar = current.root.querySelector('.map-filters'); if (bar) { bar.innerHTML = filterBarHtml(); bindFilterBar(current.root, current.ctx); } }
  if (trafficAvailable && current) update(current.root, current.ctx); // re-plan with live traffic
}

// Start point: your GPS position or a place you typed, else your condo, else KL East.
function originPoint() {
  if (ui.from) return ui.from;
  const home = CONDOS.find((c) => c.id === ui.homeId);
  return home ? { name: home.name, lat: home.lat, lng: home.lng, kind: 'condo' } : { ...START, name: 'KL East', kind: 'demo' };
}
// A typed destination ('custom') is a long trip when it is more than about 40 km away.
const placeOf = (id) => (id === 'custom' && ui.customTo
  ? { ...ui.customTo, trip: isTrip(originPoint(), ui.customTo) }
  : ALL_PLACES.find((p) => p.id === id) || PLACES[0]);
const fresh = () => ({ carId: 'emas7', battery: 35, placeId: 'klem', homeId: '', parkFor: '30m', stage: 'pick', pick: null, flash: '', pending: null, plate: '', selected: null, prefs: noPrefs(), ask: '', askNote: '', arriveMin: 20, filters: emptyFilters(), from: null, customTo: null, locMsg: '' });
let ui = fresh();
let map = null;
let layer = null;
let timer = null;
let markers = new Map();
let last = null; // latest { ranking, car }, for the detail panel
let tab = 'home';
let current = null; // { root, ctx } of the tab on screen, for the charging timer
let profileApplied = false;

export function resetDriver() {
  stopTimer();
  ui = fresh();
  profileApplied = false;
}

// The driver side is four tabs, like the operator apps: Home, Map, Plan and Activity.
// They share one state (ui), so a search on Home shows up in Plan, and a booking runs in Activity.
export function renderDriver(root, ctx, which = 'home') {
  tab = which;
  if (which !== 'map') search.open = false;
  current = { root, ctx };
  if (map) { map.remove(); map = null; }
  const { condos } = ctx.world;
  const askForm = (big) => `<form id="d-ask" class="ask ${big ? 'big' : ''}" role="search" novalidate>
        <label class="search"><span class="sr-only">Ask CasSama</span>${IC.search}
          <input id="d-ask-text" type="search" maxlength="200" autocomplete="off" enterkeyhint="go" placeholder="${big && aiOn() ? 'Ask CasSama anything: “cheapest charge at 20%?”' : 'Ask CasSama: “Atto 3 at 71%, going to Melaka”'}" value="${esc(ui.ask)}"></label>
        <button class="btn primary" type="submit">Go</button>
      </form>
      ${ui.askNote ? `<p class="ask-note" role="status">${esc(ui.askNote)}</p>` : ''}`;
  const mapRow = (cls) => `<div class="map-row ${cls}" id="d-map-row">
      <section class="map-wrap">
        <div id="d-map" class="map" aria-label="Map of chargers around KL East. Select a charger for details."></div>
        <button type="button" class="round map-focus" data-map-focus aria-label="Recenter map on your location" title="Recenter map on your location">${IC.locate}</button>
        <p id="d-map-fallback" class="notice" hidden>The map could not load. <a href="#plan">Browse the charger list</a> to find and book a bay.</p>
      </section>
      <aside id="d-detail" class="panel detail" aria-label="Charger details" aria-live="polite" hidden></aside>
    </div>`;
  const trip = summaryLine();

  if (!profileApplied) applyProfile(ctx.state.profile);
  if (which === 'account') {
    root.innerHTML = `<div class="driver tab-account" id="d-account">${accountHtml(ctx)}</div>`;
    bindAccount(root, ctx);
    return;
  }
  if (which === 'home') {
    root.innerHTML = `
    <div class="driver tab-home">
      <section class="hello">
        <h1>Find your<br>next charge.</h1>
        <p class="context-line">${esc(greeting(ctx.clock))} · ${esc(fmtTime(ctx.clock))}</p>
        <p class="hello-copy">Find your next charge, close to home or along the way.</p>
        ${askForm(true)}
        <div id="d-chat">${chatHtml()}</div>
      </section>
      <nav class="quick" aria-label="Shortcuts">
        <a href="#plan" data-quick="trip">${IC.route}<span>Plan a trip</span></a>
        <a href="#plan" data-quick="fast">${IC.bolt}<span>Fast DC</span></a>
        <a href="#map" data-quick="map">${IC.map}<span>Map</span></a>
        <a href="#activity" data-quick="activity">${IC.clock}<span>Bookings</span></a>
      </nav>
      <div id="d-home-body" aria-live="polite"></div>
    </div>`;
  } else if (which === 'map') {
    root.innerHTML = `<div class="driver tab-map">
      <div class="map-title"><h1>Explore chargers</h1><p class="muted">Select a pin to see the details and book.</p></div>
      <button type="button" class="msearch" data-sopen>${IC.search}<span>Search chargers or places</span></button>
      <div class="map-filters" role="group" aria-label="Filter chargers">${filterBarHtml()}</div>
      <section class="search-screen" id="d-search" aria-label="Search chargers" hidden></section>
      <div class="sheet-backdrop" id="d-fsheet" hidden></div>
      ${mapRow('full')}
      <p class="map-hint">${esc(trip)} · <a href="#plan">Change</a></p></div>`;
  } else if (which === 'activity') {
    root.innerHTML = '<div class="driver tab-activity"><h1 class="sr-only">Activity</h1><section class="panel" id="d-activity" aria-label="Booking and charging activity"></section></div>';
  } else {
    root.innerHTML = `
  <div class="driver tab-plan">
    <header class="plan-heading"><h1>Your next charge.</h1><p class="muted">A nearby bay or a stop along the way. Your journey, considered.</p></header>
    <details class="trip-preferences" data-preferences><summary><span>Trip preferences</span><span class="preference-summary">${esc(trip)}</span>${IC.filter}</summary>
    <section class="plan-form" aria-label="Trip">
      <h2 class="sr-only">Plan</h2>
      <div class="segmented" role="group" aria-label="Plan type">
        <button type="button" data-seg="nearby" aria-pressed="${!placeOf(ui.placeId).trip}">Charge nearby</button>
        <button type="button" data-seg="trip" aria-pressed="${!!placeOf(ui.placeId).trip}">Long trip</button>
      </div>
      ${askForm(false)}
      <div class="fcard route">
        <div class="rrow">${IC.home}<label class="rtxt"><span class="lbl">From</span>
          <input id="d-from" class="bare-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="d-suggest" autocomplete="off" enterkeyhint="next" value="${esc(originPoint().name)}" placeholder="Current location or a place"></label>
          <button type="button" class="round locbtn" data-locate aria-label="Use my current location">${IC.locate}</button></div>
        <div class="rrow">${IC.pin}<label class="rtxt"><span class="lbl">To</span>
          <input id="d-to" class="bare-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="d-suggest" autocomplete="off" enterkeyhint="go" value="${esc(placeOf(ui.placeId).name)}" placeholder="Where to?"></label></div>
        <ul class="suggest" id="d-suggest" role="listbox" aria-label="Suggestions" hidden></ul>
      </div>
      ${ui.locMsg ? `<p class="muted loc-msg" role="status">${esc(ui.locMsg)}</p>` : ''}
      <div class="fcard vehicle">
        <div class="vrow"><label class="vcar"><span class="sr-only">Car</span><select id="d-car" class="bare big">${CARS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
          <span class="vspec" id="d-vspec"></span></div>
        <label class="slider"><span class="srow2"><span>Battery now</span><output id="d-batt-out"></output></span>
          <input id="d-batt" type="range" min="5" max="100" step="1"></label>
        <label class="slider" id="d-arrive-wrap" ${placeOf(ui.placeId).trip ? '' : 'hidden'}><span class="srow2"><span>Arrive with at least</span><output id="d-arrive-out"></output></span>
          <input id="d-arrive" type="range" min="5" max="50" step="1"></label>
      </div>
      <fieldset class="fcard park" id="d-park-wrap" ${placeOf(ui.placeId).trip ? 'hidden' : ''}><legend>How long will you park?</legend>
        <div class="pills">${PARK_OPTIONS.map(([v, l]) => `<label><input type="radio" name="d-park" value="${v}"><span>${l}</span></label>`).join('')}</div>
      </fieldset>
      <details class="fcard prefs" ${hasPrefs() ? 'open' : ''}><summary>My preferences${hasPrefs() ? ' (on)' : ''}</summary>
        <div class="fields">
          <label class="field">Budget <select id="d-budget">${BUDGETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="field">Charging speed <select id="d-speed"><option value="any">Any</option><option value="fast">Fast DC only</option></select></label>
          <label class="field">Preferred operator <select id="d-op"><option value="">Any</option>${OPERATORS.map((o) => `<option>${o}</option>`).join('')}</select></label>
        </div>
      </details>
    </section></details>
    <div class="charging-workspace">
    ${mapRow('compact')}
    <aside class="recommendation-sheet" data-sheet="medium" aria-label="Charging recommendations">
      <div class="sheet-toolbar"><span>Charge options</span><label class="sheet-sizes"><span class="sr-only">Recommendation view</span>
        <select data-sheet-size aria-label="Recommendation view" aria-controls="d-results">
          <option value="compact">Compact</option>
          <option value="medium" selected>Browse</option>
          <option value="expanded">Expanded</option>
        </select>
      </label></div>
      <section class="results" id="d-results" aria-live="polite"></section>
    </aside></div>
  </div>`;
  }

  const $ = (sel) => root.querySelector(sel);
  bindFilterBar(root, ctx);
  root.querySelector('[data-sopen]')?.addEventListener('click', () => openSearch(root, ctx));
  if (which === 'map' && search.open) openSearch(root, ctx);
  $('#d-ask')?.addEventListener('submit', (e) => { e.preventDefault(); ask(root, ctx, $('#d-ask-text').value); });
  bindChat(root, ctx);
  root.querySelectorAll('[data-quick]').forEach((a) => a.addEventListener('click', () => {
    if (a.dataset.quick === 'fast') ui.prefs.fastOnly = true;
    if (a.dataset.quick === 'trip' && !placeOf(ui.placeId).trip) ui.placeId = 'melaka';
  }));
  root.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => {
    const trip = b.dataset.seg === 'trip';
    if (trip !== !!placeOf(ui.placeId).trip) { ui.placeId = trip ? 'melaka' : 'klem'; ui.customTo = null; }
    renderDriver(root, ctx, 'plan');
  }));
  if (which === 'plan') {
    $('#d-car').value = ui.carId;
    $('#d-batt').value = ui.battery;
    $(`input[name="d-park"][value="${ui.parkFor}"]`).checked = true;
    $('#d-arrive').value = ui.arriveMin;
    $('#d-arrive').addEventListener('input', (e) => { ui.arriveMin = Number(e.target.value); update(root, ctx); });
    $('#d-budget').value = ui.prefs.maxPrice == null ? '' : String(ui.prefs.maxPrice);
    $('#d-speed').value = ui.prefs.fastOnly ? 'fast' : 'any';
    $('#d-op').value = ui.prefs.operator || '';
    $('#d-budget').addEventListener('change', (e) => { ui.prefs.maxPrice = e.target.value ? Number(e.target.value) : null; update(root, ctx); });
    $('#d-speed').addEventListener('change', (e) => { ui.prefs.fastOnly = e.target.value === 'fast'; update(root, ctx); });
    $('#d-op').addEventListener('change', (e) => { ui.prefs.operator = e.target.value || null; update(root, ctx); });
    $('#d-car').addEventListener('change', (e) => { ui.carId = e.target.value; update(root, ctx); });
    $('#d-batt').addEventListener('input', (e) => { ui.battery = Number(e.target.value); update(root, ctx); });
    bindRoute(root, ctx);
    root.querySelectorAll('input[name="d-park"]').forEach((r) => r.addEventListener('change', (e) => { ui.parkFor = e.target.value; update(root, ctx); }));
  }

  if ($('#d-map')) initMap($('#d-map'), $('#d-map-fallback'));
  $('[data-map-focus]')?.addEventListener('click', () => {
    if (!map) return;
    const origin = originPoint();
    map.invalidateSize();
    map.setView([origin.lat, origin.lng], 15);
    $('#d-map').focus({ preventScroll: true });
  });
  if (map && trafficOn) setTraffic(true);
  if (map && incidentsOn) refreshIncidentLayer();
  map?.on('moveend', () => { clearTimeout(incTimer); incTimer = setTimeout(refreshIncidentLayer, 600); });
  checkTraffic(ctx);
  update(root, ctx);
  if (which === 'map' && ui.selected) focusSelected();
  if (ui.stage === 'charging' && !timer) startTimer();
  if (which === 'plan') autoLocate(root, ctx);
}

const greeting = (d) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening');

// "e.MAS 7 · 35% · to KL East Mall · 30 min": what the picks are for.
function summaryLine() {
  const car = CARS.find((c) => c.id === ui.carId);
  const place = placeOf(ui.placeId);
  const stay = place.trip ? `arrive with ${ui.arriveMin}%` : PARK_OPTIONS.find(([v]) => v === ui.parkFor)[1].toLowerCase();
  return `${car.name} · ${ui.battery}% · ${originPoint().name} → ${place.name} · ${stay}`;
}

// Home: the one best charger for the current settings (or the trip), condo bays nearby, your month.
function homeHtml(r, ctx, trip, place) {
  const flash = ui.flash ? `<p class="flash">${esc(ui.flash)}</p>` : '';
  const active = ui.stage !== 'pick' && ui.pick
    ? `<a class="banner" href="#activity">${IC.bolt}<span><b>${ui.stage === 'charging' ? 'Charging now' : 'Bay held'}</b> at ${esc(ui.pick.name)}</span><span aria-hidden="true">›</span></a>` : '';
  const head = `<div class="sec-head"><h3>${trip ? `Your trip to ${esc(place.name)}` : 'Best for you now'}</h3><a href="#plan">Change</a></div>
    <p class="muted">${esc(summaryLine())}</p>`;
  let main;
  if (trip) {
    main = trip.ok
      ? `<a class="pick hero trip-hero" href="#plan"><p class="eyebrow-tag">Trip plan</p><h3>${formatDuration(trip.totals.totalMin)} · ${Math.round(trip.totals.km)} km</h3>
          <p>${trip.stops.length ? `${trip.stops.length} charge stop${trip.stops.length === 1 ? '' : 's'}, ${formatDuration(trip.totals.chargeMin)} charging` : 'No charge stop needed'} · arrive with ${Math.round(trip.arrivePct)}%</p>
          <span class="btn primary">Open the plan</span></a>`
      : `<p class="empty">${esc(trip.error)}</p>`;
  } else if (r.kWh < 1) {
    main = `<p class="empty">Your battery is at ${ui.battery}%. No charge needed for this trip.</p>`;
  } else if (!r.results.length) {
    main = `<p class="empty">No charger fits right now. <a href="#plan">Change your trip or preferences</a>.</p>`;
  } else {
    main = heroCard(r.results[0]);
  }
  const myCondo = ctx.world.condos.find((c) => c.id === ui.homeId);
  const v = myCondo ? proposalFor(ctx, myCondo) : null;
  if (v?.proposal?.status === 'open' && !v.myVote) notify(ctx.state.profile, `vote-${myCondo.id}-${v.proposal.id || v.proposal.openedAt || ''}`, `CasSama: vote at ${myCondo.name}`, `${describeSharing(v.proposal.settings).split('.')[0]}. Vote in the app within 7 days.`);
  const voteBanner = v?.proposal?.status === 'open' && !v.myVote
    ? `<a class="banner vote" href="#account">${IC.help}<span><b>Vote on bay sharing</b> at ${esc(myCondo.name)}: ${esc(describeSharing(v.proposal.settings).split('.')[0])}</span><span aria-hidden="true">›</span></a>` : '';
  return active + voteBanner + flash + `<section class="home-pick">${head}${main}</section>`
    + placeRow(ctx, 'While you shop', (c) => c.siteType === 'mall')
    + condosHtml(ctx)
    + placeRow(ctx, 'While on the road', (c) => c.siteType === 'public' && !c.highway)
    + monthHtml(ctx);
}

// A sideways row of picture cards, one per place (a mall's AC and DC chargers are one place),
// like the operator apps' "While you shop".
function placeRow(ctx, title, keep) {
  const origin = originPoint();
  const places = new Map();
  for (const ch of ctx.world.chargers.filter(keep)) {
    const key = ch.name.replace(/ (DC|AC)$/, '');
    if (!places.has(key)) places.set(key, { name: key, list: [], km: distanceKm(origin, ch) });
    places.get(key).list.push(ch);
  }
  const cards = [...places.values()].sort((a, b) => a.km - b.km).slice(0, 8).map((pl) => {
    const first = pl.list.find((c) => c.type === 'DC') || pl.list[0];
    const counts = ['DC', 'AC'].map((t) => {
      const n = pl.list.filter((c) => c.type === t).reduce((sum, c) => sum + c.bays, 0);
      return n ? `<span class="chip avail">${t} ${n}</span>` : '';
    }).join('');
    return `<button class="pcard" type="button" data-detail="${esc(first.id)}">${siteArt(first, pl.name)}
      <b>${esc(pl.name)}</b><span class="muted">${pl.km.toFixed(1)} km · ${esc(first.operator)}</span>
      <span class="facts">${brandMark(first.operator)}${counts}</span></button>`;
  }).join('');
  return cards ? `<section class="prow" aria-label="${esc(title)}"><div class="sec-head"><h3>${esc(title)}</h3><a href="#map">Map</a></div><div class="pcards">${cards}</div></section>` : '';
}

// ---------- Account (like the operator apps' Account tab) ----------
// Settings live on this device only: there are no accounts in the prototype.
function applyProfile(p) {
  profileApplied = true;
  if (!p) return;
  if (p.carId && CARS.some((c) => c.id === p.carId)) ui.carId = p.carId;
  if (p.homeId) ui.homeId = p.homeId;
  if (p.prefs) ui.prefs = { ...noPrefs(), ...p.prefs };
}

const initials = (name) => (name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || 'D').toUpperCase();

function accountHtml(ctx) {
  const p = ctx.state.profile;
  const name = p.name || 'Guest driver';
  const sessions = ctx.state.sessions;
  const kWh = sessions.reduce((t, x) => t + x.kWh, 0);
  const car = CARS.find((c) => c.id === (p.carId || ui.carId));
  const condo = ctx.world.condos.find((c) => c.id === p.homeId);
  const saved = ctx.world.chargers.filter((c) => ctx.state.favourites.includes(c.id));
  const row = (ic, label, value, attrs) => `<button type="button" class="arow" ${attrs}>${IC[ic]}<span>${label}</span>${value ? `<span class="aval">${value}</span>` : ''}<span class="chev" aria-hidden="true">›</span></button>`;
  const source = document.getElementById('data-source')?.textContent || '';
  const mode = document.getElementById('data-mode')?.textContent || '';
  return `
    <section class="profile">
      <div class="avatar" aria-hidden="true">${esc(initials(name))}</div>
      <h1>${esc(name)}</h1>
      <button type="button" class="pill-btn" data-a="name">Edit name</button>
      <div class="pstats"><div><span>Output (kWh)</span><b>${kWh.toFixed(1)}</b></div><div><span>Sessions</span><b>${sessions.length}</b></div><div><span>CO₂ avoided (kg)</span><b>${Math.round(co2Kg(kWh))}</b></div></div>
    </section>
    ${condo ? condoHtml(ctx, condo) : ''}
    <h3 class="agroup">My profile</h3>
    <div class="alist">
      <label class="arow">${IC.car}<span>My car</span><select id="a-car" class="bare">${CARS.map((c) => `<option value="${c.id}" ${car?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="arow">${IC.home}<span>My condo</span><select id="a-home" class="bare"><option value="">None</option>${ctx.world.condos.map((c) => `<option value="${c.id}" ${condo?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    </div>
    <h3 class="agroup">Records</h3>
    <div class="alist">
      ${row('clock', 'Charging history', `${sessions.length}`, 'data-a="history"')}
      ${row('bookmark', 'Saved chargers', `${saved.length}`, 'data-a="saved"')}
    </div>
    <div class="adrop" id="a-saved" hidden>${saved.length ? `<ul class="hist">${saved.map((c) => `<li><div><b>${esc(c.name)}</b><span class="muted">${esc(c.operator)} · ${c.type} ${c.kw} kW</span></div><button type="button" class="btn small" data-detail="${esc(c.id)}">On map</button></li>`).join('')}</ul>` : '<p class="muted">Tap the bookmark on a search result to save a charger.</p>'}</div>
    <h3 class="agroup">Charging preferences</h3>
    <div class="alist">
      <label class="arow">${IC.tag}<span>Budget</span><select id="a-budget" class="bare">${BUDGETS.map(([v, l]) => `<option value="${v}" ${String(ui.prefs.maxPrice ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="arow">${IC.bolt}<span>Fast DC only</span><input type="checkbox" class="switch" id="a-fast" ${ui.prefs.fastOnly ? 'checked' : ''}></label>
      <label class="arow">${IC.map}<span>Preferred operator</span><select id="a-op" class="bare"><option value="">Any</option>${OPERATORS.map((o) => `<option ${ui.prefs.operator === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
    </div>
    <h3 class="agroup">General</h3>
    <div class="alist">
      <label class="arow">${IC.clock}<span>Notifications <small class="muted">${esc(notifyNote(p))}</small></span><input type="checkbox" class="switch" id="a-notify" ${p.notify && notifyState() === 'granted' ? 'checked' : ''} ${notifyState() === 'unsupported' ? 'disabled' : ''}></label>
      <label class="arow">${IC.sun}<span>Deeper night theme</span><input type="checkbox" class="switch" id="a-theme" ${p.theme === 'dark' ? 'checked' : ''}></label>
      ${row('help', 'Help and FAQ', '', 'data-a="faq"')}
      ${row('shield', 'Privacy', '', 'data-a="privacy"')}
      ${row('doc', 'Terms of the demo', '', 'data-a="terms"')}
      <a class="arow" href="jmb.html">${IC.building}<span>Manage a condo? JMB portal</span><span class="chev" aria-hidden="true">›</span></a>
    </div>
    <div class="adrop" id="a-faq" hidden>
      <p><b>How does CasSama pick a charger?</b> By your battery: low battery puts the quickest working charger first, a full one puts cheaper and quieter ones first. Your budget, speed and operator preferences come on top.</p>
      <p><b>Can I charge at a condo I don't live in?</b> Yes, during the hours its JMB shares bays. Book, enter your plate, and the guardhouse lets you in.</p>
      <p><b>What if I stay too long?</b> After your slot it is ${rm(CONST.overstayRmPer10Min)} per 10 minutes, paid to the condo, so the next driver can charge.</p>
    </div>
    <div class="adrop" id="a-privacy" hidden>
      <p>Bookings are logged by an anonymous ID such as "Visitor #48". Your number plate is shown only to that condo's management, behind its PIN, and deleted 30 days after the visit. Your name, car and saved chargers stay on this device. To draw road routes, the start and end points go to OpenStreetMap routing (OSRM), rounded to about 100 m; typed place names go to Photon place search.</p>
    </div>
    <div class="adrop" id="a-terms" hidden>
      <p>This is a prototype for the Sime Darby Property University Hackathon 2026. Condo bays, occupancy, history and highway chargers are simulated; condo names are fictional. Public chargers come from Open Charge Map when the server has a key. Nothing here takes payment.</p>
    </div>
    <section class="about"><p class="muted">${esc(source)}${mode ? ` · ${esc(mode)}` : ''}</p>
      <button class="btn danger" type="button" data-reset>Reset demo</button>
      <p class="version">CasSama prototype · version 0.9</p></section>`;
}

// "My condo earned": this month's charging income for the resident's condo, and their vote.
function condoHtml(ctx, condo) {
  const charger = ctx.world.chargers.find((ch) => ch.condoId === condo.id);
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const st = residentStatement(simulateCondoMonth(condo, charger, start), condo);
  const c = st.costs;
  const row = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td>${v}</td></tr>`;
  const vote = proposalFor(ctx, condo);
  return `
    <h3 class="agroup">My condo · ${esc(condo.name)}</h3>
    <section class="statement">
      <p class="eyebrow">${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))} statement</p>
      <p class="big-save"><b>${rm(st.perUnit)}</b> off your monthly fee</p>
      <p>Fee ${rm(condo.monthlyFee)} instead of ${rm(st.feeWithout)}, so ${rm(st.yearPerUnit)} a year.</p>
      <div class="srows"><div><span>Your JMB earned from charging</span><b>${rm0(st.jmbIncome)}</b></div>
        <div><span>of which from visitors using idle bays</span><b>${rm0(st.fromVisitors)}</b></div></div>
      <details><summary>Where the money goes</summary><div class="tbl"><table><tbody>
        ${row('Charging receipts', rm(c.revenue))}${row('− TNB electricity', rm(c.electricityCost))}${row('− Other costs', rm(c.variableCost + c.fixedMonthly))}
        ${row('− Repairs logged', rm(c.maintenanceRm))}${row('Operating surplus', rm(c.operatingSurplus), 'total')}
        ${row(`JMB share (${Math.round(condo.jmbShare * 100)}%) to the maintenance fund`, rm(c.jmbIncome), 'hero-row')}${row('Charging partner', rm(c.partnerIncome))}
      </tbody></table></div></details>
      <p class="muted">A simulated month for the prototype. A real JMB would publish its own figures here.</p>
    </section>
    <h3 class="agroup">Vote on bay sharing</h3>
    <section class="statement">
      ${proposalHtml(condo, vote, 'resident')}
      <p class="error vote-err" role="alert" hidden></p>
      <p class="muted"><b>In force now:</b> ${esc(describeSharing(condo.sharing))}</p>
    </section>`;
}

function notifyNote(p) {
  const s = notifyState();
  if (s === 'unsupported') return '· not supported in this browser';
  if (s === 'denied') return '· blocked in browser settings';
  return p.notify && s === 'granted' ? '· charge done, slot ending, new votes' : '· off';
}

function saveProfile(ctx, patch) {
  ctx.state.profile = { ...ctx.state.profile, ...patch };
  ctx.save();
}

function bindAccount(root, ctx) {
  const $ = (sel) => root.querySelector(sel);
  const redraw = () => { $('#d-account').innerHTML = accountHtml(ctx); bindAccount(root, ctx); };
  $('#a-car').addEventListener('change', (e) => { ui.carId = e.target.value; saveProfile(ctx, { carId: ui.carId }); });
  $('#a-home').addEventListener('change', (e) => { ui.homeId = e.target.value; saveProfile(ctx, { homeId: ui.homeId }); redraw(); });
  const myCondo = ctx.world.condos.find((c) => c.id === ctx.state.profile.homeId);
  if (myCondo) bindProposal(root, ctx, myCondo);
  const prefs = () => saveProfile(ctx, { prefs: { ...ui.prefs } });
  $('#a-budget').addEventListener('change', (e) => { ui.prefs.maxPrice = e.target.value ? Number(e.target.value) : null; prefs(); });
  $('#a-fast').addEventListener('change', (e) => { ui.prefs.fastOnly = e.target.checked; prefs(); });
  $('#a-op').addEventListener('change', (e) => { ui.prefs.operator = e.target.value || null; prefs(); });
  $('#a-notify').addEventListener('change', async (e) => {
    const ok = e.target.checked && (await askPermission()) === 'granted';
    saveProfile(ctx, { notify: ok });
    redraw();
  });
  $('#a-theme').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    saveProfile(ctx, { theme });
  });
  root.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'name') {
      const box = document.createElement('form');
      box.className = 'name-edit';
      box.innerHTML = `<label class="search"><span class="sr-only">Your name</span><input id="a-name" maxlength="40" autocomplete="name" value="${esc(ctx.state.profile.name)}" placeholder="Your name"></label><button class="btn primary" type="submit">Save</button>`;
      b.replaceWith(box);
      box.querySelector('input').focus();
      box.addEventListener('submit', (e) => { e.preventDefault(); saveProfile(ctx, { name: box.querySelector('input').value.trim().slice(0, 40) }); redraw(); });
      return;
    }
    if (a === 'history') { location.hash = '#activity'; return; }
    const panel = $(`#a-${a}`);
    panel.hidden = !panel.hidden;
    b.setAttribute('aria-expanded', String(!panel.hidden));
    panel.querySelectorAll('[data-detail]').forEach((d) => d.addEventListener('click', () => { ui.selected = d.dataset.detail; location.hash = '#map'; }));
  }));
  root.querySelector('[data-reset]').addEventListener('click', () => document.getElementById('reset')?.click());
}

// Activity: the booking or charge in progress, otherwise your history.
function activityHtml(ctx, r) {
  if (ui.stage !== 'pick') return stageHtml(ctx, r);
  const flash = ui.flash ? `<p class="flash">${esc(ui.flash)}</p>` : '';
  const name = (id) => ctx.world.chargers.find((c) => c.id === id)?.name || id;
  const list = [...ctx.state.sessions].sort((a, b) => b.at - a.at).slice(0, 10);
  const source = document.getElementById('data-source')?.textContent || '';
  const mode = document.getElementById('data-mode')?.textContent || '';
  return `${flash}<h2>Activity</h2>
    <div class="empty-state">${IC.bolt}<p><b>No booking right now.</b> Book a bay from Home or Plan and it appears here: the hold, the QR code and the live charge.</p>
      <div class="btn-row"><a class="btn primary" href="#home">Find a charger</a><a class="btn" href="#plan">Plan a trip</a></div></div>
    ${monthHtml(ctx)}
    <section class="history"><h3>Recent sessions</h3>
      ${list.length ? `<ul class="hist">${list.map((x) => `<li><div><b>${esc(name(x.chargerId))}</b><span class="muted">${esc(fmtTime(new Date(x.at)))} · ${x.kWh.toFixed(1)} kWh</span></div><b class="price">${rm(x.costRm)}</b></li>`).join('')}</ul>`
        : '<p class="muted">No sessions on this device yet.</p>'}
    </section>
`;
}

function compute(ctx) {
  const car = CARS.find((c) => c.id === ui.carId);
  const start = originPoint();
  const origin = { lat: start.lat, lng: start.lng };
  const place = placeOf(ui.placeId);
  const destination = place.id === 'here' ? null : place;
  const ranking = rankChargers({
    ...ctx.world, car, batteryPct: ui.battery, origin, destination, date: ctx.clock,
    residentCondoId: ui.homeId || null, parkFor: ui.parkFor, prefs: ui.prefs,
  });
  let trip = place.trip
    ? planTrip({ chargers: [...HIGHWAY_CHARGERS, ...ctx.world.chargers], car, startPct: ui.battery, arriveMinPct: ui.arriveMin,
      origin: { ...origin, name: start.name }, destination: place, date: ctx.clock })
    : null;
  let tripRoad = null;
  if (trip?.ok) {
    tripRoad = road([origin, ...trip.stops.map((x) => x.charger), place], { alternatives: trip.stops.length === 0 });
    const best = tripRoad.routes[0];
    if (best && best.legs.length === trip.legs.length) trip = refineTrip(trip, best.legs, car, ui.arriveMin, ctx.clock);
  }
  return { car, origin, ranking, trip, place, tripRoad };
}

function update(root, ctx) {
  const { car, origin, ranking, trip, place, tripRoad } = compute(ctx);
  const $ = (sel) => root.querySelector(sel);
  if ($('#d-batt-out')) $('#d-batt-out').textContent = `${ui.battery}%`;
  if ($('#d-vspec')) $('#d-vspec').innerHTML = `<span class="chip off">${car.batteryKwh} kWh</span><span class="chip off">${esc(car.connectors.join(' · '))}</span>`;
  if ($('#d-arrive-out')) $('#d-arrive-out').textContent = `${ui.arriveMin}%`;
  last = { ranking, car };
  drawMarkers(root, ctx, origin, ranking, car);
  drawTrip(origin, trip, place, tripRoad);
  drawPickRoute(origin, trip, ctx);
  if ($('#d-results')) $('#d-results').innerHTML = trip ? tripHtml(trip, place, ctx, tripRoad) : pickHtml(ranking, ctx);
  if ($('#d-home-body')) $('#d-home-body').innerHTML = homeHtml(ranking, ctx, trip, place);
  if ($('#d-activity')) $('#d-activity').innerHTML = activityHtml(ctx, ranking);
  bind(root, ctx, ranking, car);
  renderDetail(root, ctx, ranking, car);
}

function hasPrefs() {
  return ui.prefs.maxPrice != null || ui.prefs.fastOnly || !!ui.prefs.operator;
}

// Apply what Ask CasSama understood, then redraw the page so every field shows it.
function ask(root, ctx, text) {
  if (tab === 'home' && aiOn()) { askAi(root, ctx, text); return; }
  ui.ask = text;
  const { set, understood } = parseRequest(text, { cars: CARS, places: ALL_PLACES });
  if (set.arriveMin != null) ui.arriveMin = set.arriveMin;
  if (set.carId) ui.carId = set.carId;
  if (set.battery != null) ui.battery = set.battery;
  if (set.placeId) ui.placeId = set.placeId;
  if (set.parkFor) ui.parkFor = set.parkFor;
  if ('maxPrice' in set) ui.prefs.maxPrice = set.maxPrice;
  if ('fastOnly' in set) ui.prefs.fastOnly = set.fastOnly;
  if ('operator' in set) ui.prefs.operator = set.operator;
  ui.askNote = understood.length
    ? `Understood: ${understood.join(' · ')}.`
    : 'Sorry, I could not find a battery level, place, stay or preference in that. Try "40%, going to KLCC for 2 hours".';
  if (ui.stage === 'plate') ui.stage = 'pick';
  if (location.hash !== '#plan') location.hash = '#plan';
  else renderDriver(root, ctx, 'plan');
}

// With an AI key on the server, Home's Ask CasSama is a conversation with the agents.
function askAi(root, ctx, text) {
  const t = text.trim();
  if (!t || chat.busy) return;
  ui.ask = '';
  const input = root.querySelector('#d-ask-text');
  if (input) input.value = '';
  const o = originPoint();
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const context = { carId: ui.carId, lat: r3(o.lat), lng: r3(o.lng), originName: o.name, clock: ctx.clock.toISOString(), homeId: ui.homeId || null, parkFor: ui.parkFor, prefs: ui.prefs };
  const draw = () => { const el = current?.root.querySelector('#d-chat'); if (el) { el.innerHTML = chatHtml(); bindChat(current.root, current.ctx); } };
  sendChat(t, context, draw);
}

function bindChat(root) {
  const redraw = () => { const el = root.querySelector('#d-chat'); if (el) { el.innerHTML = chatHtml(); bindChat(root); } };
  root.querySelector('[data-chat-clear]')?.addEventListener('click', () => { chat.messages = []; redraw(); });
  root.querySelectorAll('[data-chat-ask]').forEach((b) => b.addEventListener('click', () => { if (current) askAi(current.root, current.ctx, b.dataset.chatAsk); }));
  root.querySelectorAll('[data-chat-view]').forEach((b) => b.addEventListener('click', () => { ui.selected = b.dataset.chatView; location.hash = '#map'; }));
  root.querySelectorAll('[data-chat-act]').forEach((b) => b.addEventListener('click', () => {
    const a = chatAction(b.dataset.chatAct);
    if (!a) return;
    if (a.type === 'book') { ui.selected = a.chargerId; location.hash = '#map'; return; }
    if (a.car_id) ui.carId = a.car_id;
    if (a.battery_pct != null) ui.battery = a.battery_pct;
    if (a.place_id) ui.placeId = a.place_id;
    if (a.park_for) ui.parkFor = a.park_for;
    if (a.arrive_min_pct != null) ui.arriveMin = a.arrive_min_pct;
    if (ui.stage === 'plate') ui.stage = 'pick';
    location.hash = '#plan';
  }));
}
aiAvailable().then((on) => { if (on && tab === 'home' && current) renderDriver(current.root, current.ctx, 'home'); });

// ---- From / To: type a place, pick a suggestion, or use your location ----
let suggestTimer = null;
let suggestSeq = 0;

function useLocation(root, ctx, { quiet = false } = {}) {
  if (!navigator.geolocation) { ui.locMsg = 'This browser cannot share its location. Type where you are starting instead.'; renderDriver(root, ctx, 'plan'); return; }
  if (!quiet) { ui.locMsg = 'Finding your location…'; renderDriver(root, ctx, 'plan'); }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ui.from = { name: 'Current location', lat: pos.coords.latitude, lng: pos.coords.longitude, kind: 'gps' };
      ui.locMsg = `Using your location (±${Math.round(pos.coords.accuracy)} m). Only a point rounded to about 100 m is shared, to find the roads.`;
      if (tab === 'plan') renderDriver(root, ctx, 'plan');
    },
    (err) => {
      if (quiet) return;
      ui.locMsg = err.code === 1 ? 'Location is off for this site, so CasSama starts from KL East. Allow it in the browser, or type your start.'
        : 'Could not find your location just now. Starting from KL East.';
      if (tab === 'plan') renderDriver(root, ctx, 'plan');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

// If the user already allowed location for this site, use it without asking again.
export async function autoLocate(root, ctx) {
  if (ui.from || !navigator.permissions?.query) return;
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state === 'granted') useLocation(root, ctx, { quiet: true });
  } catch { /* not supported */ }
}

function bindRoute(root, ctx) {
  const list = root.querySelector('#d-suggest');
  const from = root.querySelector('#d-from');
  const to = root.querySelector('#d-to');
  let field = null;
  let items = [];

  const close = () => { list.hidden = true; list.innerHTML = ''; [from, to].forEach((i) => i.setAttribute('aria-expanded', 'false')); };
  const choose = (it) => {
    close();
    if (it.kind === 'locate') { useLocation(root, ctx); return; }
    if (field === from) {
      if (it.kind === 'home') ui.from = null;
      else ui.from = { name: it.name, lat: it.lat, lng: it.lng, kind: 'place' };
      ui.locMsg = '';
    } else if (it.id && it.id !== 'custom') {
      ui.placeId = it.id;
    } else {
      ui.customTo = { id: 'custom', name: it.name, lat: it.lat, lng: it.lng };
      ui.placeId = 'custom';
    }
    renderDriver(root, ctx, 'plan');
  };
  const draw = () => {
    list.innerHTML = items.map((it, i) => `<li role="option" id="d-sg-${i}" data-i="${i}" aria-selected="false">${IC[it.icon] || IC.pin}<span><b>${esc(it.name)}</b>${it.sub ? `<span class="muted">${esc(it.sub)}</span>` : ''}</span></li>`).join('')
      || '<li class="muted none">No match yet. Keep typing…</li>';
    if (items.some((it) => it.source === 'search')) list.innerHTML += '<li class="credit" aria-hidden="true">Place search: Photon · © OpenStreetMap contributors</li>';
    list.hidden = false;
    field.setAttribute('aria-expanded', 'true');
    list.querySelectorAll('[data-i]').forEach((li) => li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(items[Number(li.dataset.i)]); }));
  };
  const suggest = (input) => {
    field = input;
    const q = input.value.trim();
    const own = field === from
      ? [{ kind: 'locate', name: 'Use my current location', icon: 'locate' },
        ...(ui.homeId ? [{ kind: 'home', name: `My condo: ${CONDOS.find((c) => c.id === ui.homeId)?.name}`, icon: 'home' }] : []),
        { kind: 'home', name: 'KL East (demo start)', icon: 'home' }]
      : [];
    const known = [...ALL_PLACES.filter((p) => p.id !== 'here'), ...CONDOS.map((c) => ({ id: null, name: c.name, lat: c.lat, lng: c.lng }))];
    const local = q ? localMatches(q, known).slice(0, 5).map((p) => ({ ...p, sub: p.trip ? 'Longer trip' : 'Around KL East', icon: p.trip ? 'route' : 'pin' })) : [];
    items = [...(q ? own.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : own), ...local];
    draw();
    clearTimeout(suggestTimer);
    if (q.length < 3) return;
    const seq = ++suggestSeq;
    suggestTimer = setTimeout(async () => {
      const found = await searchPlaces(q, originPoint());
      if (seq !== suggestSeq || field !== input) return;
      const names = new Set(items.map((x) => x.name.toLowerCase()));
      items = [...items, ...found.filter((f) => !names.has(f.name.toLowerCase())).map((f) => ({ ...f, icon: 'pin' }))];
      draw();
    }, 350);
  };
  for (const input of [from, to]) {
    input.addEventListener('focus', () => { input.select(); suggest(input); });
    input.addEventListener('input', () => suggest(input));
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); input.blur(); }
      if (e.key === 'Enter') { e.preventDefault(); const first = items.find((x) => x.kind !== 'locate') || items[0]; if (first) choose(first); }
    });
  }
  root.querySelector('[data-locate]').addEventListener('click', () => useLocation(root, ctx));
}

// When should the driver charge at this site? The cheapest open hour in the next 24 h.
function timingLine(c, ctx, kWh) {
  const b = bestWindow({ charger: c.charger, condo: c.condo, isResident: c.isResident, from: ctx.clock, hours: 24, kWh });
  if (!b.best) return '';
  if (b.isNow || b.savingRm < 0.5) return `<p class="timing"><b>Smart schedule:</b> now is a good time to charge at ${esc(c.charger.name)}.</p>`;
  const quieter = b.best.occupancy < b.now.occupancy - 0.15 ? ', and it is quieter' : '';
  return `<p class="timing"><b>Smart schedule:</b> charging at ${esc(c.charger.name)} at ${esc(fmtTime(b.best.at))} costs ${rm(b.best.cost)} instead of ${rm(b.now.cost)} now (save ${rm(b.savingRm)})${quieter}.</p>`;
}

// Long trip: start, legs, charging stops (how much and how long), arrival. Like a trip planner,
// but it charges only what the next leg needs, at fast DC chargers.
function tripHtml(t, place, ctx, rd = null) {
  const head = `<div class="res-head"><h2>Trip to ${esc(place.name)}</h2><span class="mode mode-balanced">${t.ok ? `${t.stops.length} charge stop${t.stops.length === 1 ? '' : 's'}` : 'Not possible'}</span></div>`;
  if (!t.ok) return `${head}<p class="empty">${esc(t.error)}</p>`;
  const tot = t.totals;
  const pctTag = (p) => `<span class="batt ${p < 20 ? 'low' : ''}">${Math.round(p)}%</span>`;
  const legLine = (l) => `<li class="trip-leg"><span>${Math.round(l.km)} km · ${formatDuration(l.minutes)}</span></li>`;
  const items = [`<li class="trip-pt"><div><span class="muted">Start</span><b>${esc(t.legs[0].from)}</b></div>${pctTag(t.legs[0].startPct)}</li>`];
  t.legs.forEach((l, i) => {
    items.push(legLine(l));
    const s = t.stops[i];
    if (s) {
      items.push(`<li class="trip-stop"><div><span class="stop-tag">Charging stop</span><b>${esc(s.charger.name)}</b>
        <span class="muted">${esc(s.charger.operator)} · DC ${s.charger.kw} kW · ${rm(s.price)}/kWh · ${esc(fmtTime(new Date(s.at)))}</span></div>
        <div class="charge-bar">${pctTag(s.arrivePct)}<span class="track"><span style="left:${s.arrivePct}%;width:${s.departPct - s.arrivePct}%"></span></span>${pctTag(s.departPct)}</div>
        <p class="muted">${formatDuration(s.minutes)} · ${s.kWh.toFixed(1)} kWh · ${rm(s.cost)}</p></li>`);
    }
  });
  items.push(`<li class="trip-pt"><div><span class="muted">Arrive</span><b>${esc(place.name)}</b></div>${pctTag(t.arrivePct)}</li>`);
  return `${head}
    <p class="trip-total"><b>${formatDuration(tot.totalMin)}</b> total trip · ${Math.round(tot.km)} km · ${formatDuration(tot.chargeMin || 0.01)} charging${tot.cost ? ` · ${rm(tot.cost)} to charge` : ''}</p>
    <ol class="trip">${items.join('')}</ol>
    ${roadNote(t, rd, ctx)}
    <p class="muted">${t.stops.length ? 'CasSama charges only what the next leg needs, and never past 80%, where fast charging slows down, so stops stay short.' : `No stop needed: you arrive with ${Math.round(t.arrivePct)}%.`} Highway chargers are demo data.</p>
    ${stepsHtml(rd)}
    <div class="btn-row"><a class="btn primary grow" href="${esc(t.directionsUrl)}" target="_blank" rel="noopener">${IC.nav}Start in Google Maps</a>
      <a class="btn" href="https://waze.com/ul?ll=${(t.stops[0]?.charger || place).lat},${(t.stops[0]?.charger || place).lng}&navigate=yes" target="_blank" rel="noopener">Waze${t.stops.length ? ' to stop 1' : ''}</a></div>`;
}

// Where the trip numbers come from, and what traffic usually adds at this hour.
function roadNote(t, rd, ctx) {
  const tr = typicalTraffic(ctx.clock);
  const extra = Math.round(t.totals.driveMin * (tr.factor - 1));
  const r0 = rd?.routes?.[0];
  const live = r0?.live;
  const src = t.byRoad
    ? `By road: ${Math.round(t.totals.km)} km, ${formatDuration(t.totals.driveMin)} driving${live ? ' with traffic right now (TomTom)' : ' on free-flowing roads (OpenStreetMap routing)'}.`
    : rd?.status === 'loading' ? 'Checking the real roads…' : 'Road routing is unavailable, so distances are estimated.';
  const alt = rd?.routes?.[1] ? ` Alternative route: ${formatDuration(rd.routes[1].minutes)}, ${Math.round(rd.routes[1].km)} km.` : '';
  return `<div class="road-note">
    <p>${IC.route}<span>${esc(src)}${esc(alt)}</span></p>
    ${live ? `<p class="traffic t-${r0.delayMin >= 15 ? 'heavy' : r0.delayMin >= 5 ? 'moderate' : 'light'}">${IC.clock}<span><b>Live traffic: ${r0.delayMin ? `+${formatDuration(r0.delayMin)} delay` : 'no delays right now'}</b>${r0.traffic.length ? ` · ${r0.traffic.length} slow section${r0.traffic.length === 1 ? '' : 's'} on the map` : ''}. Times are for leaving now.</span></p>`
      : `<p class="traffic t-${tr.level.toLowerCase()}">${IC.clock}<span><b>Typical traffic now: ${tr.level}</b>${extra > 0 ? `, about +${formatDuration(extra)}` : ''}. An estimate for this hour, not live.</span></p>`}
    ${incidentsHtml(rd)}
    ${t.shortfall ? `<p class="warn-line">On the real roads this plan is tight. Charge a little more at the first stop, or set a higher arrival battery.</p>` : ''}
  </div>`;
}

function incidentsHtml(rd) {
  const list = rd?.incidents;
  if (!list?.length) return rd?.routes?.[0]?.live && rd.incidents ? `<p class="ok-line">${IC.check}<span>No incidents reported on your route.</span></p>` : '';
  return `<div class="incidents"><p><b>${list.length} incident${list.length === 1 ? '' : 's'} on your route</b> (TomTom, live)</p><ul>${list.slice(0, 4).map((i) => `<li>${incIcon(i.kind)}<span><b>${esc(i.label)}</b>${i.where ? ` · ${esc(i.where)}` : ''}${i.delayMin ? ` · +${i.delayMin} min` : ''}</span></li>`).join('')}</ul></div>`;
}

const INC_PATH = {
  roadworks: 'M4 20h16M6 20l4-12h4l4 12M8 14h8',
  jam: 'M5 16h14M6 16l1.5-5h9L18 16v3H6z',
  accident: 'M12 3 2 21h20zM12 10v5M12 18h.01',
  closed: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM7 12h10',
  other: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01',
};
const incIcon = (kind) => `<span class="inc inc-${kind in INC_PATH ? kind : 'other'}">${svg(INC_PATH[kind] || INC_PATH.other)}</span>`;

function stepsHtml(rd) {
  const route = rd?.routes?.[0];
  if (!route) return '';
  const steps = route.legs.flatMap((l, i) => [
    ...(i ? [{ text: `Charging stop ${i}`, km: null, stop: true }] : []),
    ...l.steps.filter((x, k) => !/^(arrive|you have arrived)/i.test(x.text) || (i === route.legs.length - 1 && k === l.steps.length - 1)),
  ]);
  return `<details class="steps"><summary>Turn-by-turn (${steps.length} steps)</summary><ol>${steps.map((x) => `<li class="${x.stop ? 'stop' : ''}"><span>${esc(x.text)}</span>${x.km ? `<span class="muted">${x.km < 1 ? `${Math.round(x.km * 1000)} m` : `${x.km.toFixed(1)} km`}</span>` : ''}</li>`).join('')}</ol></details>`;
}

// "Condo bays near you": every pilot condo, sideways-scrolling cards like a CPO app's Nearby list.
function condosHtml(ctx) {
  const origin = originPoint();
  const cards = ctx.world.chargers.filter((ch) => ch.siteType === 'condo').map((ch) => {
    const condo = ctx.world.condos.find((c) => c.id === ch.condoId);
    const mine = condo.id === ui.homeId;
    const occ = occupancyAt(ch, ctx.clock, condo).total;
    const open = isOpenToVisitors(condo, ctx.clock);
    const s = condo.sharing;
    const h12 = (h) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
    const until = s.mode === 'auto' ? 'Auto-share' : `until ${h12(s.end)}`;
    const status = mine ? `<span class="chip">${IC.home}Your condo</span>`
      : open ? `<span class="chip on">Shared now · ${until}</span>`
        : `<span class="chip">${IC.clock}${s.enabled ? `Visitors ${h12(s.start)}–${h12(s.end)}, ${s.days === 'all' ? 'daily' : s.days}` : 'Residents only'}</span>`;
    const km = distanceKm(origin, ch);
    return { km, html: `<button class="ccard" type="button" data-detail="${esc(ch.id)}">
      ${siteArt(ch, condo.name)}
      <b>${esc(condo.name)}</b>
      <span class="facts">${availChip(ch, occ)}<span>${IC.pin}${km.toFixed(1)} km</span>${ch.live ? '<span class="live-tag" title="Live from the chargers (OCPP)"><span class="live-dot"></span>Live</span>' : ''}</span>
      <span class="price">${rm(priceAt(ch, ctx.clock, condo, mine))}/kWh ${mine ? 'resident' : 'visitor'} price</span>
      ${status}</button>` };
  }).sort((a, b) => a.km - b.km);
  return `<section class="condos" aria-label="Condo bays near you"><h3>Condo bays near you</h3>
    <div class="ccards">${cards.map((c) => c.html).join('')}</div></section>`;
}

// The driver's own month, like the operator apps' "Insights this month".
function monthHtml(ctx) {
  const m = monthSummary(ctx.state.sessions, ctx.clock);
  return `<section class="month" aria-label="Your month"><h3>Your ${esc(ctx.clock.toLocaleString('en-MY', { month: 'long' }))}</h3>
    <div class="mstats"><div><b>${m.sessions}</b><span>sessions</span></div><div><b>${m.kWh.toFixed(1)}</b><span>kWh charged</span></div>
    <div><b>${rm(m.paidRm)}</b><span>paid</span></div><div><b>${Math.round(m.co2Kg)} kg</b><span>CO₂ avoided</span></div></div>
    ${m.sessions ? '' : '<p class="muted">Book a charge and it shows up here.</p>'}</section>`;
}

function compareHtml(r) {
  const rows = priceComparison(r.results);
  if (rows.length < 2) return '';
  return `<details class="compare"><summary>Compare prices (${rows.length} chargers for this trip)</summary>
    <div class="tbl"><table>
      <thead><tr><th>Charger</th><th>Type</th><th>Price</th><th>Your charge</th><th>vs cheapest</th><th>Distance</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${esc(x.name)}<br><span class="muted">${esc(x.operator)}${x.shared ? ' · shared condo bay' : ''}</span></td><td>${esc(x.kind)}</td><td>${rm(x.price)}${x.priceEstimated ? ' est.' : ''}</td><td>${rm(x.cost)}</td><td>${x.vsCheapest ? `+${rm(x.vsCheapest)}` : 'Cheapest'}</td><td>${x.km.toFixed(1)} km</td></tr>`).join('')}</tbody>
    </table></div></details>`;
}

function modeLine(mode) {
  if (mode === 'urgent') return 'Low battery, so the quickest working charge comes first';
  if (mode === 'saver') return 'Plenty of charge, so cheaper and quieter chargers come first';
  return 'Balancing price, time and reliability';
}

const facts = (c) => `<div class="facts">${availChip(c.charger, c.occupancy)}
        <span>${IC.pin}${c.km < 1 ? `${Math.round(c.km * 1000)} m` : `${c.km.toFixed(1)} km`}</span>
        <span>${IC.bolt}${c.charger.kw} kW</span>
        <span class="price">${rm(c.price)}/kWh${c.charger.priceEstimated ? ' est.' : ''}</span>
        ${c.isSharedVisit ? '<span class="chip on">Shared now</span>' : ''}${c.isResident ? `<span class="chip">${IC.home}Your condo</span>` : ''}</div>`;

function heroCard(c) {
  return `
    <article class="pick hero">
      <div class="hero-tags">${c.isSharedVisit ? '<span class="chip amber-tag">Shared now</span>' : ''}${c.isResident ? `<span class="chip">${IC.home}Your condo</span>` : ''}</div>
      <h3>${esc(c.charger.name)}</h3>
      <p class="muted">${esc(c.charger.operator)} · ${esc(c.charger.connectors.join(', '))}</p>
      <div class="facts">${availChip(c.charger, c.occupancy)}<span>${IC.pin}${c.km < 1 ? `${Math.round(c.km * 1000)} m` : `${c.km.toFixed(1)} km`}</span><span>${IC.bolt}${c.charger.kw} kW</span></div>
      <p class="price-line"><b>${rm(c.price)}</b><span>/kWh${c.charger.priceEstimated ? ' est.' : ''} · ${esc(c.reasons[0])}</span></p>
      <ul class="reasons">${c.reasons.slice(1).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="btn-row"><button class="btn primary grow" type="button" data-book="${c.charger.id}">Book this bay</button>
      <a class="btn" href="${esc(navUrl(c.charger))}" target="_blank" rel="noopener">${IC.nav}Go</a>
      <button class="btn" type="button" data-detail="${c.charger.id}">On map</button></div>
    </article>`;
}

function smallCard(c, i) {
  return `
    <article class="pick">
      <div class="pick-top"><span class="rank">${i + 1}</span>
        <div><h3>${esc(c.charger.name)}</h3><p class="muted">${esc(c.charger.operator)}</p></div></div>
      ${facts(c)}
      <ul class="reasons">${c.reasons.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="btn-row"><button class="btn" type="button" data-book="${c.charger.id}">Book</button>
      <button class="btn" type="button" data-detail="${c.charger.id}">On map</button></div>
    </article>`;
}

function pickHtml(r, ctx) {
  const flash = ui.flash ? `<p class="flash">${esc(ui.flash)}</p>` : '';
  const head = `${flash}<div class="res-head"><h2>Best picks</h2><span class="mode mode-${r.mode}">${MODES[r.mode].label}</span></div>
    <p class="muted">${modeLine(r.mode)}. Charging to ${r.target}% (${Math.round(r.kWh)} kWh) · ${esc(fmtTime(ctx.clock))}</p>`;
  if (r.kWh < 1) return `${head}<p class="empty">Your battery is at ${ui.battery}%. No charge needed for this trip.</p>`;
  const top = r.results.slice(0, 3);
  if (!top.length) {
    const nearest = [...r.excluded].sort((a, b) => a.km - b.km)[0];
    const hint = nearest ? ` The nearest is ${esc(nearest.charger.name)}, ${nearest.km.toFixed(1)} km away.` : '';
    if (hasPrefs()) return `${head}<p class="empty">No charger matches your preferences right now. Loosen your budget, speed or operator under My preferences.</p>`;
    return `${head}<p class="empty">No charger is in range at ${ui.battery}%.${hint} Call your roadside assistance for a mobile charge.</p>`;
  }
  const note = r.balanceNote ? `<p class="balance"><b>Demand balancing.</b> ${esc(r.balanceNote)}</p>` : '';
  const cards = top.map((c, i) => (i === 0 ? heroCard(c) : smallCard(c, i))).join('');
  const off = r.excluded.length
    ? `<details class="excluded"><summary>${r.excluded.length} chargers not suitable right now</summary><ul>${r.excluded.map((x) => `<li>${esc(x.charger.name)}: ${esc(x.reason)}</li>`).join('')}</ul></details>`
    : '';
  const rest = r.results.slice(3);
  const more = rest.length
    ? `<details class="more"><summary>Choose another charger (${rest.length})</summary><ul>${rest.map((c) => `<li><span>${esc(c.charger.name)} · ${rm(c.price)}/kWh · ${c.km.toFixed(1)} km</span> <span class="btn-row"><button class="btn small" type="button" data-detail="${c.charger.id}">Details</button><button class="btn small" type="button" data-book="${c.charger.id}">Book</button></span></li>`).join('')}</ul></details>`
    : '';
  const own = r.results.find((c) => c.isResident) || top[0];
  const timing = timingLine(own, ctx, own.full ? own.kWh : own.deliveredKwh);
  return head + `<div class="picks">${cards}</div>` + timing + note + compareHtml(r) + more + off;
}

function journeyHtml(stage) {
  const active = { plate: 0, booked: 1, charging: 2, done: 3 }[stage];
  return `<ol class="journey" aria-label="Charging stages">${['Choose', 'Bay held', 'Charging', 'Check-in'].map((label, i) => `<li ${i === active ? 'aria-current="step"' : ''} class="${i < active ? 'complete' : ''}"><span aria-hidden="true">${i + 1}</span>${label}</li>`).join('')}</ol>`;
}

function stageHtml(ctx, r) {
  const p = ui.pick;
  const journey = journeyHtml(ui.stage);
  if (ui.stage === 'plate') {
    const c = r.results.find((x) => x.charger.id === ui.pending);
    return `${journey}<h2>Visitor details</h2>
      <p><b>${esc(c ? c.charger.name : 'This bay')}</b> is a shared condo bay. The condo's management lets visitors in by number plate.</p>
      <form id="d-plate-form" class="form" novalidate>
        <label class="field">Number plate <input id="d-plate" type="text" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="e.g. WXY 1234" value="${esc(ui.plate)}"></label>
        <label class="check"><input type="checkbox" id="d-consent"> My plate is shared with the condo management only to let me in.</label>
        <p id="d-plate-err" class="error" role="alert" hidden></p>
        <div class="btn-row"><button class="btn primary" type="submit">Confirm booking</button>
        <button class="btn" type="button" data-act="back">Back</button></div>
      </form>`;
  }
  if (ui.stage === 'booked') {
    const until = new Date(p.bookedAt + CONST.holdMinutes * 60000);
    const pass = p.pass
      ? `<p class="approved"><b>Approved.</b> Show plate <b>${esc(formatPlate(p.pass.plate))}</b> at the guardhouse, ${esc(fmtTime(new Date(p.pass.slotStart)))} to ${esc(fmtClock(new Date(p.pass.slotEnd)))}.</p>`
      : '';
    return `${journey}<h2>Bay held</h2>
      ${pass}
      <p class="saved">${esc(savingLine(p))}</p>
      <p><b>${esc(p.name)}</b> is held for you for ${CONST.holdMinutes} minutes, until ${esc(fmtTime(until))}.</p>
      ${qrSvg(p.chargerId)}
      <p class="muted">Demo QR illustration. At the bay, scan the code on the charger to start.</p>
      <div class="btn-row"><button class="btn primary" type="button" data-act="start">Scan QR and start charging</button>
      <button class="btn" type="button" data-act="cancel">Cancel booking</button></div>`;
  }
  if (ui.stage === 'charging') {
    const s = p.session;
    const battery = Math.min(100, p.startPct + (s.kWh / p.batteryKwh) * 100);
    const C = 2 * Math.PI * 102;
    const left = Math.max(0, ((p.kWhTarget - s.kWh) / p.power) * 60);
    const fullAt = new Date(p.bookedAt + (s.minutes + left) * 60000);
    return `${journey}<div class="charge-view">
      <div class="head"><h2>Charging</h2><span class="chip on"><span class="live-dot"></span>Live</span></div>
      <p class="muted">${esc(p.name)}</p>
      <div class="ring" role="progressbar" aria-label="Battery" aria-valuenow="${Math.round(battery)}" aria-valuemin="0" aria-valuemax="100">
        <svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="102"/>
          <circle class="value" cx="110" cy="110" r="102" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - battery / 100)).toFixed(1)}"/></svg>
        <div class="label"><b>${Math.round(battery)}%</b><span>+${s.kWh.toFixed(1)} kWh</span></div>
      </div>
      <div class="cstats">
        <div><span>Cost so far</span><b>${rm(s.kWh * p.price)}</b></div>
        <div><span>Time</span><b>${formatDuration(s.minutes)}</b></div>
        <div><span>Full at</span><b>${esc(fmtClock(fullAt))}</b></div>
        <div><span>Slot ends</span><b>${esc(fmtClock(new Date(p.slotEnd)))}</b></div>
      </div>
      <p class="notice amber">${IC.clock}<span>Move your car by ${esc(fmtClock(new Date(p.slotEnd)))}. After that it is ${rm(CONST.overstayRmPer10Min)} per 10 min, so the next driver can charge.${p.walk ? ` ${esc(p.walk)}: go ahead, the car charges while you are there.` : ''}</span></p>
      <button class="btn danger" type="button" data-act="stop">Stop charging</button>
      <p class="muted">Demo speed: 1 second = 1 minute of charging.</p>
    </div>`;
  }
  const s = p.session;
  return `${journey}<p class="notice-line"><b>Notification:</b> ${s.kWh >= p.kWhTarget - 0.01 ? 'charging complete' : 'charging stopped'}. Please move your car by ${esc(fmtClock(new Date(p.slotEnd)))} to avoid the overstay fee.</p>
    <h2>How did it go?</h2>
    <p>${s.kWh.toFixed(1)} kWh for <b>${rm(s.kWh * p.price)}</b> at ${esc(p.name)}.</p>
    <label class="field">Note (optional) <input id="d-note" type="text" maxlength="120" placeholder="e.g. cable damaged on bay 3"></label>
    <div class="btn-row"><button class="btn primary" type="button" data-act="ok">It worked</button>
    <button class="btn" type="button" data-act="problem">Report a problem</button></div>
    <p class="muted">Your check-in updates this charger's reliability for every driver.</p>`;
}

function savingLine(p) {
  if (p.saving >= 0.01) return `You saved ${rm(p.saving)} vs the nearest charger.`;
  if (p.minutesVsNearest < 0) return `${formatDuration(-p.minutesVsNearest)} faster than the nearest charger.`;
  return 'Same as the nearest charger.';
}

function bind(root, ctx, ranking, car) {
  const box = root;
  root.querySelector('[data-reset]')?.addEventListener('click', () => document.getElementById('reset')?.click());
  box.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => startBooking(root, ctx, ranking, car, btn.dataset.book)));
  box.querySelectorAll('[data-detail]').forEach((btn) => btn.addEventListener('click', () => select(root, ctx, btn.dataset.detail, true)));
  const form = box.querySelector('#d-plate-form');
  if (form) {
    const input = form.querySelector('#d-plate');
    input.addEventListener('input', () => { ui.plate = input.value; });
    form.addEventListener('submit', (e) => { e.preventDefault(); confirmVisitor(root, ctx, ranking, car, form); });
  }
  const act = (name, fn) => { const b = box.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', fn); };
  act('back', () => { ui.stage = 'pick'; ui.pending = null; location.hash = '#plan'; });
  act('start', () => { ui.stage = 'charging'; update(root, ctx); startTimer(); });
  act('cancel', async () => {
    const p = ui.pick;
    if (ctx.api && p?.bookingRef) {
      const r = await ctx.api.cancel(p.bookingRef.id, p.bookingRef.cancelToken);
      if (!r.ok) { ui.flash = `Couldn't cancel: ${r.error}`; update(root, ctx); return; }
    } else if (p?.pass) {
      ctx.state.visitorPasses = ctx.state.visitorPasses.filter((x) => x.id !== p.pass.id);
    }
    ui.stage = 'pick'; ui.pick = null; ctx.state.booking = null; ctx.save();
    if (ctx.api) ctx.refresh(); else update(root, ctx);
  });
  act('stop', () => { stopTimer(); ui.stage = 'done'; update(root, ctx); });
  const checkin = async (ok) => {
    const note = (box.querySelector('#d-note')?.value || '').trim();
    const record = { ok, note, at: ctx.clock.getTime() };
    if (ctx.api) {
      const r = await ctx.api.checkin({ chargerId: ui.pick.chargerId, ...record });
      if (!r.ok) { ui.flash = `Couldn't save your check-in: ${r.error}`; update(root, ctx); return; }
    } else {
      const list = ctx.state.checkins[ui.pick.chargerId] || [];
      ctx.state.checkins[ui.pick.chargerId] = [...list, record];
    }
    ctx.state.booking = null;
    ctx.save();
    ui.flash = ok ? 'Thanks. Your check-in raised this charger\'s reliability score.' : 'Thanks. The JMB and operator can now see this problem.';
    ui.stage = 'pick';
    ui.pick = null;
    if (ctx.api) ctx.refresh(); else ctx.rerender();
  };
  act('ok', () => checkin(true));
  act('problem', () => checkin(false));
}

function startBooking(root, ctx, ranking, car, id) {
  const c = ranking.results.find((x) => x.charger.id === id);
  if (!c) return;
  ui.flash = '';
  if (c.isSharedVisit) { ui.stage = 'plate'; ui.pending = c.charger.id; goActivity(root, ctx); return; }
  book(root, ctx, ranking, c, car, null);
}

function confirmVisitor(root, ctx, ranking, car, form) {
  const err = form.querySelector('#d-plate-err');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };
  const back = (msg) => { ui.stage = 'pick'; ui.pending = null; ui.flash = msg; update(root, ctx); };
  const c = ranking.results.find((x) => x.charger.id === ui.pending);
  if (!c) { back('That bay is no longer free. Pick another charger.'); return; }
  const plate = normalisePlate(ui.plate);
  if (!isValidPlate(plate)) { fail('Enter a number plate with letters and numbers, for example WXY 1234.'); return; }
  if (!form.querySelector('#d-consent').checked) { fail('Tick the box to share your plate with the condo management.'); return; }
  if (!canAutoApprove(c.condo, c.arrival)) { back(`${c.condo.name} is not sharing at that time. Pick another charger.`); return; }
  book(root, ctx, ranking, c, car, { plate, consent: true });
}

// Hold the bay, record the session (anonymous) and, for visitors, the plate pass.
// Shared mode: the server saves it and approves the pass itself; nothing is confirmed until it answers.
async function book(root, ctx, ranking, c, car, visitor) {
  const power = c.charger.type === 'DC' ? Math.min(c.charger.kw, car.dcKw) : Math.min(c.charger.kw, car.acKw);
  const session = buildSession({
    ranking, chosenId: c.charger.id, at: ctx.clock.getTime(), anonNo: anonNumber(ctx.state), resident: !!ui.homeId,
  });
  const start = c.arrival.getTime();
  const slotMinutes = Math.max(60, Math.ceil((CONST.holdMinutes + c.stopChargeMin) / 30) * 30);
  const end = start + slotMinutes * 60000;
  let pass = null;
  let bookingRef = null;
  if (ctx.api) {
    const r = await ctx.api.book({ session, booking: { chargerId: c.charger.id, start, end }, pass: visitor || undefined });
    if (!r.ok) {
      ui.stage = 'pick'; ui.pending = null;
      ui.flash = r.status === 0 ? 'Couldn\'t save your booking, try again.' : r.error;
      update(root, ctx);
      return;
    }
    pass = r.data.pass || null;
    bookingRef = { id: r.data.bookingId, cancelToken: r.data.cancelToken };
    addSession(ctx.state, session);
  } else {
    addSession(ctx.state, session);
    if (visitor) {
      pass = createPass({ id: `pass-${start}-${c.charger.id}`, condoId: c.condo.id, chargerId: c.charger.id, plate: visitor.plate, slotStart: start, minutes: slotMinutes, now: ctx.clock.getTime() });
      ctx.state.visitorPasses = [...ctx.state.visitorPasses, pass];
    }
  }
  ui.pending = null;
  ui.pick = {
    chargerId: c.charger.id, name: c.charger.name, price: c.price, kWhTarget: c.deliveredKwh, power,
    batteryKwh: car.batteryKwh, startPct: ui.battery, bookedAt: ctx.clock.getTime(),
    session: { kWh: 0, minutes: 0 }, pass, bookingRef,
    slotEnd: pass ? pass.slotEnd : end,
    walk: c.reasons.find((x) => x.includes('min walk to')) || null,
    saving: session.nearestCostRm - session.costRm, minutesVsNearest: session.minutesVsNearest,
  };
  ui.stage = 'booked';
  ctx.state.booking = { chargerId: c.charger.id, at: ctx.clock.getTime() };
  ctx.save();
  goActivity(root, ctx);
  if (ctx.api) ctx.refresh();
}

// Bookings and charging live on the Activity tab.
function goActivity(root, ctx) {
  if (location.hash !== '#activity') location.hash = '#activity';
  else update(root, ctx);
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    const p = ui.pick;
    if (!p || ui.stage !== 'charging') { stopTimer(); return; }
    p.session.minutes += 1;
    p.session.kWh = Math.min(p.kWhTarget, p.session.kWh + p.power / 60);
    const profile = current?.ctx.state.profile;
    const nowSim = p.bookedAt + p.session.minutes * 60000;
    if (p.slotEnd && p.slotEnd - nowSim <= 15 * 60000) notify(profile, `slot-${p.bookedAt}`, 'CasSama: 15 minutes left', `Your charging slot ends at ${fmtClock(new Date(p.slotEnd))}. After that it is ${rm(CONST.overstayRmPer10Min)} per 10 min.`);
    if (p.session.kWh >= p.kWhTarget) {
      stopTimer(); ui.stage = 'done';
      notify(profile, `done-${p.bookedAt}`, 'CasSama: charging complete', `${p.session.kWh.toFixed(1)} kWh added. Please move your car by ${fmtClock(new Date(p.slotEnd))}.`);
    }
    if (current?.root.querySelector('#d-activity')) update(current.root, current.ctx);
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

let tripLayer = null;
function drawRoadLine(layer, coords, alt = false) {
  L.polyline(coords, { className: alt ? 'road-casing alt' : 'road-casing', weight: alt ? 8 : 10, interactive: false }).addTo(layer);
  return L.polyline(coords, { className: alt ? 'road-line alt' : 'road-line', weight: alt ? 5 : 6 }).addTo(layer);
}

function drawTrip(origin, t, place, rd = null) {
  if (!map) return;
  const had = !!tripLayer;
  if (tripLayer) { tripLayer.remove(); tripLayer = null; }
  if (!t) { if (had) map.setView([3.2135, 101.7265], 14); return; }
  tripLayer = L.layerGroup().addTo(map);
  const pts = [[origin.lat, origin.lng], ...t.stops.map((s) => [s.charger.lat, s.charger.lng]), [place.lat, place.lng]];
  const routes = rd?.routes || [];
  if (routes.length) {
    routes.slice(1, 2).forEach((r) => drawRoadLine(tripLayer, r.coords, true).bindTooltip(`${formatDuration(r.minutes)} · ${Math.round(r.km)} km`, { className: 'eta-chip alt', sticky: true }));
    drawRoadLine(tripLayer, routes[0].coords).bindTooltip(`${formatDuration(routes[0].minutes)} · ${Math.round(routes[0].km)} km`, { permanent: true, direction: 'center', className: 'eta-chip' });
    drawTrafficSections(tripLayer, routes[0]);
    drawIncidents(tripLayer, rd.incidents || []);
  } else {
    L.polyline(pts, { className: 'trip-line', weight: 4, dashArray: '6 8' }).addTo(tripLayer);
  }
  for (const s of t.stops) {
    L.marker([s.charger.lat, s.charger.lng], { icon: L.divIcon({ html: `<span class="pin pick">${IC.bolt}${Math.round(s.arrivePct)}→${s.departPct}%</span>`, className: 'pin-wrap', iconSize: null }), title: s.charger.name })
      .bindPopup(`<div class="pop"><b>${esc(s.charger.name)}</b><br>Charge ${Math.round(s.arrivePct)}% → ${s.departPct}% · ${formatDuration(s.minutes)}</div>`).addTo(tripLayer);
  }
  L.marker([place.lat, place.lng], { icon: L.divIcon({ html: `<span class="pin dest">${esc(place.name)}</span>`, className: 'pin-wrap', iconSize: null }) }).addTo(tripLayer);
  if (!tripLayer.fitted) map.fitBounds(routes[0]?.coords?.length ? routes[0].coords : pts, { padding: [30, 30] });
}

// Charge nearby: the road to the selected charger (or the top pick), with the time by road.
let pickLayer = null;
function drawPickRoute(origin, trip, ctx) {
  if (pickLayer) { pickLayer.remove(); pickLayer = null; }
  if (!map || trip || !last) return;
  const target = ctx.world.chargers.find((c) => c.id === ui.selected) || last.ranking.results[0]?.charger;
  if (!target || distanceKm(origin, target) < 0.2) return;
  const rd = road([origin, target], { alternatives: tab === 'map' });
  if (!rd.routes.length) return;
  pickLayer = L.layerGroup().addTo(map);
  rd.routes.slice(1, 2).forEach((r) => drawRoadLine(pickLayer, r.coords, true));
  const tr = typicalTraffic(ctx.clock);
  const r0 = rd.routes[0];
  drawRoadLine(pickLayer, r0.coords).bindTooltip(`${formatDuration(r0.live ? r0.minutes : r0.minutes * tr.factor)} · ${r0.km} km`, { permanent: true, direction: 'center', className: 'eta-chip' });
  drawTrafficSections(pickLayer, r0);
  drawIncidents(pickLayer, rd.incidents || []);
}

// Slow parts of a live route in amber or red, on top of the blue line (like Google Maps).
function drawTrafficSections(layer, r) {
  for (const sec of r.traffic || []) {
    const part = r.coords.slice(sec.from, sec.to + 1);
    if (part.length > 1) L.polyline(part, { className: `road-traffic lvl-${Math.min(4, Math.max(1, sec.level))}`, weight: 6, interactive: false }).addTo(layer);
  }
}

function drawIncidents(layer, list) {
  for (const i of list) {
    L.marker([i.lat, i.lng], { icon: L.divIcon({ html: incIcon(i.kind), className: 'pin-wrap', iconSize: null }), title: i.label, keyboard: false })
      .bindPopup(`<div class="pop"><b>${esc(i.label)}</b>${i.where ? `<br>${esc(i.where)}` : ''}${i.delayMin ? `<br>About +${i.delayMin} min` : ''}<br><span class="muted">TomTom, live</span></div>`).addTo(layer);
  }
}

// Map tab: every incident in view, refreshed when the map moves.
let incTimer = null;
function refreshIncidentLayer() {
  if (!map) return;
  if (incidentLayer) { incidentLayer.remove(); incidentLayer = null; }
  if (!incidentsOn) return;
  const b = map.getBounds();
  incidentLayer = L.layerGroup().addTo(map);
  const layer = incidentLayer;
  fetchIncidents([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).then((list) => { if (layer === incidentLayer) drawIncidents(layer, list); });
}

function initMap(el, fallback) {
  incidentLayer = null;
  tripLayer = null;
  pickLayer = null;
  trafficLayer = null;
  if (!window.L) { el.hidden = true; fallback.hidden = false; return; }
  // Presentation-only: a route replacement must not leave a zoom transition running.
  map = L.map(el, { scrollWheelZoom: true, zoomAnimation: false }).setView([3.2135, 101.7265], 14);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  tiles.on('tileerror', () => { fallback.hidden = false; });
  layer = L.layerGroup().addTo(map);
}

// What the filters need to know about one charger right now.
function filterInfo(ch, ctx) {
  const condo = ctx.world.condos.find((c) => c.id === ch.condoId) || null;
  const mine = !!condo && condo.id === ui.homeId;
  const note = priceNote(ch, ctx.clock, condo);
  return {
    type: ch.type, kw: ch.kw, connectors: ch.connectors, operator: ch.operator,
    free: availability(ch, occupancyAt(ch, ctx.clock, condo).total).free,
    condoSharedNow: !!condo && !mine && isOpenToVisitors(condo, ctx.clock),
    price: priceAt(ch, ctx.clock, condo, mine),
    promo: note && note !== 'Peak-hour price' ? note : null,
  };
}
const passesFilter = (ch, ctx, f = ui.filters) => matchesFilters(filterInfo(ch, ctx), f);

function setTraffic(on) {
  trafficOn = on;
  if (!map) return;
  if (on && !trafficLayer) trafficLayer = L.tileLayer('api/traffic/{z}/{x}/{y}.png', { maxZoom: 19, opacity: 0.9, attribution: 'Traffic &copy; TomTom' }).addTo(map);
  if (!on && trafficLayer) { trafficLayer.remove(); trafficLayer = null; }
}

function filterBarHtml() {
  const n = countFilters(ui.filters);
  return `<button type="button" class="fbtn" data-fopen aria-haspopup="dialog">${IC.filter}Filters${n ? `<span class="badge">${n}</span>` : ''}</button>`
    + (trafficAvailable ? `<button type="button" data-traffic aria-pressed="${trafficOn}">${IC.route}Live traffic</button><button type="button" data-incidents aria-pressed="${incidentsOn}">${IC.alert}Incidents</button>` : '')
    + QUICK.map(([k, l, on]) => `<button type="button" data-quick-filter="${k}" aria-pressed="${on(ui.filters)}">${l}</button>`).join('');
}

function bindFilterBar(root, ctx) {
  const bar = root.querySelector('.map-filters');
  if (!bar) return;
  bar.querySelectorAll('[data-quick-filter]').forEach((b) => b.addEventListener('click', () => {
    QUICK.find(([k]) => k === b.dataset.quickFilter)[3](ui.filters);
    bar.innerHTML = filterBarHtml();
    bindFilterBar(root, ctx);
    update(root, ctx);
  }));
  bar.querySelector('[data-fopen]').addEventListener('click', () => openSheet(root, ctx));
  bar.querySelector('[data-traffic]')?.addEventListener('click', (e) => { setTraffic(!trafficOn); e.currentTarget.setAttribute('aria-pressed', String(trafficOn)); });
  bar.querySelector('[data-incidents]')?.addEventListener('click', (e) => { incidentsOn = !incidentsOn; e.currentTarget.setAttribute('aria-pressed', String(incidentsOn)); refreshIncidentLayer(); });
}

// ---- Search (like the operator apps): history, filters, a result count and picture rows ----
function searchRows(ctx) {
  const origin = originPoint();
  const sites = ctx.world.chargers
    .filter((ch) => passesFilter(ch, ctx) && (!search.saved || ctx.state.favourites.includes(ch.id)))
    .map((ch) => ({ id: ch.id, name: ch.name, operator: ch.operator, type: `${ch.type} ${ch.kw}kW`, category: categoryOf(ch), address: ch.address || '', km: distanceKm(origin, ch), ch }));
  return searchSites(sites, search.q);
}

function resultHtml(r, ctx) {
  const ch = r.ch;
  const condo = ctx.world.condos.find((c) => c.id === ch.condoId) || null;
  const info = filterInfo(ch, ctx);
  const saved = ctx.state.favourites.includes(ch.id);
  const status = info.free ? `<span class="ok">Available ${IC.bolt} ${info.free} free</span>` : `<span class="off">Full right now</span>`;
  const extra = condo ? (condo.id === ui.homeId ? 'Your condo' : isOpenToVisitors(condo, ctx.clock) ? `Shared until ${condo.sharing.end}:00` : 'Residents only right now') : `${ch.type} ${ch.kw} kW · ${rm(info.price)}/kWh`;
  return `<li class="sres"><button type="button" class="sres-main" data-pick="${esc(ch.id)}">${siteArt(ch, ch.name)}
      <span class="sres-txt"><span class="srow">${brandMark(ch.operator)}<span class="tag">${esc(r.category)}</span></span>
      <b>${esc(ch.name)}</b><span class="srow">${status}<span class="muted">${IC.pin}${r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km.toFixed(1)} km`}</span></span>
      <span class="muted">${esc(extra)}</span></span></button>
    <button type="button" class="bm" data-fav="${esc(ch.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from' : 'Save to'} saved chargers">${IC.bookmark}</button></li>`;
}

function openSearch(root, ctx) {
  const box = root.querySelector('#d-search');
  if (!box) return;
  search.open = true;
  const close = () => { search.open = false; box.hidden = true; box.innerHTML = ''; root.querySelector('[data-sopen]')?.focus(); };
  const results = () => {
    const rows = searchRows(ctx);
    const list = box.querySelector('#d-sres');
    box.querySelector('#d-scount').textContent = `${rows.length} result${rows.length === 1 ? '' : 's'} found`;
    list.innerHTML = rows.length ? rows.map((r) => resultHtml(r, ctx)).join('')
      : `<li class="empty">Nothing matches${search.q ? ` "${esc(search.q)}"` : ''}. Try a mall, a condo, an operator, AC or DC.</li>`;
    list.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      ctx.state.searchHistory = remember(ctx.state.searchHistory, search.q);
      ctx.save();
      close();
      select(root, ctx, b.dataset.pick, false);
      focusSelected();
    }));
    list.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.fav;
      const favs = ctx.state.favourites;
      ctx.state.favourites = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
      ctx.save();
      results();
      box.querySelector(`[data-fav="${CSS.escape(id)}"]`)?.focus();
    }));
  };
  const history = () => {
    const h = box.querySelector('#d-shist');
    const items = ctx.state.searchHistory;
    h.innerHTML = search.q ? '' : `<p class="muted">${items.length ? 'Recent searches' : 'Search a mall, condo, operator, AC or DC'}</p>
      <div class="fchips plain">${items.map((q) => `<button type="button" data-hist="${esc(q)}">${IC.clock}${esc(q)}</button>`).join('')}
      <button type="button" data-saved aria-pressed="${search.saved}">${IC.bookmark}Saved (${ctx.state.favourites.length})</button></div>`;
    h.querySelectorAll('[data-hist]').forEach((b) => b.addEventListener('click', () => { search.q = b.dataset.hist; input.value = search.q; history(); results(); }));
    h.querySelector('[data-saved]')?.addEventListener('click', () => { search.saved = !search.saved; history(); results(); });
  };
  box.innerHTML = `<header class="shead"><button type="button" class="round" data-sclose aria-label="Back to the map">${IC.back}</button>
      <label class="search"><span class="sr-only">Search chargers</span>${IC.search}<input id="d-sq" type="search" autocomplete="off" enterkeyhint="search" placeholder="Search location, mall, condo, operator" value="${esc(search.q)}"></label></header>
    <div id="d-shist"></div>
    <div class="map-filters">${filterBarHtml()}</div>
    <p class="scount" id="d-scount" aria-live="polite"></p>
    <ul class="slist" id="d-sres"></ul>`;
  box.hidden = false;
  const input = box.querySelector('#d-sq');
  input.addEventListener('input', () => { search.q = input.value; history(); results(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { ctx.state.searchHistory = remember(ctx.state.searchHistory, search.q); ctx.save(); input.blur(); }
    if (e.key === 'Escape') close();
  });
  box.querySelector('[data-sclose]').addEventListener('click', close);
  // The filter chips here change the same filters as on the map.
  const bar = box.querySelector('.map-filters');
  const rebindBar = () => {
    bar.querySelectorAll('[data-quick-filter]').forEach((b) => b.addEventListener('click', () => {
      QUICK.find(([k]) => k === b.dataset.quickFilter)[3](ui.filters);
      bar.innerHTML = filterBarHtml();
      rebindBar();
      results();
      update(root, ctx);
    }));
    bar.querySelector('[data-fopen]').addEventListener('click', () => openSheet(root, ctx));
  };
  rebindBar();
  history();
  results();
  input.focus();
}

// The Filters sheet: chips by group, a live count, Reset and Apply.
function sheetHtml(ctx) {
  const f = draft;
  const chips = (group, opts) => `<div class="fchips">${opts.map(([v, l]) => `<button type="button" data-fgroup="${group}" data-fval="${esc(String(v))}" aria-pressed="${f[group].includes(v)}">${l}</button>`).join('')}</div>`;
  const toggle = (key, l) => `<button type="button" data-ftoggle="${key}" aria-pressed="${f[key]}">${l}</button>`;
  const brands = [...new Set(ctx.world.chargers.map((c) => c.operator))].sort();
  const shown = ctx.world.chargers.filter((c) => passesFilter(c, ctx, f)).length;
  return `<section class="fsheet" role="dialog" aria-modal="true" aria-labelledby="d-ftitle">
    <header><button type="button" class="round" data-fclose aria-label="Close filters">${IC.close}</button><h2 id="d-ftitle" tabindex="-1">Filters</h2>
      <button type="button" class="round primary" data-fapply aria-label="Apply filters">${IC.check}</button></header>
    <h3>Charger type</h3>${chips('types', [['ac', 'AC'], ['dc', 'DC'], ['fast', `Fast DC (${FAST_KW} kW+)`]])}
    <h3>Plug</h3>${chips('plugs', [['CCS2', 'CCS2'], ['Type2', 'Type 2'], ['CHAdeMO', 'CHAdeMO']])}
    <h3>Right now</h3><div class="fchips">${toggle('available', 'Available now')}${toggle('condoShared', 'Condo bays shared now')}</div>
    <h3>Brands</h3>${chips('brands', brands.map((b) => [b, `${brandMark(b)}${esc(b)}`]))}
    <h3>Price</h3><div class="fchips">${PRICE_CAPS.map(([v, l]) => `<button type="button" data-fprice="${v ?? ''}" aria-pressed="${f.maxPrice === v}">${l}</button>`).join('')}</div>
    <h3>Promotions</h3><div class="fchips">${toggle('promo', 'Off-peak and early-bird prices')}</div>
    <footer><button type="button" class="btn" data-freset>Reset</button><button type="button" class="btn primary grow" data-fapply>Show ${shown} charger${shown === 1 ? '' : 's'}</button></footer>
  </section>`;
}

function openSheet(root, ctx) {
  draft = structuredClone(ui.filters);
  const back = root.querySelector('#d-fsheet');
  const opener = root.querySelector('[data-fopen]');
  const close = (apply) => {
    if (apply) ui.filters = draft;
    draft = null;
    back.hidden = true;
    back.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    const bar = root.querySelector('.map-filters');
    bar.innerHTML = filterBarHtml();
    bindFilterBar(root, ctx);
    if (apply) update(root, ctx);
    if (search.open) { openSearch(root, ctx); return; }
    root.querySelector('[data-fopen]')?.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(false); };
  const draw = (focus) => {
    back.innerHTML = sheetHtml(ctx);
    if (focus) back.querySelector(focus)?.focus();
    back.querySelectorAll('[data-fgroup]').forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.fgroup;
      const v = b.dataset.fval;
      draft[g] = draft[g].includes(v) ? draft[g].filter((x) => x !== v) : [...draft[g], v];
      draw(`[data-fgroup="${g}"][data-fval="${CSS.escape(v)}"]`);
    }));
    back.querySelectorAll('[data-ftoggle]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.ftoggle; draft[k] = !draft[k]; draw(`[data-ftoggle="${k}"]`); }));
    back.querySelectorAll('[data-fprice]').forEach((b) => b.addEventListener('click', () => { const v = b.dataset.fprice; draft.maxPrice = v === '' ? null : Number(v); draw(`[data-fprice="${v}"]`); }));
    back.querySelector('[data-freset]').addEventListener('click', () => { draft = emptyFilters(); draw('[data-freset]'); });
    back.querySelectorAll('[data-fapply]').forEach((b) => b.addEventListener('click', () => close(true)));
    back.querySelector('[data-fclose]').addEventListener('click', () => close(false));
  };
  back.hidden = false;
  draw();
  back.addEventListener('click', (e) => { if (e.target === back) close(false); }, { once: false });
  document.addEventListener('keydown', onKey);
  back.querySelector('#d-ftitle').focus();
  void opener;
}

function drawMarkers(root, ctx, origin, r, car) {
  if (!map) return;
  layer.clearLayers();
  markers = new Map();
  const top = new Set(r.results.slice(0, 3).map((c) => c.charger.id));
  const off = new Map(r.excluded.map((x) => [x.charger.id, x.reason]));
  const byId = new Map(r.results.map((c) => [c.charger.id, c]));
  for (const ch of ctx.world.chargers) {
    if (!passesFilter(ch, ctx)) continue;
    const condo = ctx.world.condos.find((c) => c.id === ch.condoId) || null;
    const isRes = !!condo && condo.id === ui.homeId;
    const res = byId.get(ch.id);
    const price = res ? res.price : priceAt(ch, ctx.clock, condo, isRes);
    const occ = res ? res.occupancy : occupancyAt(ch, ctx.clock, condo).total;
    const faulty = ch.reliability < 0.75;
    const cls = faulty ? 'busy' : top.has(ch.id) ? 'pick' : off.has(ch.id) ? 'off' : occ >= 0.8 ? 'busy' : 'ok';
    const shared = condo && !isRes && isOpenToVisitors(condo, ctx.clock) ? '<b class="tag">Shared now</b>' : '';
    const html = `<span class="pin ${cls}">${ch.type === 'DC' ? IC.bolt : ''}${rm(price)}${shared}</span>`;
    const marker = L.marker([ch.lat, ch.lng], { icon: L.divIcon({ html: html.replace('class="pin ', `class="pin ${ui.selected === ch.id ? 'sel ' : ''}`), className: 'pin-wrap', iconSize: null }), title: ch.name })
      .bindPopup(popupHtml(ch, price, !!shared), { maxWidth: 260 }).addTo(layer);
    marker.on('click', () => { if (matchMedia('(max-width: 760px)').matches) marker.closePopup(); select(root, ctx, ch.id, false); });
    marker.on('popupopen', (e) => {
      e.popup.getElement()?.querySelector('[data-detail]')?.addEventListener('click', () => select(root, ctx, ch.id, false));
    });
    markers.set(ch.id, marker);
  }
  L.circleMarker([origin.lat, origin.lng], { radius: 8, className: 'me' }).bindTooltip('You are here').addTo(layer);
}

// ---- Charger details (PlugShare-style): popup on the map + a panel beside it ----

function select(root, ctx, id, fromList) {
  ui.selected = id;
  if (tab !== 'map' && tab !== 'plan') { location.hash = '#map'; return; }
  if (!last) return;
  renderDetail(root, ctx, last.ranking, last.car);
  if (fromList && map) {
    const m = markers.get(id);
    if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); m.openPopup(); }
    root.querySelector('#d-map-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function focusSelected() {
  const m = markers.get(ui.selected);
  if (m && map) {
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 15));
    if (!matchMedia('(max-width: 760px)').matches) m.openPopup(); // phones use the bottom sheet
  }
}

function renderDetail(root, ctx, ranking, car) {
  const aside = root.querySelector('#d-detail');
  const row = root.querySelector('#d-map-row');
  if (!aside || !row) return;
  const ch = ui.selected ? ctx.world.chargers.find((x) => x.id === ui.selected) : null;
  const wasOpen = !aside.hidden;
  if (!ch) {
    ui.selected = null;
    aside.hidden = true;
    row.classList.remove('has-detail');
    if (wasOpen && map) map.invalidateSize();
    return;
  }
  const condo = ctx.world.condos.find((c) => c.id === ch.condoId) || null;
  const checkins = (ctx.checkins || ctx.state.checkins)[ch.id] || [];
  const d = describeCharger({ charger: ch, ranking, condo, date: ctx.clock, isResident: !!condo && condo.id === ui.homeId, checkins });
  const cand = ranking.results.find((c) => c.charger.id === ch.id);
  const start = originPoint();
  const rd = distanceKm(start, ch) >= 0.2 ? road([start, ch], { alternatives: tab === 'map' }) : null;
  const tr = typicalTraffic(ctx.clock);
  const r0 = rd?.routes?.[0];
  const byRoad = r0 ? `<p class="road-line-note">${IC.route}<span><b>${formatDuration(r0.live ? r0.minutes : r0.minutes * tr.factor)}</b> · ${r0.km} km by road · ${r0.live ? (r0.delayMin ? `live traffic +${r0.delayMin} min` : 'live traffic: clear') : `typical traffic ${tr.level.toLowerCase()}`}</span></p>` : '';
  const liveBays = ch.liveAvail ? `<p class="road-line-note live-bays"><span class="live-dot"></span><span><b>Live: ${ch.liveAvail.available} of ${ch.liveAvail.total} free</b>${ch.liveAvail.outOfService ? ` · ${ch.liveAvail.outOfService} out of service` : ''} · TomTom, ${ch.liveAt ? esc(fmtClock(new Date(ch.liveAt))) : 'now'}${ch.liveOcc == null ? '. Set the demo time to "Right now" to rank with it.' : ''}</span></p>` : '';
  aside.innerHTML = detailHtml(d, liveBays + byRoad + (cand ? timingLine(cand, ctx, cand.full ? cand.kWh : cand.deliveredKwh) : ''));
  aside.hidden = false;
  row.classList.add('has-detail');
  if (!wasOpen && map) map.invalidateSize();
  aside.querySelector('[data-close]').addEventListener('click', () => { ui.selected = null; renderDetail(root, ctx, ranking, car); });
  const bookBtn = aside.querySelector('[data-detail-book]');
  if (bookBtn) bookBtn.addEventListener('click', () => {
    startBooking(root, ctx, ranking, car, d.id);
    root.querySelector('#d-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function detailHtml(d, timing = '') {
  const specs = [d.operator, `${d.type} ${d.kw} kW`, d.connectors.join(', '), `${d.bays} bay${d.bays === 1 ? '' : 's'}`];
  if (d.pilot) specs.push('Pilot condo (simulated)');
  if (d.faultBays) specs.push(`${d.faultBays} bay${d.faultBays === 1 ? '' : 's'} out of service`);
  const notes = [d.priceNote, d.access].filter(Boolean);
  const checkins = d.recentCheckins.length
    ? `<ul class="checkins">${d.recentCheckins.map((c) => `<li><span class="chip ${c.ok ? 'on' : 'warn'}">${c.ok ? 'Worked' : 'Problem'}</span> ${esc(fmtTime(new Date(c.at)))}${c.note ? ` · ${esc(c.note)}` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">No check-ins yet. Be the first after you charge.</p>';
  return `
    <div class="detail-sizes" role="group" aria-label="Charger detail panel size"><button type="button" data-detail-size="compact" aria-pressed="false">Compact</button><button type="button" data-detail-size="medium" aria-pressed="true">Browse</button><button type="button" data-detail-size="expanded" aria-pressed="false">Expand</button></div>
    <div class="detail-head"><h3>${brandMark(d.operator)}${esc(d.name)}</h3>
      <button class="btn small" type="button" data-close aria-label="Close details">Close</button></div>
    ${d.address ? `<p class="muted">${esc(d.address)}</p>` : ''}
    <p class="muted">${specs.map(esc).join(' · ')}</p>
    <p class="verdict ${d.bookable ? 'ok' : 'off'}">${esc(d.verdict)}</p>
    <dl class="stats">
      <div><dt>Reliability</dt><dd>${d.reliabilityPct}%</dd></div>
      <div><dt>Price now</dt><dd>${rm(d.priceNow)}${d.priceEstimated ? ' est.' : ''}</dd></div>
      <div><dt>Busy now</dt><dd>${d.occupancyPct}%</dd></div>
      <div><dt>Wait</dt><dd>${d.waitMin ? `~${d.waitMin} min` : 'None'}</dd></div>
    </dl>
    ${notes.length ? `<p class="muted">${notes.map(esc).join(' · ')}</p>` : ''}
    ${d.live ? `<p class="live-line"><span class="dot"></span>Live from the chargers (OCPP): ${d.live.charging} charging · ${d.live.available} free${d.live.faulted ? ` · ${d.live.faulted} faulted` : ''}${d.live.offline ? ` · ${d.live.offline} offline` : ''}</p>` : ''}
    ${timing}
    ${d.reasons.length ? `<h4>For your trip</h4><ul class="reasons">${d.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <h4>Recent check-ins (${d.checkinCount})</h4>
    ${checkins}
    <div class="btn-row">
      ${d.bookable && ui.stage === 'pick' ? `<button class="btn primary" type="button" data-detail-book="${esc(d.id)}">Book this bay</button>` : ''}
      <a class="btn" href="${esc(d.directionsUrl)}" target="_blank" rel="noopener">Directions</a>
    </div>`;
}

function popupHtml(ch, price, shared) {
  return `<div class="pop"><b>${esc(ch.name)}</b><br>${esc(ch.operator)} · ${ch.type} ${ch.kw} kW<br>${esc(ch.connectors.join(', '))} · ${rm(price)}/kWh${ch.priceEstimated ? ' (est.)' : ''}${shared ? '<br><b>Shared now</b>' : ''}
    <br><button class="btn small" type="button" data-detail="${esc(ch.id)}">Details</button></div>`;
}

function qrSvg(seed) {
  let h = 7;
  for (const ch of seed) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  let cells = '';
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      const ring = finder && (x % 14 === 0 || y % 14 === 0 || x % 14 === 6 || y % 14 === 6 || (x % 14 >= 2 && x % 14 <= 4 && y % 14 >= 2 && y % 14 <= 4));
      h = (h * 1103515245 + 12345) >>> 0;
      if (finder ? ring : (h >> 16) & 1) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  return `<svg class="qr" viewBox="0 0 21 21" role="img" aria-label="Booking QR code">${cells}</svg>`;
}
