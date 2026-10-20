// Resident votes on bay sharing, for both the driver app (residents vote) and the JMB portal
// (the JMB proposes and closes). Shared mode keeps proposals on the server; local mode on this device.
import { createProposal, castVote, tally, closeProposal, QUORUM } from '../engine/governance.js';
import { AUTO_HOURS } from '../engine/sharing.js';
import { esc, rm, fmtDay } from './format.js';

const cache = new Map(); // condoId -> { data, at, loading }
const STALE_MS = 8000;
const hour = (h) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
const DAYS = { weekdays: 'weekdays', weekends: 'weekends', all: 'every day' };

export function describeSharing(s) {
  if (!s?.enabled) return 'Sharing is off.';
  const when = s.mode === 'auto'
    ? `Auto: idle bays are shared ${DAYS[s.days]} between ${hour(AUTO_HOURS[0])} and ${hour(AUTO_HOURS[1])} whenever residents are not expected to need them (usually morning to late afternoon)`
    : `${hour(s.start)}–${hour(s.end)} ${DAYS[s.days]}`;
  return `${when}. ${s.reservedBays} bay${s.reservedBays === 1 ? '' : 's'} always kept for residents. Visitors pay ${rm(s.visitorPrice)}/kWh.`;
}

export function voterId(ctx) {
  if (!ctx.state.voterId) { ctx.state.voterId = `v-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`; ctx.save(); }
  return ctx.state.voterId;
}

const myVote = (ctx, p) => (p ? (ctx.state.myVotes || {})[p.id] || null : null);

export function proposalFor(ctx, condo) {
  if (!ctx.api) {
    const p = (ctx.state.proposals || {})[condo.id] || null;
    return p ? { proposal: p, tally: tally(p, condo.units), myVote: myVote(ctx, p) } : { proposal: null };
  }
  if (!cache.has(condo.id)) cache.set(condo.id, {});
  const e = cache.get(condo.id);
  if (!e.loading && (!e.at || Date.now() - e.at > STALE_MS)) {
    e.loading = true;
    ctx.api.proposal(condo.id).then((r) => {
      e.loading = false;
      e.at = Date.now();
      e.data = r.ok ? r.data : { proposal: null };
      ctx.rerender();
    });
  }
  const data = e.data || { proposal: null, loading: true };
  return { ...data, myVote: myVote(ctx, data.proposal) };
}

function remember(ctx, p, vote) {
  ctx.state.myVotes = { ...(ctx.state.myVotes || {}), [p.id]: vote };
  ctx.save();
}

// Every action returns { ok, error }.
async function run(ctx, condo, local, remote) {
  if (!ctx.api) {
    const err = local();
    ctx.save();
    ctx.rerender();
    return err ? { ok: false, error: err } : { ok: true };
  }
  const r = await remote();
  if (r.ok) { cache.set(condo.id, { data: r.data, at: Date.now() }); await ctx.refresh(); }
  return r;
}

export function vote(ctx, condo, choice) {
  const { proposal } = proposalFor(ctx, condo);
  if (!proposal) return Promise.resolve({ ok: false, error: 'No vote is open.' });
  return run(ctx, condo, () => {
    const r = castVote(proposal, voterId(ctx), choice, Date.now());
    if (r.error) return r.error;
    ctx.state.proposals[condo.id] = r.proposal;
    remember(ctx, proposal, choice);
    return null;
  }, async () => {
    const r = await ctx.api.vote(condo.id, voterId(ctx), choice);
    if (r.ok) remember(ctx, proposal, choice);
    return r;
  });
}

export function propose(ctx, condo, settings, token) {
  return run(ctx, condo, () => {
    ctx.state.proposals = { ...(ctx.state.proposals || {}), [condo.id]: createProposal({ id: `p-${Date.now()}`, condoId: condo.id, settings, now: Date.now() }) };
    return null;
  }, () => ctx.api.propose(condo.id, token, settings));
}

