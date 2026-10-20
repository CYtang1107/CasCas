// The CasSama assistant on the server: an orchestrator model (Qwen through DashScope's
// OpenAI-compatible API by default) that calls CasSama's agents as tools. The key stays here.
import { TOOLS, AGENT_OF, runTool, guardInput, amountsGrounded, systemPrompt } from '../engine/agent.js';

const MAX_ROUNDS = 4;
const RETRY_STATUS = new Set([400, 401, 403, 404, 429, 500, 502, 503]);

export function createAgent({ key, baseUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', models = ['qwen-plus-latest', 'qwen-flash'], fetchFn = globalThis.fetch, now = () => Date.now(), perIp = 20, windowMs = 10 * 60e3, perDay = 1500, timeoutMs = 25000 }) {
  const hits = new Map();
  let day = '';
  let dayCount = 0;

  function allow(ip) {
    const t = now();
    const d = new Date(t).toISOString().slice(0, 10);
    if (d !== day) { day = d; dayCount = 0; }
    if (dayCount >= perDay) return false;
    const list = (hits.get(ip) || []).filter((x) => t - x < windowMs);
    if (list.length >= perIp) { hits.set(ip, list); return false; }
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    dayCount += 1;
    return true;
  }

  async function complete(messages, useTools) {
    let lastErr = 'no model';
    for (const model of models) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 500, ...(useTools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
        });
        if (!res.ok) {
          lastErr = `${model}: HTTP ${res.status}`;
          if (RETRY_STATUS.has(res.status)) continue;
          break;
        }
        const json = await res.json();
        const msg = json.choices?.[0]?.message;
        if (msg) return { msg, model };
        lastErr = `${model}: empty reply`;
      } catch (e) {
        lastErr = `${model}: ${e.name === 'AbortError' ? 'timeout' : e.message}`;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(lastErr);
  }

  // history: earlier turns [{role:'user'|'assistant', content}], env from the server world + client context.
  async function ask({ text, history = [], env, context }) {
    const guard = guardInput(text);
    if (guard.block) return { reply: guard.reply, steps: [{ agent: 'Guardrail', did: 'Blocked an unsafe or empty request' }], citations: [], actions: [], model: null };
    const messages = [
      { role: 'system', content: systemPrompt(context) },
      ...history.slice(-6).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '').slice(0, 600) })),
      { role: 'user', content: text },
    ];
    const steps = [{ agent: 'Orchestrator', did: 'Read your request' }];
    const sources = [text];
    const citations = [];
    const actions = [];
    let model = null;
    let reply = '';

    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const r = await complete(messages, round < MAX_ROUNDS);
      model = r.model;
      const calls = r.msg.tool_calls || [];
      if (!calls.length) { reply = String(r.msg.content || '').trim(); break; }
      messages.push({ role: 'assistant', content: r.msg.content || '', tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name;
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* empty args */ }
        const out = runTool(name, args, env);
        const outText = JSON.stringify(out);
        sources.push(outText);
        steps.push({ agent: AGENT_OF[name] || 'Agent', did: describe(name, args) });
        if (name === 'search_knowledge') for (const p of out.passages || []) if (!citations.some((c) => c.id === p.id)) citations.push({ id: p.id, title: p.title });
        if (name === 'propose_booking' && out.proposed) actions.push({ type: 'book', chargerId: out.charger_id, label: `Book ${out.name}` });
        if (name === 'fill_trip_form' && out.filled) actions.push({ type: 'plan', ...out });
        messages.push({ role: 'tool', tool_call_id: call.id, content: outText.slice(0, 6000) });
      }
    }

    // Guardrail: every RM amount must come from a tool. One correction, then a safe answer.
    let check = amountsGrounded(reply, sources);
    if (reply && !check.ok) {
      steps.push({ agent: 'Guardrail', did: `Asked for a fix: RM${check.missing.join(', RM')} was not from a tool` });
      messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `Some amounts (RM${check.missing.join(', RM')}) did not come from a tool result. Rewrite the answer using only amounts from the tool results above.` });
      try {
        const r = await complete(messages, false);
        reply = String(r.msg.content || '').trim();
        check = amountsGrounded(reply, sources);
      } catch { check = { ok: false }; }
      if (!check.ok) reply = 'I could not check every amount in my answer, so I have left them out. Open the suggestions on the Map or Plan screen for prices worked out by CasSama.';
    }
    if (!reply) reply = 'Sorry, I could not work that out. Try asking about where to charge, a trip, or how condo sharing works.';
    steps.push({ agent: 'Guardrail', did: 'Checked amounts against the agents\' results' });
    return { reply, steps, citations, actions, model };
  }

  return { allow, ask };
}

function describe(name, a) {
  switch (name) {
    case 'find_chargers': return `Ranked chargers for ${a.battery_pct ?? '?'}% battery${a.destination ? ` near ${a.destination}` : ''}`;
    case 'plan_trip': return `Planned a trip to ${a.destination}`;
    case 'best_time': return 'Found the cheapest time to charge';
    case 'estimate_cost': return `Priced ${a.kwh ?? '?'} kWh`;
    case 'condo_revenue': return `Worked out ${a.condo_id}'s income`;
    case 'search_knowledge': return `Looked up "${String(a.query || '').slice(0, 40)}"`;
    case 'propose_booking': return 'Prepared a booking for you to confirm';
    case 'fill_trip_form': return 'Filled in the Plan screen';
    default: return name;
  }
}
