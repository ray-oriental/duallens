// Frozen pre-fix lexer (6811b71). Only the test oracle drops fresh contexts and
// watchdogs: each raw literal is still evaluated as a non-strict vm Script.
import vm from 'node:vm';

const operators=/^(?:>>>=|===|!==|\*\*=|&&=|\|\|=|\?\?=|>>>|<<=|>>=|=>|==|!=|<=|>=|\+\+|--|\*\*|&&|\|\||\?\?|\?\.|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.\.)/;
const fail = (file, message) => { throw new Error(`${file}: ${message}`); };

export function tokens(source, file = '<source>') {
  const out = [];
  let i = 0;
  const quoted = (quote) => {
    const start = i++;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i++] === quote) return source.slice(start, i);
    }
    fail(file, 'unterminated string');
  };
  const template = () => {
    i++;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === '`') { i++; return; }
      if (source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        const start = i;
        let depth = 1;
        while (i < source.length && depth) {
          const ch = source[i];
          if (ch === '"' || ch === "'") { quoted(ch); continue; }
          if (ch === '`') { template(); continue; }
          if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
          if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); if (end < 0) fail(file, 'unterminated comment'); i = end + 2; continue; }
          if (ch === '{') depth++;
          if (ch === '}') depth--;
          i++;
        }
        if (depth) fail(file, 'unterminated template expression');
        rejectRuntimeImports(tokens(source.slice(start, i - 1), file), file);
      } else i++;
    }
    fail(file, 'unterminated template');
  };
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2); if (end < 0) fail(file, 'unterminated comment'); i = end + 2; continue;
    }
    const start = i;
    let kind = 'punct', value;
    if (c === '"' || c === "'") {
      kind = 'string'; const raw = quoted(c);
      value = vm.runInThisContext(raw);
    } else if (c === '`') { kind = 'template'; template(); value = '<template>'; }
    else if (/[A-Za-z_$]/.test(c)) {
      kind = 'word'; i++; while (i < source.length && /[\w$]/.test(source[i])) i++; value = source.slice(start, i);
    } else if (/\d/.test(c)) {
      kind = 'number'; i++; while (i < source.length && /[\w.]/.test(source[i])) i++; value = source.slice(start, i);
    } else if (c === '/' && (!out.length || /^(?:=|\(|\[|\{|,|:|;|!|\?|&|\||&&|\|\||\?\?|return|throw|yield|=>)$/.test(out.at(-1).value))) {
      kind = 'regex'; i++; let group = false, closed = false;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === '\\') { i++; continue; }
        if (ch === '[') group = true;
        if (ch === ']') group = false;
        if (ch === '/' && !group) { closed = true; break; }
        if (ch === '\n') break;
      }
      if (!closed) fail(file, 'unterminated regex');
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
      value = '<regex>';
    } else { value=source.slice(i).match(operators)?.[0]||c;i+=value.length; }
    out.push({ kind, value, start, end: i });
  }
  return out;
}

function rejectRuntimeImports(list, file) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind !== 'word' || list[i].value !== 'import' || list[i - 1]?.value === '.') continue;
    if (list[i + 1]?.value === '(' || list[i + 1]?.value === '.') fail(file, 'dynamic import/import.meta is unsupported');
  }
}
