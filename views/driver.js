import { CONST } from '../config.js';
import { CARS } from '../data/cars.js';
import { PLACES, START } from '../data/places.js';
import { rankChargers, MODES, formatDuration } from '../engine/score.js';
import { priceAt } from '../engine/pricing.js';
import { isOpenToVisitors } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';
import { esc, rm, fmtTime } from './format.js';

const NEED = [['now', 'Now'], ['2h', 'Within 2 h'], ['overnight', 'Overnight']];
const fresh = () => ({ carId: 'emas7', battery: 35, placeId: 'klem', homeId: '', needBy: 'now', stage: 'pick', pick: null, flash: '' });
let ui = fresh();
let map = null;
let layer = null;
let timer = null;

export function resetDriver() {
  stopTimer();
  ui = fresh();
}

export function renderDriver(root, ctx) {
  stopTimer();
  if (map) { map.remove(); map = null; }
  const { condos } = ctx.world;
  root.innerHTML = `
  <div class="driver">
    <section class="panel trip" aria-label="Trip">
      <h2>Plan a charge</h2>
      <label class="field">Car
        <select id="d-car">${CARS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field">Battery now <output id="d-batt-out"></output>
        <input id="d-batt" type="range" min="5" max="100" step="1"></label>
      <label class="field">Going to
        <select id="d-place">${PLACES.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">I live at
        <select id="d-home"><option value="">Not a resident here</option>${condos.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <fieldset class="field seg"><legend>Need the car</legend>
        ${NEED.map(([v, l]) => `<label><input type="radio" name="d-need" value="${v}"> ${l}</label>`).join('')}
      </fieldset>
      <p class="muted">Demo time: ${esc(fmtTime(ctx.clock))}. Change it at the top to see prices and sharing change.</p>
    </section>
    <section class="map-wrap">
      <div id="d-map" class="map" aria-label="Map of chargers around KL East"></div>
      <p id="d-map-fallback" class="notice" hidden>The map could not load. The list of picks still works.</p>
    </section>
    <section class="panel results" id="d-results" aria-live="polite"></section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  $('#d-car').value = ui.carId;
  $('#d-batt').value = ui.battery;
  $('#d-place').value = ui.placeId;
  $('#d-home').value = ui.homeId;
  $(`input[name="d-need"][value="${ui.needBy}"]`).checked = true;

  $('#d-car').addEventListener('change', (e) => { ui.carId = e.target.value; update(root, ctx); });
  $('#d-batt').addEventListener('input', (e) => { ui.battery = Number(e.target.value); update(root, ctx); });
  $('#d-place').addEventListener('change', (e) => { ui.placeId = e.target.value; update(root, ctx); });
  $('#d-home').addEventListener('change', (e) => { ui.homeId = e.target.value; update(root, ctx); });
  root.querySelectorAll('input[name="d-need"]').forEach((r) => r.addEventListener('change', (e) => { ui.needBy = e.target.value; update(root, ctx); }));

  initMap($('#d-map'), $('#d-map-fallback'));
  update(root, ctx);
  if (ui.stage === 'charging') startTimer(root, ctx);
}

function compute(ctx) {
  const car = CARS.find((c) => c.id === ui.carId);
  const home = ctx.world.condos.find((c) => c.id === ui.homeId) || null;
  const origin = home ? { lat: home.lat, lng: home.lng } : START;
  const place = PLACES.find((p) => p.id === ui.placeId);
  const destination = place.id === 'here' ? null : place;
  const ranking = rankChargers({
    ...ctx.world, car, batteryPct: ui.battery, origin, destination, date: ctx.clock,
    residentCondoId: ui.homeId || null, needBy: ui.needBy,
  });
  return { car, origin, ranking };
}

function update(root, ctx) {
  const { car, origin, ranking } = compute(ctx);
  root.querySelector('#d-batt-out').textContent = `${ui.battery}%`;
  drawMarkers(ctx, origin, ranking);
  const box = root.querySelector('#d-results');
  box.innerHTML = ui.stage === 'pick' ? pickHtml(ranking, ctx) : stageHtml(ctx);
  bind(root, ctx, ranking, car);
}

function modeLine(mode) {
  if (mode === 'urgent') return 'Low battery, so the quickest working charge comes first';
  if (mode === 'saver') return 'Plenty of charge, so cheaper and quieter chargers come first';
  return 'Balancing price, time and reliability';
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
    return `${head}<p class="empty">No charger is in range at ${ui.battery}%.${hint} Call your roadside assistance for a mobile charge.</p>`;
  }
  const note = r.balanceNote ? `<p class="balance"><b>Demand balancing.</b> ${esc(r.balanceNote)}</p>` : '';
  const cards = top.map((c, i) => `
    <article class="pick ${i === 0 ? 'first' : ''}">
      <div class="pick-top"><span class="rank">${i + 1}</span>
        <div><h3>${esc(c.charger.name)}</h3>
        <p class="muted">${esc(c.charger.operator)} · ${c.charger.type} ${c.charger.kw} kW · ${rm(c.price)}/kWh</p></div></div>
      <ul class="reasons">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <button class="btn ${i === 0 ? 'primary' : ''}" type="button" data-book="${c.charger.id}">Book this bay</button>
    </article>`).join('');
  const off = r.excluded.length
    ? `<details class="excluded"><summary>${r.excluded.length} chargers not suitable right now</summary><ul>${r.excluded.map((x) => `<li>${esc(x.charger.name)}: ${esc(x.reason)}</li>`).join('')}</ul></details>`
    : '';
  return head + note + cards + off;
}

function stageHtml(ctx) {
  const p = ui.pick;
  if (ui.stage === 'booked') {
    const until = new Date(p.bookedAt + CONST.holdMinutes * 60000);
    return `<h2>Bay held</h2>
      <p><b>${esc(p.name)}</b> is held for you for ${CONST.holdMinutes} minutes, until ${esc(fmtTime(until))}.</p>
      ${qrSvg(p.chargerId)}
      <p class="muted">At the bay, scan the QR code on the charger to start.</p>
      <div class="btn-row"><button class="btn primary" type="button" data-act="start">Scan QR and start charging</button>
      <button class="btn" type="button" data-act="cancel">Cancel booking</button></div>`;
  }
  if (ui.stage === 'charging') {
    const s = p.session;
    const battery = Math.min(100, p.startPct + (s.kWh / p.batteryKwh) * 100);
    return `<h2>Charging at ${esc(p.name)}</h2>
      <div class="meter" role="progressbar" aria-valuenow="${Math.round(battery)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${battery}%"></span></div>
      <dl class="stats">
        <div><dt>Battery</dt><dd>${Math.round(battery)}%</dd></div>
        <div><dt>Energy</dt><dd>${s.kWh.toFixed(1)} kWh</dd></div>
        <div><dt>Cost so far</dt><dd>${rm(s.kWh * p.price)}</dd></div>
        <div><dt>Time</dt><dd>${formatDuration(s.minutes)}</dd></div>
      </dl>
      <p class="muted">Demo speed: 1 second = 1 minute of charging.</p>
      <button class="btn" type="button" data-act="stop">Stop charging</button>`;
  }
  const s = p.session;
  return `<h2>How did it go?</h2>
    <p>${s.kWh.toFixed(1)} kWh for <b>${rm(s.kWh * p.price)}</b> at ${esc(p.name)}.</p>
    <label class="field">Note (optional) <input id="d-note" type="text" maxlength="120" placeholder="e.g. cable damaged on bay 3"></label>
    <div class="btn-row"><button class="btn primary" type="button" data-act="ok">It worked</button>
    <button class="btn" type="button" data-act="problem">Report a problem</button></div>
    <p class="muted">Your check-in updates this charger's reliability for every driver.</p>`;
}