export function closeVote(ctx, condo, token) {
  return run(ctx, condo, () => {
    const p = ctx.state.proposals?.[condo.id];
    if (!p || p.status !== 'open') return 'No open vote.';
    const closed = closeProposal(p, condo.units, Date.now());
    ctx.state.proposals[condo.id] = closed;
    if (closed.status === 'passed') ctx.state.sharing[condo.id] = closed.settings;
    return null;
  }, () => ctx.api.closeVote(condo.id, token));
}

export function sampleVotes(ctx, condo, token) {
  return run(ctx, condo, () => {
    let p = ctx.state.proposals?.[condo.id];
    if (!p || p.status !== 'open') return 'No open vote.';
    const n = Math.max(1, Math.round(condo.units * 0.18));
    for (let i = 0; i < n; i++) p = castVote(p, `sample-${i}`, i % 10 < 7 ? 'yes' : 'no', Date.now()).proposal;
    ctx.state.proposals[condo.id] = { ...p, sampleVotes: n };
    return null;
  }, () => ctx.api.sampleVotes(condo.id, token));
}

// The vote as a card. role 'resident' shows Yes/No; role 'jmb' shows close and sample buttons.
export function proposalHtml(condo, data, role, canManage = false) {
  const p = data.proposal;
  if (!p) return data.loading ? '<p class="muted">Loading the vote…</p>' : (role === 'resident' ? '<p class="muted">No vote is open for your condo right now.</p>' : '');
  const t = data.tally || { yes: 0, no: 0, cast: 0, quorum: 1, quorumMet: false, passing: false };
  const yesPct = t.cast ? Math.round((t.yes / t.cast) * 100) : 0;
  const head = p.status === 'open'
    ? `<span class="chip amber-tag">Vote open</span> until ${esc(fmtDay(new Date(p.closesAt)))}`
    : p.status === 'passed' ? `<span class="chip on">Passed</span> ${esc(fmtDay(new Date(p.closedAt)))}: now in force` : `<span class="chip warn">Not passed</span> ${esc(fmtDay(new Date(p.closedAt)))}: nothing changed`;
  const buttons = p.status !== 'open' ? '' : role === 'resident'
    ? `<div class="btn-row vote-btns"><button type="button" class="btn ${data.myVote === 'yes' ? 'primary' : ''}" data-vote="yes" aria-pressed="${data.myVote === 'yes'}">Yes</button>
        <button type="button" class="btn ${data.myVote === 'no' ? 'primary' : ''}" data-vote="no" aria-pressed="${data.myVote === 'no'}">No</button></div>
        <p class="muted">${data.myVote ? `You voted ${data.myVote}. You can change it until the vote closes.` : 'One vote per resident. Only the totals are shown.'}</p>`
    : canManage ? `<div class="btn-row"><button type="button" class="btn small" data-sample>Add sample votes (demo)</button><button type="button" class="btn small primary" data-close-vote>Close the vote now</button></div>` : '';
  return `<div class="vote-card">
    <p class="vote-head">${head}</p>
    <p><b>Proposed:</b> ${esc(describeSharing(p.settings))}</p>
    <div class="tally" role="img" aria-label="${t.yes} yes, ${t.no} no"><span style="width:${yesPct}%"></span></div>
    <p class="muted">${t.yes} yes · ${t.no} no · ${t.cast} of ${condo.units} units voted. Passes with more yes than no and at least ${t.quorum} votes (${Math.round(QUORUM * 100)}% of units)${t.quorumMet ? ' ✓' : ''}.${p.sampleVotes ? ` Includes ${p.sampleVotes} sample votes for the demo.` : ''}</p>
    ${buttons}
  </div>`;
}

export function bindProposal(root, ctx, condo, token = null) {
  const err = (r) => { if (!r.ok) { const box = root.querySelector('.vote-err'); if (box) { box.textContent = r.error; box.hidden = false; } } };
  root.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', async () => err(await vote(ctx, condo, b.dataset.vote))));
  root.querySelector('[data-sample]')?.addEventListener('click', async () => err(await sampleVotes(ctx, condo, token)));
  root.querySelector('[data-close-vote]')?.addEventListener('click', async () => err(await closeVote(ctx, condo, token)));
}
