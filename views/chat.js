// Ask CasSama as a conversation, when the server has an AI key. The server runs the agents;
// this shows the reply, which agents worked on it, the facts it used and buttons to act on it.
import { esc, rm } from './format.js';

export const SUGGESTIONS = [
  "I'm at 20%, where should I charge?",
  'Cheapest time to charge at Residensi Lumina?',
  'Plan a trip to Melaka, battery 60%',
  'How does condo bay sharing work?',
  'What did Lumina earn this month?',
];

// A safe subset of Markdown: escape everything, then **bold** and "- " bullet lines.
export function richText(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$|[.,!?])/g, '$1<i>$2</i>').split('\n');
  let out = '';
  let list = false;
  for (const raw of lines) {
    const line = raw.trim();
    const item = /^[-•*]\s+(.*)/.exec(line);
    if (item) { if (!list) { out += '<ul>'; list = true; } out += `<li>${item[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line) out += `<p>${line.replace(/^#+\s*/, '')}</p>`;
  }
  return list ? `${out}</ul>` : out;
}

function cardsHtml(cards = []) {
  if (!cards.length) return '';
  if (cards[0].kind === 'trip') {
    const t = cards[0];
    return `<div class="ccard trip"><b>${esc(t.name)}</b><span class="muted">${esc(t.sub)} · charging ${rm(t.cost)}</span>
      <ol>${t.stops.map((s) => `<li><button type="button" class="linkish" data-chat-view="${esc(s.id)}">${esc(s.name)}</button> <span class="muted">${s.from}% → ${s.to}% · ${s.minutes} min · ${rm(s.cost)}</span></li>`).join('')}</ol></div>`;
  }
  return `<div class="ccards">${cards.map((c, i) => `<button type="button" class="ccard" data-chat-view="${esc(c.id)}">
      <span class="crank">${i + 1}</span>
      <span class="cmain"><b>${esc(c.name)}</b><span class="muted">${esc(c.sub)}${c.home ? ' · your condo' : c.shared ? ' · shared condo bay' : ''}</span></span>
      <span class="cnums"><b>${rm(c.cost)}</b><span class="muted">${Math.round(c.kwh)} kWh · ${c.km.toFixed(1)} km</span></span></button>`).join('')}</div>`;
}

let available = null;
export const chat = { messages: [], busy: false };

export async function aiAvailable() {
  if (available !== null) return available;
  try {
    const r = await fetch('api/config');
    available = r.ok && (await r.json()).ai === true;
  } catch { available = false; }
  return available;
}
export const aiOn = () => available === true;

export async function sendChat(text, context, onChange) {
  const history = chat.messages.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, content: m.text }));
  chat.messages.push({ role: 'user', text });
  chat.busy = true;
  onChange();
  try {
    const res = await fetch('api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, history, context }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The assistant is unavailable right now');
    // A failed try followed by a good answer to the same question: keep only the answer.
    const n = chat.messages.length;
    if (n >= 3 && chat.messages[n - 2].error && chat.messages[n - 3].text === text) chat.messages.splice(n - 3, 2);
    chat.messages.push({ role: 'assistant', text: data.reply, steps: data.steps || [], citations: data.citations || [], actions: data.actions || [], cards: data.cards || [], model: data.model });
  } catch (e) {
    chat.messages.push({ role: 'assistant', text: e.message, error: true });
  }
  chat.busy = false;
  if (chat.messages.length > 20) chat.messages.splice(0, chat.messages.length - 20);
  onChange();
}

const actionLabel = (a) => (a.type === 'book' ? a.label : 'Open in Plan');

export function chatHtml() {
  if (!chat.messages.length && !chat.busy) {
    return `<div class="chat-suggest" role="group" aria-label="Try asking">${SUGGESTIONS.map((s) => `<button type="button" class="chip-btn" data-chat-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  }
  const msg = (m, i) => {
    if (m.role === 'user') return `<li class="msg me"><p>${esc(m.text)}</p></li>`;
    const steps = m.steps?.length ? `<details class="steps"><summary>How CasSama worked this out (${m.steps.length} steps)</summary>
        <ol>${m.steps.map((s) => `<li><b>${esc(s.agent)}</b> ${esc(s.did)}</li>`).join('')}</ol></details>` : '';
    const cites = m.citations?.length ? `<p class="cites">Facts used: ${m.citations.map((c) => `<span class="chip off">${esc(c.title)}</span>`).join(' ')}</p>` : '';
    const acts = m.actions?.length ? `<div class="btn-row">${m.actions.map((a, j) => `<button type="button" class="btn ${a.type === 'book' ? 'primary' : ''} small" data-chat-act="${i}:${j}">${esc(actionLabel(a))}</button>`).join('')}</div>` : '';
    return `<li class="msg bot${m.error ? ' err' : ''}"><div class="rich">${m.error ? `<p>${esc(m.text)}${/try again/i.test(m.text) ? "" : ". Try again in a moment."}</p>` : richText(m.text)}</div>${cardsHtml(m.cards)}${acts}${cites}${steps}</li>`;
  };
  return `<section class="chat" aria-label="Conversation with CasSama">
      <ul class="msgs" aria-live="polite">${chat.messages.map(msg).join('')}${chat.busy ? '<li class="msg bot typing"><p>CasSama is checking chargers…</p></li>' : ''}</ul>
      <p class="muted chat-foot">AI answers; every price comes from CasSama's own calculations. It cannot book or pay for you. <button type="button" class="linkish" data-chat-clear>Clear</button></p>
    </section>`;
}

export function chatAction(key) {
  const [i, j] = String(key).split(':').map(Number);
  return chat.messages[i]?.actions?.[j] || null;
}
