// Keyword extraction from free text (voice transcripts, typed text, app events).
// Matches every configured trigger and its aliases, tolerant of case, punctuation,
// plurals, filler words between terms ("pizza place near me"), and common voice spellings.
// The same algorithm runs in the dashboard (src/app.html) so demo and live behave alike.

const STOP = new Set(["a", "an", "the", "some", "any", "for", "to", "of", "in", "at", "on", "please", "um", "uh", "like", "good", "really", "me", "my"]);
const VOICE_FIXES = [[/\bnear by\b/g, "nearby"], [/\bnearby\b/g, "near me"], [/\bopen right now\b/g, "open now"], [/\bplumbers?\b/g, "plumber"], [/\btaco(s)?\b/g, "tacos"]];

export function normalize(text) {
  let t = String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/[^a-z0-9\s'-]/g, " ").replace(/['-]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, to] of VOICE_FIXES) t = t.replace(re, to);
  return t;
}
const stem = w => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokens = t => normalize(t).split(" ").filter(Boolean).map(stem);

// Returns [{ term, alias, score }] where score is 1 for an exact phrase and lower for a looser match.
export function extractKeywords(text, keywords, { maxGap = 3 } = {}) {
  const words = tokens(text);
  if (!words.length) return [];
  const flat = " " + words.join(" ") + " ";
  const out = [];
  for (const kw of keywords) {
    if (kw.on === false) continue;
    const phrases = [kw.term, ...(kw.aliases || [])];
    let best = null;
    for (const phrase of phrases) {
      const need = tokens(phrase).filter(w => !STOP.has(w) || tokens(phrase).length <= 2);
      if (!need.length) continue;
      if (flat.includes(" " + need.join(" ") + " ")) { best = { term: kw.term, alias: phrase, score: 1 }; break; }
      // In-order match with small gaps: "pizza place near me" still matches "pizza near me".
      let i = 0, gaps = 0, last = -1;
      for (let j = 0; j < words.length && i < need.length; j++) {
        if (words[j] === need[i]) { if (last >= 0) gaps += j - last - 1; last = j; i++; }
      }
      if (i === need.length && gaps <= maxGap * (need.length - 1)) {
        const score = Math.max(0.6, 1 - gaps * 0.08);
        if (!best || score > best.score) best = { term: kw.term, alias: phrase, score: +score.toFixed(2) };
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score);
}
