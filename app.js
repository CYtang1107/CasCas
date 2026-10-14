import { APP } from './config.js';
import { CLOCK_PRESETS } from './data/places.js';
import { CONDOS } from './data/condos.js';
import { loadChargers } from './data/ocm.js';
import { loadState, saveState, resetState } from './state.js';
import { buildWorld } from './engine/world.js';
import { purgePasses } from './engine/access.js';
import { renderDriver, resetDriver } from './views/driver.js';
import { renderJmb } from './views/jmb.js';

const VIEWS = { driver: renderDriver, jmb: renderJmb };
let state = loadState();
state.visitorPasses = purgePasses(state.visitorPasses, Date.now());
saveState(state);
let clock = CLOCK_PRESETS[0].date();
let chargers = null; // set once loadChargers() finishes

function currentRole() {
  const id = location.hash.slice(1);
  return VIEWS[id] ? id : 'driver';
}

function render() {
  const role = currentRole();
  document.querySelectorAll('[data-role]').forEach((a) => {
    if (a.dataset.role === role) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const view = document.getElementById('view');
  if (!chargers) { view.innerHTML = '<p class="loading">Loading chargers…</p>'; return; }
  const ctx = { state, clock, world: buildWorld(state, CONDOS, chargers), save: () => saveState(state), rerender: render };
  VIEWS[role](view, ctx);
}

function showSource({ source, ageDays }) {
  const el = document.getElementById('data-source');
  const credit = ' · Data © <a href="https://openchargemap.org" target="_blank" rel="noopener">Open Charge Map</a> contributors';
  if (source === 'live') el.innerHTML = `Chargers: live from Open Charge Map${credit}`;
  else if (source === 'saved') el.innerHTML = `Chargers: saved copy, ${ageDays} day${ageDays === 1 ? '' : 's'} old${credit}`;
  else el.textContent = 'Chargers: demo data';
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initChrome() {
  document.title = `${APP.name} · ${APP.township}`;
  document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = APP.name; });
  document.querySelector('[data-tagline]').textContent = APP.tagline;

  const preset = document.getElementById('clock-preset');
  const custom = document.getElementById('clock-custom');
  preset.innerHTML = CLOCK_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')
    + '<option value="custom">Pick a time…</option>';
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') { custom.hidden = false; custom.value = toLocalInput(clock); custom.focus(); return; }
    custom.hidden = true;
    clock = CLOCK_PRESETS.find((p) => p.id === preset.value).date();
    render();
  });
  custom.addEventListener('change', () => {
    const d = new Date(custom.value);
    if (!Number.isNaN(d.getTime())) { clock = d; render(); }
  });
  document.getElementById('reset').addEventListener('click', () => {
    state = resetState();
    resetDriver();
    render();
  });
  window.addEventListener('hashchange', render);
}

initChrome();
render();
loadChargers().then((r) => {
  chargers = r.chargers;
  showSource(r);
  render();
});
