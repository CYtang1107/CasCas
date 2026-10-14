import { CONST } from '../config.js';
import { CARS } from '../data/cars.js';
import { PLACES, START } from '../data/places.js';
import { rankChargers, MODES, formatDuration } from '../engine/score.js';
import { priceAt } from '../engine/pricing.js';
import { isOpenToVisitors } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';
import { buildSession } from '../engine/insights.js';
import { normalisePlate, isValidPlate, formatPlate, canAutoApprove, createPass } from '../engine/access.js';
import { addSession, anonNumber } from '../state.js';
import { esc, rm, fmtTime, fmtClock } from './format.js';

const PARK_OPTIONS = [['30m', '30 min'], ['2h', '2 h'], ['4h', '4 h'], ['overnight', 'Overnight']];
const fresh = () => ({ carId: 'emas7', battery: 35, placeId: 'klem', homeId: '', parkFor: '30m', stage: 'pick', pick: null, flash: '', pending: null, plate: '' });
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
      <fieldset class="field seg"><legend>How long will you park?</legend>
        ${PARK_OPTIONS.map(([v, l]) => `<label><input type="radio" name="d-park" value="${v}"> ${l}</label>`).join('')}
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
  $(`input[name="d-park"][value="${ui.parkFor}"]`).checked = true;

  $('#d-car').addEventListener('change', (e) => { ui.carId = e.target.value; update(root, ctx); });
  $('#d-batt').addEventListener('input', (e) => { ui.battery = Number(e.target.value); update(root, ctx); });
  $('#d-place').addEventListener('change', (e) => { ui.placeId = e.target.value; update(root, ctx); });
  $('#d-home').addEventListener('change', (e) => { ui.homeId = e.target.value; update(root, ctx); });
  root.querySelectorAll('input[name="d-park"]').forEach((r) => r.addEventListener('change', (e) => { ui.parkFor = e.target.value; update(root, ctx); }));

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
    residentCondoId: ui.homeId || null, parkFor: ui.parkFor,
  });
  return { car, origin, ranking };
}

