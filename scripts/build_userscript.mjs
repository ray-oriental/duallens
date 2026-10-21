#!/usr/bin/env node
// Deliberately small, fail-closed module packer for this repository. No npm dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { OCR_RESOURCES } from '../extension/content/comics/runtime-resources.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const identifier = /^[A-Za-z_$][\w$]*$/;
const operators=/^(?:>>>=|===|!==|\*\*=|&&=|\|\|=|\?\?=|>>>|<<=|>>=|=>|==|!=|<=|>=|\+\+|--|\*\*|&&|\|\||\?\?|\?\.|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.\.)/;
const fail = (file, message) => { throw new Error(`${file}: ${message}`); };

// Keep offsets into the original source. Comments, strings, templates and regex literals must
// never accidentally become module declarations. Template expressions are checked recursively.
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
      value = vm.runInNewContext(raw, Object.create(null), { timeout: 100 });
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

// Size budget: drop comments and indentation, keep every token byte-for-byte. A gap between two
// tokens holds only whitespace and comments (strings, templates and regex literals are tokens), so
// rewriting gaps cannot touch program text. A gap without a comment keeps its bytes unless it holds a
// newline. Newlines at structural separators can be removed; other newlines preserve ASI. The
// result is re-tokenized and must be the same token sequence, otherwise the build fails.
export function compactSource(source, file = '<source>') {
  const list = tokens(source, file);
  const gap = (text, previous, next) => {
    if (!previous) return '';
    if (/[\r\n\u2028\u2029]/.test(text)) return [';','{','(', '[',','].includes(previous.value)||next.value==='}'?'':'\n';
    // A comment right after "\" or a bare "/" may really be part of a regex the tokenizer took for division.
    if (/\/[/*]/.test(text) && previous.kind === 'punct' && (previous.value === '\\' || previous.value === '/')) fail(file, `ambiguous comment after ${previous.value}`);
    if(!text) return '';
    // Keep lexical separators and separated operators; never join + +, / / or numeric dots.
    return /^(word|number)$/.test(previous.kind)&&/^(word|number)$/.test(next.kind)||
      previous.kind==='punct'&&next.kind==='punct'&&(operators.test(previous.value+next.value)||/\/[/*]/.test(previous.value+next.value))||previous.kind==='regex'&&next.kind==='word'||
      previous.kind==='number'&&next.value==='.'?' ':'';
  };
  let out = '', prevEnd = 0;
  list.forEach((t, i) => {
    out += gap(source.slice(prevEnd, t.start), list[i - 1],t) + source.slice(t.start, t.end);
    prevEnd = t.end;
  });
  out += /[\r\n\u2028\u2029]/.test(source.slice(prevEnd)) ? '\n' : '';
  const again = tokens(out, file);
  if (again.length !== list.length || again.some((t, i) => t.kind !== list[i].kind || t.value !== list[i].value)) fail(file, 'compaction changed the token stream');
  return out;
}

function rejectRuntimeImports(list, file) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind !== 'word' || list[i].value !== 'import' || list[i - 1]?.value === '.') continue;
    if (list[i + 1]?.value === '(' || list[i + 1]?.value === '.') fail(file, 'dynamic import/import.meta is unsupported');
  }
}

function names(list, file) {
  if (!list.length) return [];
  const groups = [[]];
  for (const t of list) t.value === ',' ? groups.push([]) : groups.at(-1).push(t.value);
  if (!groups.at(-1).length) groups.pop();
  return groups.map((g) => {
    if (!((g.length === 1 || (g.length === 3 && g[1] === 'as')) && identifier.test(g[0]) && identifier.test(g.at(-1)))) fail(file, 'unsupported named binding');
    return { imported: g[0], local: g.at(-1) };
  });
}

function parseModule(source, file) {
  const ts = tokens(source, file);
  rejectRuntimeImports(ts, file);
  if (ts.some((t) => t.kind === 'word' && ['__exports','__require','__export','__e', '__r', '__x', '__dlDefault'].includes(t.value))) {
    fail(file, 'reserved bundler binding');
  }
  const imports = [], exports = [], edits = [];
  let depth = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind === 'punct' && ['}', ')', ']'].includes(t.value)) depth--;
    if (depth === 0 && t.kind === 'word' && t.value === 'import') {
      let end = i + 1;
      while (end < ts.length && ts[end].kind !== 'string') end++;
      if (end === ts.length || ts[end + 1]?.value !== ';') fail(file, 'imports require a static path and semicolon; import attributes are unsupported');
      const clause = ts.slice(i + 1, end);
      const item = { specifier: ts[end].value, bindings: [], namespace: null };
      if (clause.length) {
        if (clause.at(-1).value !== 'from') fail(file, 'unsupported import syntax');
        clause.pop();
        if (clause[0]?.value === '*') {
          if (clause.length !== 3 || clause[1].value !== 'as' || !identifier.test(clause[2].value)) fail(file, 'unsupported namespace import');
          item.namespace = clause[2].value;
        } else if (clause[0]?.value === '{' && clause.at(-1)?.value === '}') item.bindings = names(clause.slice(1, -1), file);
        else if (clause.length === 1 && identifier.test(clause[0].value)) item.bindings = [{ imported: 'default', local: clause[0].value }];
        else fail(file, 'unsupported import syntax');
      }
      imports.push(item);
      edits.push({ start: t.start, end: ts[end + 1].end, importIndex: imports.length - 1 });
      i = end + 1; continue;
    }
    if (depth === 0 && t.kind === 'word' && t.value === 'export') {
      let next = ts[i + 1];
      if (next?.value === 'default') {
        const offset = ts[i + 2]?.value === 'async' ? 3 : 2;
        const declaration = ts[i + offset];
        const name = ts[i + offset + (ts[i + offset + 1]?.value === '*' ? 2 : 1)];
        const named = ['function', 'class'].includes(declaration?.value) && name?.kind === 'word';
        exports.push({ imported: named ? name.value : '__dlDefault', local: 'default' });
        edits.push({ start: t.start, end: next.end, replacement: named ? '' : 'const __dlDefault =' });
        if (!named && ['function', 'class'].includes(declaration?.value)) {
          let nested = 0, body = false;
          for (let k = i + offset + 1; k < ts.length; k++) {
            if (ts[k].kind !== 'punct') continue;
            const v = ts[k].value;
            if (v === '{' && nested === 0) body = true;
            if (['(', '[', '{'].includes(v)) nested++;
            if ([')', ']', '}'].includes(v)) nested--;
            if (body && nested === 0) { edits.push({ start: ts[k].end, end: ts[k].end, replacement: ';' }); break; }
          }
        }
        i++; continue;
      }
      if (next?.value === '{') {
        const end = ts.findIndex((x, j) => j > i + 1 && x.value === '}');
        if (end < 0 || ts[end + 1]?.value !== ';') fail(file, 're-exports and unterminated export lists are unsupported');
        exports.push(...names(ts.slice(i + 2, end), file));
        edits.push({ start: t.start, end: ts[end + 1].end, replacement: '' });
        i = end + 1; continue;
      }
      const offset = next?.value === 'async' ? 2 : 1;
      next = ts[i + offset];
      if (!['function', 'class', 'const'].includes(next?.value)) fail(file, 'unsupported export declaration (mutable exports/re-exports are not supported)');
      const name = ts[i + offset + (ts[i + offset + 1]?.value === '*' ? 2 : 1)];
      if (!name || name.kind !== 'word' || !identifier.test(name.value)) fail(file, 'unsupported exported binding');
      if (next.value === 'const') {
        if (ts[i + offset + 2]?.value !== '=') fail(file, 'unsupported exported const');
        let nested = 0;
        for (let k = i + offset + 3; k < ts.length; k++) {
          const v = ts[k].value;
          if (ts[k].kind !== 'punct') continue;
          if (v === ';' && nested === 0) break;
          if (v === ',' && nested === 0) fail(file, 'multiple exported const bindings are unsupported');
          if (['(', '[', '{'].includes(v)) nested++;
          if ([')', ']', '}'].includes(v)) nested--;
        }
      }
      exports.push({ imported: name.value, local: name.value });
      edits.push({ start: t.start, end: t.end, replacement: '' });
    }
    if (t.kind === 'punct' && ['{', '(', '['].includes(t.value)) depth++;
  }
  const seen = new Set();
  for (const e of exports) { if (seen.has(e.local)) fail(file, 'duplicate export'); seen.add(e.local); }
  return { source, imports, exports, edits };
}

export async function buildBundle(entry, { root = path.dirname(entry), entryExports = [] } = {}) {
  root = await fs.realpath(root);
  const graph = new Map(), active = new Set();
  async function visit(file) {
    file = await fs.realpath(file);
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) fail(file, 'dependency escapes module root');
    if (active.has(file)) fail(file, 'cyclic modules are unsupported');
    if (graph.has(file)) return file;
    active.add(file);
    const source = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const mod = path.extname(file) === '.css'
      ? parseModule(`export default ${JSON.stringify(source)};`, rel)
      : path.extname(file) === '.js' || path.extname(file) === '.mjs' ? parseModule(source, rel) : fail(file, 'unsupported module type');
    graph.set(file, mod);
    for (const item of mod.imports) {
      if (!item.specifier.startsWith('./') && !item.specifier.startsWith('../')) fail(rel, 'external module dependencies are unsupported');
      item.file = await visit(path.resolve(path.dirname(file), item.specifier));
      const available = new Set(graph.get(item.file).exports.map((e) => e.local));
      for (const b of item.bindings) if (!available.has(b.imported)) fail(rel, `missing export ${b.imported}`);
    }
    active.delete(file); return file;
  }
  const entryFile = await visit(entry);
  // Emit only getters consumed by this static graph; namespace imports keep every getter.
  // Module bodies still run unchanged, including side effects and live bindings.
  const used=new Map([...graph.keys()].map(file=>[file,new Set()]));
  for (const name of entryExports) {
    if (!graph.get(entryFile).exports.some(e => e.local === name)) fail(entry, `missing entry export ${name}`);
    used.get(entryFile).add(name);
  }
  for(const mod of graph.values())for(const item of mod.imports) {
    const names=item.namespace ? graph.get(item.file).exports.map(e=>e.local) : item.bindings.map(b=>b.imported);
    for(const name of names)used.get(item.file).add(name);
  }
  const ids=new Map([...graph.keys()].map((file,i)=>[file,i]));
  const id=file=>ids.get(file);
  const factories = [];
  for (const [file, mod] of graph) {
    let code = mod.source;
    for (const edit of [...mod.edits].sort((a, b) => b.start - a.start)) {
      let replacement = edit.replacement;
      if (edit.importIndex !== undefined) {
        const item = mod.imports[edit.importIndex];
        const require = `__r(${JSON.stringify(id(item.file))})`;
        replacement = item.namespace ? `const ${item.namespace} = ${require};` : item.bindings.length
          ? `const { ${item.bindings.map((b) => b.imported===b.local ? b.local : `${b.imported}: ${b.local}`).join(', ')} } = ${require};` : `${require};`;
      }
      code = code.slice(0, edit.start) + replacement + code.slice(edit.end);
    }
    code = compactSource(code, path.relative(root,file));
    code += '\n__x(__e,{' + mod.exports.filter(e=>used.get(file).has(e.local)).map(e=>`${JSON.stringify(e.local)}:()=>${e.imported}`).join(',') + '});';
    factories.push(`${JSON.stringify(id(file))}:function(__e,__r){\n${code}\n}`);
  }
  const bundle = `// Modules: ${JSON.stringify([...graph.keys()].map(f=>path.relative(root,f).replaceAll('\\','/')))}\n(function() {\n'use strict';\nfunction __x(out,values){for(const [key,get] of Object.entries(values))Object.defineProperty(out,key,{enumerable:true,get});}\nconst __modules = {\n${factories.join(',\n')}\n};\nconst __cache = Object.create(null);\nfunction __r(id) {\n if (__cache[id]) return __cache[id];\n const out = __cache[id] = Object.create(null);\n __modules[id](out, __r);\n return out;\n}\n${entryExports.length ? 'return ' : ''}__r(${JSON.stringify(id(entryFile))});\n})();\n`;
  // Validate before touching the output. Unsupported/unrewritten ESM and top-level await fail.
  new vm.Script(bundle, { filename: 'duallens.user.js' });
  new Function(bundle);
  return bundle;
}

export function metadata(version, resources = []) {
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error('Invalid manifest version');
  return `// ==UserScript==
// @name         DualLens 双语对照翻译
// @namespace    https://github.com/ray-oriental/duallens
// @version      ${version}
// @description  使用自己的模型服务进行网页双语翻译
// @license      MIT
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @sandbox      DOM
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_getResourceText
${OCR_RESOURCES.map(r=>`// @resource     ${r.name} ${r.url}#sha256=${r.sha256}`).join('\n')}
${resources.map(r=>`// @resource     ${r.name} ${r.url}#sha256=${r.sha256}`).join('\n')}
// @connect      *
// @downloadURL  https://github.com/ray-oriental/duallens/releases/latest/download/duallens.user.js
// @updateURL    https://github.com/ray-oriental/duallens/releases/latest/download/duallens.user.js
// ==/UserScript==
`;
}

export async function buildUserscript({ project = PROJECT, output = path.join(project, 'dist', 'duallens.user.js') } = {}) {
  const manifest = JSON.parse((await fs.readFile(path.join(project, 'extension', 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const settings = await buildBundle(path.join(project, 'extension', 'userscript', 'ui-resource.js'), {
    root: path.join(project, 'extension'), entryExports: ['mountSettingsForm'],
  });
  const resource = { name: 'duallens-settings', file: 'duallens-settings.js', bytes: Buffer.byteLength(settings),
    sha256: createHash('sha256').update(settings).digest('hex'),
    url: `https://github.com/ray-oriental/duallens/releases/download/v${manifest.version}/duallens-settings.js` };
  const bundle = await buildBundle(path.join(project, 'extension', 'userscript', 'entry.js'), { root: path.join(project, 'extension') });
  const marker = "'__DUALLENS_SETTINGS_RESOURCE__'";
  if (bundle.split(marker).length !== 2) throw new Error('Settings resource descriptor placeholder missing or duplicated');
  const content = metadata(manifest.version, [resource]) + bundle.replace(marker, JSON.stringify(resource));
  if(Buffer.byteLength(content)>340000) throw new Error('Userscript exceeds the 340 KB startup budget');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(path.join(path.dirname(output), resource.file), settings, 'utf8');
  await fs.writeFile(output, content, 'utf8');
  return { output, bytes: Buffer.byteLength(content), version: manifest.version, resource };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--output')) throw new Error('Usage: node scripts/build_userscript.mjs [--output path]');
    const result = await buildUserscript(args.length ? { output: path.resolve(args[1]) } : {});
    console.log(`PASS userscript v${result.version}: ${result.bytes} bytes; settings resource: ${result.resource.bytes} bytes; syntax valid`);
  } catch (error) { console.error(`FAIL userscript: ${error.message}`); process.exitCode = 1; }
}
