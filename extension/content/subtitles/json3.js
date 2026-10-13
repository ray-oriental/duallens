export const ASR_CONFIG = Object.freeze({ splitGapMs: 1000, mergeGapMs: 1500, splitWords: 17, mergeWords: 19 });
const MAX_EVENTS = 30000;
const sound = /\[(?:[^\]]{0,80})\]|\((?:music|applause|laughter|laughing|silence|noise|音楽|音乐|掌声|笑声)\)/gi;
const clean = (text) => text.replace(sound, '').replace(/[♪♫]+/g, '').replace(/\s+/g, ' ').trim();
const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
const sentenceEnd = /[.!?。！？]["'”’]?$/u;
const terminal = (text) => sentenceEnd.test(text);

// Word timestamps from ASR are split conservatively, then small sentence pieces
// are joined if their time gap and combined word count fit the merge limits.
export function resegmentASR(tokens, config = ASR_CONFIG) {
  const pieces = [];
  let current = null;
  const flush = () => { if (current) pieces.push(current); current = null; };
  for (const token of tokens) {
    if (current && (token.start - current.end >= config.splitGapMs ||
        words(current.text) + words(token.text) > config.splitWords || terminal(current.text) ||
        current.text.length + token.text.length > 500)) flush();
    if (!current) current = { ...token };
    else { current.text += ' ' + token.text; current.end = Math.max(current.end, token.end); }
  }
  flush();
  const joined = [];
  for (const piece of pieces) {
    const prev = joined.at(-1);
    if (prev && !terminal(prev.text) && piece.start - prev.end < config.mergeGapMs &&
        words(prev.text) + words(piece.text) <= config.mergeWords && prev.text.length + piece.text.length < 500) {
      prev.text += ' ' + piece.text; prev.end = Math.max(prev.end, piece.end);
    } else joined.push({ ...piece });
  }
  return joined;
}

export function parseJSON3(data, { asr = false } = {}) {
  if (!data || !Array.isArray(data.events) || data.events.length > MAX_EVENTS) throw new Error('字幕格式无效或过大');
  const events = data.events.filter(e => e && Array.isArray(e.segs) &&
    Number.isFinite(e.tStartMs) && e.tStartMs >= 0).sort((a, b) => a.tStartMs - b.tStartMs);
  const cues = [], tokens = [], seen = new Set();
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const start = event.tStartMs;
    const duration = Number.isFinite(event.dDurationMs) && event.dDurationMs > 0 ? event.dDurationMs :
      Math.max(1, (events[index + 1]?.tStartMs ?? start + 2000) - start);
    const end = start + duration;
    if (event.segs.length > 5000) throw new Error('字幕片段过多');
    if (!asr) {
      const text = clean(event.segs.map(s => typeof s?.utf8 === 'string' ? s.utf8 : '').join(''));
      if (!text) continue;
      cues.push({ start, end, text });
    } else {
      for (let i = 0; i < event.segs.length; i++) {
        const seg = event.segs[i];
        if (typeof seg?.utf8 !== 'string') continue;
        const text = clean(seg.utf8);
        if (!text) continue;
        const offset = Number.isFinite(seg.tOffsetMs) && seg.tOffsetMs >= 0 ? seg.tOffsetMs : 0;
        const begin = Math.min(end, start + offset);
        const next = event.segs[i + 1];
        const finish = next && Number.isFinite(next.tOffsetMs) ? Math.min(end, start + next.tOffsetMs) : end;
        const parts = text.split(/\s+/u);
        for (let j = 0; j < parts.length; j++) {
          const tokenStart = begin + Math.max(1, finish - begin) * j / parts.length;
          const tokenEnd = begin + Math.max(1, finish - begin) * (j + 1) / parts.length;
          const key = JSON.stringify([tokenStart, parts[j]]);
          if (seen.has(key)) continue; // Identical rolling-window replay.
          seen.add(key); tokens.push({ start: tokenStart, end: tokenEnd, text: parts[j] });
        }
      }
    }
  }
  const list = asr ? resegmentASR(tokens.sort((a, b) => a.start - b.start)) : cues;
  if (list.length > 10000) throw new Error('字幕条数过多');
  return list.map((cue, i) => ({ ...cue, id: `subtitle-${i}`, translation: null }));
}

export function cueIndexAt(cues, timeMs) {
  let low = 0, high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= timeMs) low = middle + 1; else high = middle;
  }
  return Math.max(0, low - 1);
}
