// Ask CasSama as a conversation, when the server has an AI key. The server runs the agents;
// this shows the reply, which agents worked on it, the facts it used and buttons to act on it.
import { esc } from './format.js';

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
    chat.messages.push({ role: 'assistant', text: data.reply, steps: data.steps || [], citations: data.citations || [], actions: data.actions || [], model: data.model });
  } catch (e) {
    chat.messages.push({ role: 'assistant', text: e.message, error: true });
  }
  chat.busy = false;
  if (chat.messages.length > 20) chat.messages.splice(0, chat.messages.length - 20);
  onChange();
}

const actionLabel = (a) => (a.type === 'book' ? a.label : 'Open in Plan');

export function chatHtml() {
  if (!chat.messages.length && !chat.busy) return '';
  const msg = (m, i) => {
    if (m.role === 'user') return `<li class="msg me"><p>${esc(m.text)}</p></li>`;
    const steps = m.steps?.length ? `<details class="steps"><summary>How CasSama worked this out (${m.steps.length} steps)</summary>
        <ol>${m.steps.map((s) => `<li><b>${esc(s.agent)}</b> ${esc(s.did)}</li>`).join('')}</ol></details>` : '';
    const cites = m.citations?.length ? `<p class="cites">Facts used: ${m.citations.map((c) => `<span class="chip off">${esc(c.title)}</span>`).join(' ')}</p>` : '';
    const acts = m.actions?.length ? `<div class="btn-row">${m.actions.map((a, j) => `<button type="button" class="btn ${a.type === 'book' ? 'primary' : ''} small" data-chat-act="${i}:${j}">${esc(actionLabel(a))}</button>`).join('')}</div>` : '';
    return `<li class="msg bot${m.error ? ' err' : ''}"><p>${esc(m.text)}</p>${acts}${cites}${steps}</li>`;
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