function update(root, ctx) {
  const { car, origin, ranking } = compute(ctx);
  root.querySelector('#d-batt-out').textContent = `${ui.battery}%`;
  drawMarkers(ctx, origin, ranking);
  const box = root.querySelector('#d-results');
  box.innerHTML = ui.stage === 'pick' ? pickHtml(ranking, ctx) : stageHtml(ctx, ranking);
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
        <p class="muted">${esc(c.charger.operator)} · ${c.charger.type} ${c.charger.kw} kW · ${rm(c.price)}/kWh${c.charger.priceEstimated ? ' (est.)' : ''}</p></div></div>
      <ul class="reasons">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <button class="btn ${i === 0 ? 'primary' : ''}" type="button" data-book="${c.charger.id}">Book this bay</button>
    </article>`).join('');
  const off = r.excluded.length
    ? `<details class="excluded"><summary>${r.excluded.length} chargers not suitable right now</summary><ul>${r.excluded.map((x) => `<li>${esc(x.charger.name)}: ${esc(x.reason)}</li>`).join('')}</ul></details>`
    : '';
  const rest = r.results.slice(3);
  const more = rest.length
    ? `<details class="more"><summary>Choose another charger (${rest.length})</summary><ul>${rest.map((c) => `<li><span>${esc(c.charger.name)} · ${rm(c.price)}/kWh · ${c.km.toFixed(1)} km</span> <button class="btn small" type="button" data-book="${c.charger.id}">Book</button></li>`).join('')}</ul></details>`
    : '';
  return head + note + cards + more + off;
}

function stageHtml(ctx, r) {
  const p = ui.pick;
  if (ui.stage === 'plate') {
    const c = r.results.find((x) => x.charger.id === ui.pending);
    return `<h2>Visitor details</h2>
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
    return `<h2>Bay held</h2>
      ${pass}
      <p class="saved">${esc(savingLine(p))}</p>
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

function savingLine(p) {
  if (p.saving >= 0.01) return `You saved ${rm(p.saving)} vs the nearest charger.`;
  if (p.minutesVsNearest < 0) return `${formatDuration(-p.minutesVsNearest)} faster than the nearest charger.`;
  return 'Same as the nearest charger.';
}

function bind(root, ctx, ranking, car) {
  const box = root.querySelector('#d-results');
  box.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => {
    const c = ranking.results.find((x) => x.charger.id === btn.dataset.book);
    if (!c) return;
    ui.flash = '';
    if (c.isSharedVisit) { ui.stage = 'plate'; ui.pending = c.charger.id; update(root, ctx); return; }
    book(ctx, ranking, c, car, null);
    update(root, ctx);
  }));
  const form = box.querySelector('#d-plate-form');
  if (form) {
    const input = form.querySelector('#d-plate');
    input.addEventListener('input', () => { ui.plate = input.value; });
    form.addEventListener('submit', (e) => { e.preventDefault(); confirmVisitor(root, ctx, ranking, car, form); });
  }
  const act = (name, fn) => { const b = box.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', fn); };
  act('back', () => { ui.stage = 'pick'; ui.pending = null; update(root, ctx); });
  act('start', () => { ui.stage = 'charging'; update(root, ctx); startTimer(root, ctx); });
  act('cancel', () => {
    if (ui.pick?.pass) ctx.state.visitorPasses = ctx.state.visitorPasses.filter((x) => x.id !== ui.pick.pass.id);
    ui.stage = 'pick'; ui.pick = null; ctx.state.booking = null; ctx.save(); update(root, ctx);
  });
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
  const pass = createPass({
    id: `pass-${ctx.clock.getTime()}-${c.charger.id}`, condoId: c.condo.id, chargerId: c.charger.id, plate,
    slotStart: c.arrival.getTime(), minutes: CONST.holdMinutes + c.chargeMin, now: ctx.clock.getTime(),
  });
  ui.pending = null;
  book(ctx, ranking, c, car, pass);
  update(root, ctx);
}

// Hold the bay, record the session (anonymous) and, for visitors, the plate pass.
function book(ctx, ranking, c, car, pass) {
  const power = c.charger.type === 'DC' ? Math.min(c.charger.kw, car.dcKw) : Math.min(c.charger.kw, car.acKw);
  const session = buildSession({
    ranking, chosenId: c.charger.id, at: ctx.clock.getTime(), anonNo: anonNumber(ctx.state), resident: !!ui.homeId,
  });
  addSession(ctx.state, session);
  if (pass) ctx.state.visitorPasses = [...ctx.state.visitorPasses, pass];
  ui.pick = {
    chargerId: c.charger.id, name: c.charger.name, price: c.price, kWhTarget: c.deliveredKwh, power,
    batteryKwh: car.batteryKwh, startPct: ui.battery, bookedAt: ctx.clock.getTime(),
    session: { kWh: 0, minutes: 0 }, pass,
    saving: session.nearestCostRm - session.costRm, minutesVsNearest: session.minutesVsNearest,
  };
  ui.stage = 'booked';
  ctx.state.booking = { chargerId: c.charger.id, at: ctx.clock.getTime() };
  ctx.save();
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
    const faulty = ch.reliability < 0.75;
    const cls = faulty ? 'busy' : top.has(ch.id) ? 'pick' : off.has(ch.id) ? 'off' : occ >= 0.8 ? 'busy' : 'ok';
    const shared = condo && !isRes && isOpenToVisitors(condo, ctx.clock) ? '<b class="tag">Shared now</b>' : '';
    const html = `<span class="pin ${cls}">${ch.type === 'DC' ? '⚡' : ''}${rm(price)}${shared}</span>`;
    const tip = `${esc(ch.name)}<br>${esc(ch.operator)} · ${ch.type} ${ch.kw} kW · ${Math.round(occ * 100)}% busy (est.)${ch.pilot ? '<br>Pilot condo (simulated)' : ''}${off.has(ch.id) ? `<br>${esc(off.get(ch.id))}` : ''}`;
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
