import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildBundle, metadata, buildUserscript, compactSource } from '../../scripts/build_userscript.mjs';

async function fixture(files, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duallens-bundle-'));
  try { for (const [name, code] of Object.entries(files)) await fs.writeFile(path.join(root, name), code); return await fn(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('compaction preserves ASI, token boundaries, regex and template contents', () => {
  for (const newline of ['\n', '\r', '\u2028', '\u2029']) {
    const source = `function f() { return /* comment${newline} */ 42; }\nglobalThis.result = [f(), 1 /* gap */ + +2, /a[/*]b/.source, \`keep // text\`];`;
    const before = {}, after = {};
    vm.runInNewContext(source, before);
    vm.runInNewContext(compactSource(source), after);
    assert.equal(JSON.stringify(before.result), JSON.stringify(after.result));
  }
});

test('compaction preserves separated operators, nullish regex and return-newline ASI',()=>{
  const code="let x=1;const re=null ?? /a+/;function f(){return\n 42;}globalThis.result=[x + +2,x - -2,re.source,f(),1 .toString()];";
  const before={},after={};vm.runInNewContext(code,before);vm.runInNewContext(compactSource(code),after);
  assert.equal(JSON.stringify(after.result),JSON.stringify(before.result));
});

test('shared export helper preserves live function bindings',async()=>{
  await fixture({'dep.js':'export function value(){return 1;} export function change(){value=()=>2;}',
    'entry.js':'import * as dep from "./dep.js"; const a=dep.value(); dep.change(); globalThis.result=[a,dep.value()];'},async root=>{
    const c={};vm.runInNewContext(await buildBundle(path.join(root,'entry.js'),{root}),c);assert.deepEqual(Array.from(c.result),[1,2]);
  });
});

test('unused export getters are omitted while side effects and imported getters remain',async()=>{
  await fixture({'dep.js':'globalThis.effect=7; export const unusedGetterName=1; export const used=2;',
    'entry.js':'import {used} from "./dep.js";globalThis.result=used;'},async root=>{
    const bundle=await buildBundle(path.join(root,'entry.js'),{root});const c={};vm.runInNewContext(bundle,c);
    assert.equal(c.effect,7);assert.equal(c.result,2);assert.ok(!bundle.includes('"unusedGetterName":()=>'));
  });
});

test('bundler handles named, default, namespace, async and generator exports with isolated scope', async () => {
  await fixture({
    'dep.js': 'export const value = 3; export default function twice(x) { return x * 2; } export function* values() { yield value; } export async function answer() { return value; }',
    'other.js': 'const value = 9; export {value as other};',
    'entry.js': 'import {value as a, values} from "./dep.js"; import twice from "./dep.js"; import * as ns from "./other.js"; globalThis.result = [a,twice(a),ns.other,[...values()][0]];',
  }, async (root) => {
    const bundle = await buildBundle(path.join(root, 'entry.js'), { root });
    new Function(bundle); const context = {}; vm.runInNewContext(bundle, context);
    assert.deepEqual(Array.from(context.result), [3, 6, 9, 3]); assert.equal(context.__modules, undefined);
  });
});

test('strings, comments, regex and template text containing module keywords remain intact', async () => {
  await fixture({ 'entry.js': 'const text = "export import()"; const re = /import\\(\\)|export{}/; /* import("no") */ const t = `export ${"safe"}`; globalThis.result = [text,re.source,t];' }, async (root) => {
    const c = {}; vm.runInNewContext(await buildBundle(path.join(root, 'entry.js'), { root }), c);
    assert.equal(c.result[0], 'export import()'); assert.equal(c.result[2], 'export safe');
  });
});

for (const [label, source] of Object.entries({
  dynamic: 'import("./dep.js");', commented_dynamic: 'import /* gap */ ("./dep.js");',
  template_dynamic: 'const x = `${import("./dep.js")}`;', meta: 'const x = import.meta.url;',
  reexport: 'export { x } from "./dep.js";', export_star: 'export * from "./dep.js";',
  mutable: 'export let x = 1;', attributes: 'import x from "./dep.js" with {type:"json"};',
  external: 'import fs from "node:fs";', multi_const: 'export const x = 1, y = 2;',
  reserved: 'const __require = () => {};',
  await: 'await Promise.resolve();',
})) test(`unsupported syntax fails: ${label}`, async () => {
  await fixture({ 'entry.js': source, 'dep.js': 'export const x = 1; export default 1;' }, async (root) => {
    await assert.rejects(buildBundle(path.join(root, 'entry.js'), { root }));
  });
});

test('anonymous default function/class exports get a statement terminator', async () => {
  await fixture({
    'entry.js': 'import f from "./dep.js"; import C from "./class.js"; globalThis.result = f() + new C().n;',
    'dep.js': 'export default function() { return 2; } export const after = 1;',
    'class.js': 'export default class { n = 3; } export const after = 1;',
  }, async (root) => {
    const c = {}; vm.runInNewContext(await buildBundle(path.join(root, 'entry.js'), { root }), c); assert.equal(c.result, 5);
  });
});

test('missing exports and module cycles fail rather than silently breaking at runtime', async () => {
  await fixture({ 'entry.js': 'import {missing} from "./dep.js";', 'dep.js': 'export const x = 1;' }, async (root) => {
    await assert.rejects(buildBundle(path.join(root, 'entry.js'), { root }), /missing export/);
  });
  await fixture({ 'entry.js': 'import "./dep.js";', 'dep.js': 'import "./entry.js";' }, async (root) => {
    await assert.rejects(buildBundle(path.join(root, 'entry.js'), { root }), /cyclic/);
  });
});

test('real bundle is deterministic, contains inline CSS/required grants and passes new Function', async () => {
  await fixture({}, async (root) => {
    const a = await buildUserscript({ output: path.join(root, 'a.js') });
    const b = await buildUserscript({ output: path.join(root, 'b.js') });
    const content = await fs.readFile(a.output, 'utf8'); assert.equal(content, await fs.readFile(b.output, 'utf8'));
    new Function(content); assert.ok(content.includes('dl-s-muted'));
    assert.ok(content.includes('@sandbox      DOM'));
    assert.ok(Buffer.byteLength(content)<=360000,'ordinary startup bundle exceeds 360 KB');
    for (const module of ['ui/forms/qrcode.js', 'ui/forms/qrcodegen.js', 'vendor/pdfjs/', 'pdf/viewer.js', 'sidepanel/index.js', 'platform/extension.js']) {
      assert.ok(!content.includes('"' + module), `extension-only module was bundled: ${module}`);
    }
    assert.ok(content.includes('@grant        GM_getResourceText'));
    assert.equal((content.match(/^\/\/ @resource\s+/gm)||[]).length,2);
    assert.equal((content.match(/#sha256=[a-f0-9]{64}/g)||[]).length,2);
    const vendor=path.resolve('extension/vendor/tesseract');
    for(const file of ['worker.min.js','tesseract-core-simd-lstm.js']) assert.ok(!content.includes(await fs.readFile(path.join(vendor,file),'utf8')),'OCR source was inlined');
    for (const grant of ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_registerMenuCommand', 'GM_addValueChangeListener']) assert.ok(content.includes('@grant        ' + grant));
    assert.ok(content.includes('@version      ' + a.version)); assert.ok(content.includes('@noframes'));
    assert.throws(() => metadata('invalid'), /Invalid/);
  });
});