function bind(root, ctx, ranking, car) {
  const box = root.querySelector('#d-results');
  box.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => {
    const c = ranking.results.find((x) => x.charger.id === btn.dataset.book);
    const power = c.charger.type === 'DC' ? Math.min(c.charger.kw, car.dcKw) : Math.min(c.charger.kw, car.acKw);
    ui.pick = {
      chargerId: c.charger.id, name: c.charger.name, price: c.price, kWhTarget: c.kWh, power,
      batteryKwh: car.batteryKwh, startPct: ui.battery, bookedAt: ctx.clock.getTime(),
      session: { kWh: 0, minutes: 0 },
    };
    ui.stage = 'booked';
    ui.flash = '';
    ctx.state.booking = { chargerId: c.charger.id, at: ctx.clock.getTime() };
    ctx.save();
    update(root, ctx);
  }));
  const act = (name, fn) => { const b = box.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', fn); };
  act('start', () => { ui.stage = 'charging'; update(root, ctx); startTimer(root, ctx); });
  act('cancel', () => { ui.stage = 'pick'; ui.pick = null; ctx.state.booking = null; ctx.save(); update(root, ctx); });
  act('stop', () => { stopTimer(); ui.stage = 'done'; update(root, ctx); });
  const checkin = (ok) => {
    const note = (box.querySelector('#d-note')?.value || '').trim();
    const list = ctx.state.checkins[ui.pick.chargerId] || [];
    ctx.state.checkins[ui.pick.chargerId] = [...list, { ok, note, at: ctx.clock.getTime() }];
    ctx.state.booking = null;
    ctx.save();
    ui.flash = ok ? 'Thanks. Your check-in raised this charger\'s reliability score.' : 'Thanks. The JMB and operator can now see this problem.';
    ui.stage = 'pick';
    ui.pick = null;
    ctx.rerender();
  };
  act('ok', () => checkin(true));
  act('problem', () => checkin(false));
}

