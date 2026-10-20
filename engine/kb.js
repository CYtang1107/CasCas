// Retrieval for the assistant: BM25 keyword search over the knowledge base (it is small,
// so a vector database would add cost and nothing else).
const STOP = new Set('a an and are at be by can do does for from how i in is it my of on or the to what when where which who why will with you your'.split(' '));
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9%.\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

export function searchKnowledge(docs, query, k = 3) {
  const q = words(query);
  if (!q.length) return [];
  const toks = docs.map((d) => words(`${d.title} ${d.title} ${d.text}`));
  const avg = toks.reduce((s, t) => s + t.length, 0) / toks.length;
  const same = (t, w) => t === w || (w.length > 4 && t.length > 4 && t.slice(0, 5) === w.slice(0, 5));
  const df = (w) => toks.filter((ts) => ts.some((t) => same(t, w))).length;
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const w of new Set(q)) {
      const f = toks[i].filter((t) => same(t, w)).length; // "private" finds "privacy"
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df(w) + 0.5) / (df(w) + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (toks[i].length / avg))));
    }
    return { ...d, score };
  });
  return scored.filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
