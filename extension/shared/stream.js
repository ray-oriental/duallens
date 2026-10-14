// Bounded, text-only SSE and JSON prefix readers. No markup is evaluated.
export function createSSEParser(onData) {
  let pending = '', data = [], size = 0;
  const line = value => {
    if (!value) { if (data.length) onData(data.join('\n')); data = []; }
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  return {
    push(text) {
      size += text.length;
      if (size > 4 * 1024 * 1024) throw new Error('SSE response too large');
      pending += text;
      let m;
      while ((m = /\r\n|\r(?!$)|\n/.exec(pending))) {
        line(pending.slice(0, m.index)); pending = pending.slice(m.index + m[0].length);
      }
    },
    end() { if (pending) line(pending.replace(/\r$/, '')); line(''); pending = ''; },
  };
}

// Only the canonical {"t":[...]} prefix is eligible for early display. Fences,
// legacy replies and malformed JSON still go through the final batch validator.
export function createTranslationStream(expected, onItem) {
  let text = '', pos = 0, started = false, failed = false, count = 0;
  let stringStart = -1, escaped = false, delimiter = false, ended = false;
  return {
    push(delta) {
      if (failed) return;
      text += delta;
      if (text.length > 4 * 1024 * 1024) { failed = true; return; }
      if (ended) return;
      if (!started) {
        const match = /^\s*\{\s*"t"\s*:\s*\[/.exec(text);
        if (!match) return;
        pos = match[0].length; started = true;
      }
      for (; pos < text.length; pos++) {
        const ch = text[pos];
        if (stringStart >= 0) {
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch !== '"') continue;
          try {
            const value = JSON.parse(text.slice(stringStart, pos + 1));
            if (count >= expected || !value.trim()) { failed = true; return; }
            onItem(count++, value.trim());
          } catch { failed = true; return; }
          stringStart = -1; delimiter = true;
        } else if (/\s/.test(ch)) continue;
        else if (delimiter && ch === ',') delimiter = false;
        else if (ch === ']') { ended = true; pos = text.length; return; }
        else if (!delimiter && ch === '"') stringStart = pos;
        else { failed = true; return; }
      }
    },
    valid() {
      try {
        const value = JSON.parse(text);
        return !failed && Array.isArray(value.t) && value.t.length === expected &&
          value.t.every(s => typeof s === 'string' && s.trim());
      } catch { return false; }
    },
  };
}