function startTimer(root, ctx) {
  stopTimer();
  timer = setInterval(() => {
    const p = ui.pick;
    if (!p || ui.stage !== 'charging') { stopTimer(); return; }
    p.session.minutes += 1;
    p.session.kWh = Math.min(p.kWhTarget, p.session.kWh + p.power / 60);
    if (p.session.kWh >= p.kWhTarget) { stopTimer(); ui.stage = 'done'; }
    const box = root.querySelector('#d-results');
    if (!box) { stopTimer(); return; }
    update(root, ctx);
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function initMap(el, fallback) {
  if (!window.L) { el.hidden = true; fallback.hidden = false; return; }
  map = L.map(el, { scrollWheelZoom: true }).setView([3.2135, 101.7265], 14);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  tiles.on('tileerror', () => { fallback.hidden = false; });
  layer = L.layerGroup().addTo(map);
}

function drawMarkers(ctx, origin, r) {
  if (!map) return;
  layer.clearLayers();
  const top = new Set(r.results.slice(0, 3).map((c) => c.charger.id));
  const off = new Map(r.excluded.map((x) => [x.charger.id, x.reason]));
  const byId = new Map(r.results.map((c) => [c.charger.id, c]));
  for (const ch of ctx.world.chargers) {
    const condo = ctx.world.condos.find((c) => c.id === ch.condoId) || null;
    const isRes = !!condo && condo.id === ui.homeId;
    const res = byId.get(ch.id);
    const price = res ? res.price : priceAt(ch, ctx.clock, condo, isRes);
    const occ = res ? res.occupancy : occupancyAt(ch, ctx.clock, condo).total;
    const cls = top.has(ch.id) ? 'pick' : off.has(ch.id) ? 'off' : (occ >= 0.8 || ch.reliability < 0.75) ? 'busy' : 'ok';
    const shared = condo && !isRes && isOpenToVisitors(condo, ctx.clock) ? '<b class="tag">Shared now</b>' : '';
    const html = `<span class="pin ${cls}">${ch.type === 'DC' ? '⚡' : ''}${rm(price)}${shared}</span>`;
    const tip = `${esc(ch.name)}<br>${esc(ch.operator)} · ${ch.type} ${ch.kw} kW · ${Math.round(occ * 100)}% busy${off.has(ch.id) ? `<br>${esc(off.get(ch.id))}` : ''}`;
    L.marker([ch.lat, ch.lng], { icon: L.divIcon({ html, className: 'pin-wrap', iconSize: null }) }).bindTooltip(tip).addTo(layer);
  }
  L.circleMarker([origin.lat, origin.lng], { radius: 8, className: 'me' }).bindTooltip('You are here').addTo(layer);
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
