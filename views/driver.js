import { CONST } from '../config.js';
import { CARS } from '../data/cars.js';
import { PLACES, START } from '../data/places.js';
import { rankChargers, MODES, formatDuration } from '../engine/score.js';
import { priceAt } from '../engine/pricing.js';
import { isOpenToVisitors } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';
import { buildSession } from '../engine/insights.js';
import { describeCharger, priceComparison } from '../engine/detail.js';
import { bestWindow } from '../engine/schedule.js';
import { parseRequest } from '../engine/assistant.js';
import { planTrip } from '../engine/trip.js';
import { TRIP_PLACES, HIGHWAY_CHARGERS } from '../data/trips.js';
import { normalisePlate, isValidPlate, formatPlate, canAutoApprove, createPass } from '../engine/access.js';
import { addSession, anonNumber } from '../state.js';
import { esc, rm, fmtTime, fmtClock } from './format.js';

const PARK_OPTIONS = [['30m', '30 min'], ['2h', '2 h'], ['4h', '4 h'], ['overnight', 'Overnight']];
const BUDGETS = [['', 'Any price'], ['0.9', 'Up to RM0.90/kWh'], ['1', 'Up to RM1.00/kWh'], ['1.2', 'Up to RM1.20/kWh'], ['1.5', 'Up to RM1.50/kWh']];
const OPERATORS = ['Gentari', 'ChargEV', 'JomCharge', 'Tesla'];
const noPrefs = () => ({ maxPrice: null, fastOnly: false, operator: null });
const ALL_PLACES = [...PLACES, ...TRIP_PLACES];
const placeOf = (id) => ALL_PLACES.find((p) => p.id === id) || PLACES[0];
const fresh = () => ({ carId: 'emas7', battery: 35, placeId: 'klem', homeId: '', parkFor: '30m', stage: 'pick', pick: null, flash: '', pending: null, plate: '', selected: null, prefs: noPrefs(), ask: '', askNote: '', arriveMin: 20 });
let ui = fresh();
let map = null;
let layer = null;
let timer = null;
let markers = new Map();
let last = null; // latest { ranking, car }, for the detail panel

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
      <form id="d-ask" class="ask" novalidate>
        <label class="field grow">Ask CasCas
          <input id="d-ask-text" type="text" maxlength="200" autocomplete="off" placeholder="e.g. Atto 3 at 71%, going to Melaka, arrive with 23%  ·  or: 20%, KL East Mall for 2 hours, under RM1.20" value="${esc(ui.ask)}"></label>
        <button class="btn primary" type="submit">Plan it</button>
      </form>
      ${ui.askNote ? `<p class="ask-note" role="status">${esc(ui.askNote)}</p>` : ''}
      <div class="fields">
      <label class="field">Car
        <select id="d-car">${CARS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field">Battery now <output id="d-batt-out"></output>
        <input id="d-batt" type="range" min="5" max="100" step="1"></label>
      <label class="field">Going to
        <select id="d-place"><optgroup label="Around KL East">${PLACES.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>
          <optgroup label="Longer trips">${TRIP_PLACES.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup></select></label>
      <label class="field" id="d-arrive-wrap" ${placeOf(ui.placeId).trip ? '' : 'hidden'}>Arrive with at least <output id="d-arrive-out"></output>
        <input id="d-arrive" type="range" min="5" max="50" step="1"></label>
      <label class="field">I live at
        <select id="d-home"><option value="">Not a resident here</option>${condos.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <fieldset class="field seg" id="d-park-wrap" ${placeOf(ui.placeId).trip ? "hidden" : ""}><legend>How long will you park?</legend>
        ${PARK_OPTIONS.map(([v, l]) => `<label><input type="radio" name="d-park" value="${v}"> ${l}</label>`).join('')}
      </fieldset>
      </div>
      <details class="prefs" ${hasPrefs() ? 'open' : ''}><summary>My preferences${hasPrefs() ? ' (on)' : ''}</summary>
        <div class="fields">
          <label class="field">Budget <select id="d-budget">${BUDGETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="field">Charging speed <select id="d-speed"><option value="any">Any</option><option value="fast">Fast DC only</option></select></label>
          <label class="field">Preferred operator <select id="d-op"><option value="">Any</option>${OPERATORS.map((o) => `<option>${o}</option>`).join('')}</select></label>
        </div>
      </details>
      <p class="muted">Demo time: ${esc(fmtTime(ctx.clock))}. Change it at the top to see prices and sharing change.</p>
    </section>
    <div class="map-row" id="d-map-row">
      <section class="map-wrap">
        <div id="d-map" class="map" aria-label="Map of chargers around KL East. Click a charger for details."></div>
        <p id="d-map-fallback" class="notice" hidden>The map could not load. The list of picks still works.</p>
      </section>
      <aside id="d-detail" class="panel detail" aria-label="Charger details" aria-live="polite" hidden></aside>
    </div>
    <section class="panel results" id="d-results" aria-live="polite"></section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  $('#d-car').value = ui.carId;
  $('#d-batt').value = ui.battery;
  $('#d-place').value = ui.placeId;
  $('#d-home').value = ui.homeId;
  $(`input[name="d-park"][value="${ui.parkFor}"]`).checked = true;
  $('#d-arrive').value = ui.arriveMin;
  $('#d-arrive').addEventListener('input', (e) => { ui.arriveMin = Number(e.target.value); update(root, ctx); });
  $('#d-budget').value = ui.prefs.maxPrice == null ? '' : String(ui.prefs.maxPrice);
  $('#d-speed').value = ui.prefs.fastOnly ? 'fast' : 'any';
  $('#d-op').value = ui.prefs.operator || '';
  $('#d-budget').addEventListener('change', (e) => { ui.prefs.maxPrice = e.target.value ? Number(e.target.value) : null; update(root, ctx); });
  $('#d-speed').addEventListener('change', (e) => { ui.prefs.fastOnly = e.target.value === 'fast'; update(root, ctx); });
  $('#d-op').addEventListener('change', (e) => { ui.prefs.operator = e.target.value || null; update(root, ctx); });
  $('#d-ask').addEventListener('submit', (e) => { e.preventDefault(); ask(root, ctx, $('#d-ask-text').value); });

  $('#d-car').addEventListener('change', (e) => { ui.carId = e.target.value; update(root, ctx); });
  $('#d-batt').addEventListener('input', (e) => { ui.battery = Number(e.target.value); update(root, ctx); });
  $('#d-place').addEventListener('change', (e) => {
    ui.placeId = e.target.value;
    $('#d-arrive-wrap').hidden = !placeOf(ui.placeId).trip;
    $('#d-park-wrap').hidden = placeOf(ui.placeId).trip;
    update(root, ctx);
  });
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
  const place = placeOf(ui.placeId);
  const destination = place.id === 'here' ? null : place;
  const ranking = rankChargers({
    ...ctx.world, car, batteryPct: ui.battery, origin, destination, date: ctx.clock,
    residentCondoId: ui.homeId || null, parkFor: ui.parkFor, prefs: ui.prefs,
  });
  const trip = place.trip
    ? planTrip({ chargers: [...HIGHWAY_CHARGERS, ...ctx.world.chargers], car, startPct: ui.battery, arriveMinPct: ui.arriveMin,
      origin: { ...origin, name: home ? home.name : 'KL East' }, destination: place, date: ctx.clock })
    : null;
  return { car, origin, ranking, trip, place };
}

function update(root, ctx) {
  const { car, origin, ranking, trip, place } = compute(ctx);
  root.querySelector('#d-batt-out').textContent = `${ui.battery}%`;
  root.querySelector('#d-arrive-out').textContent = `${ui.arriveMin}%`;
  last = { ranking, car };
  drawMarkers(root, ctx, origin, ranking, car);
  drawTrip(origin, trip, place);
  const box = root.querySelector('#d-results');
  box.innerHTML = trip && ui.stage === 'pick' ? tripHtml(trip, place, ctx) : ui.stage === 'pick' ? pickHtml(ranking, ctx) : stageHtml(ctx, ranking);
  bind(root, ctx, ranking, car);
  renderDetail(root, ctx, ranking, car);
}

function hasPrefs() {
  return ui.prefs.maxPrice != null || ui.prefs.fastOnly || !!ui.prefs.operator;
}

// Apply what Ask CasCas understood, then redraw the page so every field shows it.
function ask(root, ctx, text) {
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
    ? `Understood: ${understood.join(' · ')}. ${placeOf(ui.placeId).trip ? 'Your trip plan is below.' : 'The picks below use these settings.'}`
    : 'Sorry, I could not find a battery level, place, stay or preference in that. Try "40%, going to KLCC for 2 hours".';
  ui.stage = 'pick';
  renderDriver(root, ctx);
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
function tripHtml(t, place, ctx) {
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
    <p class="muted">${t.stops.length ? 'CasCas charges only what the next leg needs, and never past 80%, where fast charging slows down, so stops stay short.' : `No stop needed: you arrive with ${Math.round(t.arrivePct)}%.`} Highway chargers are demo data; times assume ${90} km/h.</p>
    <div class="btn-row"><a class="btn primary" href="${esc(t.directionsUrl)}" target="_blank" rel="noopener">Get directions</a></div>`;
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
  const cards = top.map((c, i) => `
    <article class="pick ${i === 0 ? 'first' : ''}">
      <div class="pick-top"><span class="rank">${i + 1}</span>
        <div><h3>${esc(c.charger.name)}</h3>
        <p class="muted">${esc(c.charger.operator)} · ${c.charger.type} ${c.charger.kw} kW · ${rm(c.price)}/kWh${c.charger.priceEstimated ? ' (est.)' : ''}</p></div></div>
      <ul class="reasons">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="btn-row"><button class="btn ${i === 0 ? 'primary' : ''}" type="button" data-book="${c.charger.id}">Book this bay</button>
      <button class="btn small" type="button" data-detail="${c.charger.id}">Details</button></div>
    </article>`).join('');
  const off = r.excluded.length
    ? `<details class="excluded"><summary>${r.excluded.length} chargers not suitable right now</summary><ul>${r.excluded.map((x) => `<li>${esc(x.charger.name)}: ${esc(x.reason)}</li>`).join('')}</ul></details>`
    : '';
  const rest = r.results.slice(3);
  const more = rest.length
    ? `<details class="more"><summary>Choose another charger (${rest.length})</summary><ul>${rest.map((c) => `<li><span>${esc(c.charger.name)} · ${rm(c.price)}/kWh · ${c.km.toFixed(1)} km</span> <span class="btn-row"><button class="btn small" type="button" data-detail="${c.charger.id}">Details</button><button class="btn small" type="button" data-book="${c.charger.id}">Book</button></span></li>`).join('')}</ul></details>`
    : '';
  const own = r.results.find((c) => c.isResident) || top[0];
  const timing = timingLine(own, ctx, own.full ? own.kWh : own.deliveredKwh);
  return head + note + timing + `<div class="picks">${cards}</div>` + compareHtml(r) + more + off;
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
      <section class="while" aria-label="While you charge">
        <h3>While you charge</h3>
        <ul>
          ${p.walk ? `<li>${esc(p.walk)}. Go ahead, the car charges while you are there.</li>` : ''}
          <li>We notify you when the charge is complete, and 15 minutes before your slot ends.</li>
          <li>Your slot ends at <b>${esc(fmtClock(new Date(p.slotEnd)))}</b>. After that, an overstay fee of ${rm(CONST.overstayRmPer10Min)} per 10 min applies, so the next driver can charge.</li>
          <li>You can stop charging from your phone at any time.</li>
        </ul>
      </section>
      <button class="btn" type="button" data-act="stop">Stop charging</button>`;
  }
  const s = p.session;
  return `<p class="notice-line"><b>Notification:</b> ${s.kWh >= p.kWhTarget - 0.01 ? 'charging complete' : 'charging stopped'}. Please move your car by ${esc(fmtClock(new Date(p.slotEnd)))} to avoid the overstay fee.</p>
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
  const box = root.querySelector('#d-results');
  box.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => startBooking(root, ctx, ranking, car, btn.dataset.book)));
  box.querySelectorAll('[data-detail]').forEach((btn) => btn.addEventListener('click', () => select(root, ctx, btn.dataset.detail, true)));
  const form = box.querySelector('#d-plate-form');
  if (form) {
    const input = form.querySelector('#d-plate');
    input.addEventListener('input', () => { ui.plate = input.value; });
    form.addEventListener('submit', (e) => { e.preventDefault(); confirmVisitor(root, ctx, ranking, car, form); });
  }
  const act = (name, fn) => { const b = box.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', fn); };
  act('back', () => { ui.stage = 'pick'; ui.pending = null; update(root, ctx); });
  act('start', () => { ui.stage = 'charging'; update(root, ctx); startTimer(root, ctx); });
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
  if (c.isSharedVisit) { ui.stage = 'plate'; ui.pending = c.charger.id; update(root, ctx); return; }
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
  if (ctx.api) ctx.refresh(); else update(root, ctx);
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

let tripLayer = null;
function drawTrip(origin, t, place) {
  if (!map) return;
  const had = !!tripLayer;
  if (tripLayer) { tripLayer.remove(); tripLayer = null; }
  if (!t) { if (had) map.setView([3.2135, 101.7265], 14); return; }
  tripLayer = L.layerGroup().addTo(map);
  const pts = [[origin.lat, origin.lng], ...t.stops.map((s) => [s.charger.lat, s.charger.lng]), [place.lat, place.lng]];
  L.polyline(pts, { className: 'trip-line', weight: 5 }).addTo(tripLayer);
  for (const s of t.stops) {
    L.marker([s.charger.lat, s.charger.lng], { icon: L.divIcon({ html: `<span class="pin pick">⚡ ${Math.round(s.arrivePct)}→${s.departPct}%</span>`, className: 'pin-wrap', iconSize: null }), title: s.charger.name })
      .bindPopup(`<div class="pop"><b>${esc(s.charger.name)}</b><br>Charge ${Math.round(s.arrivePct)}% → ${s.departPct}% · ${formatDuration(s.minutes)}</div>`).addTo(tripLayer);
  }
  L.marker([place.lat, place.lng], { icon: L.divIcon({ html: `<span class="pin dest">${esc(place.name)}</span>`, className: 'pin-wrap', iconSize: null }) }).addTo(tripLayer);
  map.fitBounds(pts, { padding: [30, 30] });
}

function initMap(el, fallback) {
  tripLayer = null;
  if (!window.L) { el.hidden = true; fallback.hidden = false; return; }
  map = L.map(el, { scrollWheelZoom: true }).setView([3.2135, 101.7265], 14);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  tiles.on('tileerror', () => { fallback.hidden = false; });
  layer = L.layerGroup().addTo(map);
}

function drawMarkers(root, ctx, origin, r, car) {
  if (!map) return;
  layer.clearLayers();
  markers = new Map();
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
    const marker = L.marker([ch.lat, ch.lng], { icon: L.divIcon({ html: html.replace('class="pin ', `class="pin ${ui.selected === ch.id ? 'sel ' : ''}`), className: 'pin-wrap', iconSize: null }), title: ch.name })
      .bindPopup(popupHtml(ch, price, !!shared), { maxWidth: 260 }).addTo(layer);
    marker.on('click', () => select(root, ctx, ch.id, false));
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
  if (!last) return;
  renderDetail(root, ctx, last.ranking, last.car);
  if (fromList && map) {
    const m = markers.get(id);
    if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); m.openPopup(); }
    root.querySelector('#d-map-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  aside.innerHTML = detailHtml(d, cand ? timingLine(cand, ctx, cand.full ? cand.kWh : cand.deliveredKwh) : '');
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
    <div class="detail-head"><h3>${esc(d.name)}</h3>
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
