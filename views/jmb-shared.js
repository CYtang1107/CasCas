// The JMB's private cards. Local mode: from this device. Shared mode: PIN login, then the
// condo's sessions and visitor plates from the server. Plates are never shown without the PIN.
import { insightsSection, visitorsHtml } from './jmb-insights.js';
import { filterSessions } from '../engine/insights.js';
import { cleanEntry } from '../engine/maintenance.js';
import { esc, rm, pct, num } from './format.js';

const STALE_MS = 10000;
const cache = new Map(); // condoId -> { data, summary, at, summaryAt, loading, summaryLoading, error }
const tokenKey = (id) => `cascas.jmb.${id}`;

export const forgetJmb = (condoId) => cache.delete(condoId);

export function getToken(condoId) {
  try {
    const t = sessionStorage.getItem(tokenKey(condoId));
    return t && Number(t.split('.')[1]) > Date.now() ? t : null;
  } catch { return null; }
}

function setToken(condoId, token) {
  try {
    if (token) sessionStorage.setItem(tokenKey(condoId), token);
    else sessionStorage.removeItem(tokenKey(condoId));
  } catch { /* private window: login lasts until reload */ }
}

const entryFor = (id) => { if (!cache.has(id)) cache.set(id, {}); return cache.get(id); };

export function privateSection(condo, charger, ctx) {
  if (!ctx.api) {
    const ins = insightsSection(condo, charger, ctx, filterSessions(ctx.state.sessions, { condoId: condo.id }));
    const addMaintenance = (entry) => {
      ctx.state.maintenance[condo.id] = [...(ctx.state.maintenance[condo.id] || []), cleanEntry(entry)];
      ctx.save();
      ctx.rerender();
      return { ok: true };
    };
    return { canEdit: true, html: visitorsHtml(condo, ctx, ctx.state.visitorPasses) + ins.html, bind: ins.bind, save: null,
      maintenance: ctx.state.maintenance[condo.id] || [], addMaintenance, sessions: filterSessions(ctx.state.sessions, { condoId: condo.id }) };
  }
  const e = entryFor(condo.id);
  const token = getToken(condo.id);
  return token ? loggedIn(condo, charger, ctx, e, token) : loginCard(condo, ctx, e);
}

function loginCard(condo, ctx, e) {
  if (!e.summaryLoading && (!e.summaryAt || Date.now() - e.summaryAt > STALE_MS)) {
    e.summaryLoading = true;
    ctx.api.summary(condo.id).then((r) => {
      e.summaryLoading = false;
      e.summaryAt = Date.now();
      e.summary = r.ok ? r.data : null;
      ctx.rerender();
    });
  }
  const s = e.summary;
  const html = `
    <section class="card jmb-login">
      <h3>JMB login</h3>
      <p class="muted">Visitor plates, the session log and sharing settings are for ${esc(condo.name)}'s management only. Enter the condo PIN.</p>
      <form id="j-login" class="row" novalidate>
        <label class="field">Condo PIN <input id="j-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>
        <button class="btn primary" type="submit">Log in</button>
      </form>
      <p id="j-login-err" class="error" role="alert" hidden></p>
      ${s ? `<p class="muted">Shared demo so far at this condo: ${num(s.count)} booking${s.count === 1 ? '' : 's'}${s.count ? ` · ${pct(s.followRate)} took a CasSama pick · ${rm(s.savedRm)} saved vs nearest` : ''}.</p>` : ''}
    </section>`;
  const bind = (root) => {
    root.querySelector('#j-login').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = root.querySelector('#j-login-err');
      const r = await ctx.api.login(condo.id, root.querySelector('#j-pin').value.trim());
      if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
      setToken(condo.id, r.data.token);
      cache.delete(condo.id);
      ctx.rerender();
    });
  };
  return { canEdit: false, html, bind, save: null, maintenance: null, addMaintenance: null };
}

function loggedIn(condo, charger, ctx, e, token) {
  if (!e.loading && (!e.at || Date.now() - e.at > STALE_MS)) {
    e.loading = true;
    ctx.api.jmb(condo.id, token).then((r) => {
      e.loading = false;
      e.at = Date.now();
      if (r.ok) { e.data = r.data; e.error = null; } else { e.error = r.error; if (r.status === 401) setToken(condo.id, null); }
      ctx.rerender();
    });
  }
  if (!e.data) {
    return { canEdit: false, html: `<section class="card"><p class="loading">${esc(e.error || 'Loading JMB data…')}</p></section>`, bind: () => {}, save: null, maintenance: null, addMaintenance: null };
  }
  const ins = insightsSection(condo, charger, ctx, e.data.sessions);
  const html = `
    <div class="jmb-auth"><span class="chip on">Logged in as ${esc(condo.name)} JMB</span>
      <button id="j-logout" class="btn small" type="button">Log out</button></div>
    ${visitorsHtml(condo, ctx, e.data.passes)}
    ${ins.html}`;
  return {
    canEdit: true,
    maintenance: e.data.maintenance || [],
    sessions: e.data.sessions,
    addMaintenance: async (entry) => {
      const r = await ctx.api.addMaintenance(condo.id, token, entry);
      if (r.ok) { cache.delete(condo.id); await ctx.refresh(); }
      return r;
    },
    html,
    bind: (root) => {
      ins.bind(root);
      root.querySelector('#j-logout').addEventListener('click', () => { setToken(condo.id, null); cache.delete(condo.id); ctx.rerender(); });
    },
    save: async (sharing) => {
      const r = await ctx.api.saveSharing(condo.id, token, sharing);
      if (r.ok) { cache.delete(condo.id); await ctx.refresh(); }
      return r;
    },
  };
}
