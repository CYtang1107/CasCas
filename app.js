import { APP } from './config.js';
import { CLOCK_PRESETS } from './data/places.js';
import { CONDOS } from './data/condos.js';
import { loadChargers } from './data/ocm.js';
import { createApi, detectServer } from './data/api.js';
import { loadState, saveState, resetState } from './state.js';
import { buildWorld } from './engine/world.js';
import { purgePasses } from './engine/access.js';
import { faultBays } from './engine/maintenance.js';
import { renderDriver, resetDriver } from './views/driver.js';
import { renderJmb } from './views/jmb.js';

const tabView = (name) => (root, ctx) => renderDriver(root, ctx, name);
// Two front doors: index.html is the driver app, jmb.html the JMB portal (body data-app="jmb").
const PORTAL = document.body.dataset.app === 'jmb';
const VIEWS = PORTAL ? { jmb: renderJmb } : { home: tabView('home'), map: tabView('map'), plan: tabView('plan'), activity: tabView('activity') };
let state = loadState();
state.visitorPasses = purgePasses(state.visitorPasses, Date.now());
saveState(state);
let clock = CLOCK_PRESETS[0].date();
let chargers = null; // set once chargers are loaded
let api = null; // set in shared mode (a CasCas server answered)
let shared = { sharing: {}, checkins: {}, activeBays: {}, faultBays: {}, live: {} };

// Bays the JMB logged as faulty (and not yet repaired) count as taken for drivers.
function localFaultBays() {
  const out = {};
  for (const c of CONDOS) {
    const n = faultBays(state.maintenance[c.id] || [], c.bays);
    if (n) out[`cs-${c.id}`] = n;
  }
  return out;
}

function currentRole() {
  if (PORTAL) return 'jmb';
  const id = location.hash.slice(1);
  if (id === 'jmb') { location.replace('jmb.html'); return 'home'; } // old #jmb links go to the portal
  return VIEWS[id] ? id : 'home'; // old #driver links land on Home
}

function render() {
  const role = currentRole();
  document.querySelectorAll('[data-role]').forEach((a) => {
    if (a.dataset.role === role) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const view = document.getElementById('view');
  if (!chargers) { view.innerHTML = '<p class="loading">Loading chargers…</p>'; return; }
  // Shared mode: sharing settings, check-ins and booked bays come from the server.
  const worldState = api ? { ...state, sharing: shared.sharing, checkins: shared.checkins } : state;
  const faults = api ? shared.faultBays || {} : localFaultBays();
  const list = chargers.map((ch) => {
    const fault = faults[ch.id] || 0;
    const booked = api ? shared.activeBays[ch.id] || 0 : 0;
    const live = api ? shared.live?.[ch.id] || null : null;
    return fault || booked || live ? { ...ch, bookedBays: booked + fault, faultBays: fault, live } : ch;
  });
  const ctx = { state, clock, api, checkins: worldState.checkins, world: buildWorld(worldState, CONDOS, list), save: () => saveState(state), rerender: render, refresh };
  VIEWS[role](view, ctx);
}

// Shared mode: fetch the shared world for the demo clock, then draw. Falls back to local mode if the server is gone.
async function refresh() {
  if (api) {
    const r = await api.world(clock.getTime());
    if (r.ok) shared = r.data;
    else { api = null; showMode('This device only (server unavailable)'); }
  }
  render();
}

function showSource({ source, ageDays }) {
  const el = document.getElementById('data-source');
  const credit = ' · Data © <a href="https://openchargemap.org" target="_blank" rel="noopener">Open Charge Map</a> contributors';
  if (source === 'live') el.innerHTML = `Chargers: live from Open Charge Map${credit}`;
  else if (source === 'saved') el.innerHTML = `Chargers: saved copy, ${ageDays} day${ageDays === 1 ? '' : 's'} old${credit}`;
  else el.textContent = 'Chargers: demo data';
}

function showMode(text) {
  document.getElementById('data-mode').textContent = text;
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initChrome() {
  document.title = PORTAL ? `${APP.name} JMB portal · ${APP.township}` : `${APP.name} · ${APP.township}`;
  document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = APP.name; });
  const tagline = document.querySelector('[data-tagline]');
  if (tagline) tagline.textContent = APP.tagline;

  const preset = document.getElementById('clock-preset');
  const custom = document.getElementById('clock-custom');
  preset.innerHTML = CLOCK_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')
    + '<option value="custom">Pick a time…</option>';
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') { custom.hidden = false; custom.value = toLocalInput(clock); custom.focus(); return; }
    custom.hidden = true;
    clock = CLOCK_PRESETS.find((p) => p.id === preset.value).date();
    refresh();
  });
  custom.addEventListener('change', () => {
    const d = new Date(custom.value);
    if (!Number.isNaN(d.getTime())) { clock = d; refresh(); }
  });
  document.getElementById('reset').addEventListener('click', () => {
    state = resetState();
    resetDriver();
    render();
  });
  window.addEventListener('hashchange', render);
}

async function start() {
  initChrome();
  render();
  const candidate = createApi();
  if (await detectServer(candidate)) {
    api = candidate;
    const r = await api.chargers();
    const loaded = r.ok ? r.data : await loadChargers();
    chargers = loaded.chargers;
    showSource(loaded);
    showMode('Shared demo: bookings are visible to everyone');
    await refresh();
  } else {
    const loaded = await loadChargers();
    chargers = loaded.chargers;
    showSource(loaded);
    showMode('This device only');
    render();
  }
}

start();
