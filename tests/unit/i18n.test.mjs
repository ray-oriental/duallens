import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, uiLanguage, setUiLanguage, localize, registerMessages } from '../../extension/shared/i18n.js';
import { messages } from '../../extension/shared/i18n-messages.js';
import { packLocale, unpackLocale, tokens, buildBundle } from '../../scripts/build_userscript.mjs';

const root = fileURLToPath(new URL('../../',import.meta.url));
const read = file => fs.readFile(path.join(root,file),'utf8');
const catalogue = async locale => JSON.parse(await read(`extension/_locales/${locale}/messages.json`));
const placeholders = text => [...text.matchAll(/\$\d+|\$[a-z_]\w*\$/gi)].map(m=>m[0]).sort();
const expand = record => record.message.replace(/\$(\w+)\$/g, (_,name) => record.placeholders?.[name.toLowerCase()]?.content ?? '');

test('both catalogues have identical keys and placeholders, with no empty messages', async()=>{
  const en=await catalogue('en'),zh=await catalogue('zh_CN');
  assert.deepEqual(await catalogue('zh_TW'),zh,'Chinese metadata alias must use Simplified Chinese');
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
  for(const key of Object.keys(en)) {
    assert.ok(en[key].message.trim(),`empty English: ${key}`);
    assert.ok(zh[key].message.trim(),`empty Chinese: ${key}`);
    assert.deepEqual(placeholders(en[key].message),placeholders(zh[key].message),key);
    assert.deepEqual(en[key].placeholders,zh[key].placeholders,`placeholder definitions: ${key}`);
    assert.deepEqual(messages[key],[expand(zh[key]),expand(en[key])],`fallback drift: ${key}`);
  }
  assert.equal(Object.keys(messages).length,Object.keys(en).length);
});

test('UI language defaults to Simplified Chinese even in an English browser; only auto follows it',()=>{
  const previous=globalThis.chrome;
  try {
    let calls=0;
    globalThis.chrome={i18n:{getUILanguage:()=> 'en-US',getMessage:()=>{calls++;return 'Native copy';}}};
    setUiLanguage('zh-CN');assert.equal(uiLanguage(),'zh-CN');assert.equal(t('m44'),messages.m44[0]);
    setUiLanguage('auto');
    for(const lang of ['zh','zh-CN','zh-TW','zh-HK','zh-Hant','zh_SG'])assert.equal(uiLanguage(lang),'zh-CN');
    for(const lang of ['en-US','fr','ja','de',''])assert.equal(uiLanguage(lang),'en');
    assert.equal(t('m44'),messages.m44[1]);
    setUiLanguage('zh-CN');assert.equal(t('m44'),messages.m44[0]);
    setUiLanguage('en');assert.equal(t('m44'),messages.m44[1]);assert.equal(uiLanguage('zh-CN'),'en');
    assert.equal(t('m7e',12),'Opened a 12-page PDF. Check the model settings, then click Translate.');
    assert.equal(calls,0,'native getMessage must never supply application UI copy');
  } finally {setUiLanguage('zh-CN');if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;}
});

test('HTML localization writes text and inert attributes without parsing markup',()=>{
  const node={dataset:{i18n:'m44'},set textContent(value){this.text=value;}},label={setAttribute(k,v){this[k]=v;},getAttribute(){return 'm44';}};
  const doc={documentElement:{},querySelectorAll(selector){return selector==='[data-i18n]'?[node]:selector==='[data-i18n-aria-label]'?[label]:[];}};
  localize(doc);assert.equal(node.text,t('m44'));assert.equal(label['aria-label'],t('m44'));assert.equal(doc.documentElement.lang,uiLanguage());
});

test('verified lazy UI copy supplements the startup dictionary as plain text',()=>{
  const previous=globalThis.chrome;
  try {
    globalThis.chrome={i18n:{getUILanguage:()=> 'en-US',getMessage:()=> ''}};
    setUiLanguage('en');
    registerMessages({lazyFixtureCopy:['延迟文案','<b>Lazy copy</b>'],invalidFixtureCopy:[42]});
    assert.equal(t('lazyFixtureCopy'),'<b>Lazy copy</b>');
    assert.equal(t('invalidFixtureCopy'),'invalidFixtureCopy');
  } finally {
    setUiLanguage('zh-CN');delete messages.lazyFixtureCopy;delete messages.invalidFixtureCopy;
    if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;
  }
});

test('data-only locale compression round-trips Unicode, substitutions and a full dictionary',()=>{
  assert.deepEqual(unpackLocale(packLocale(messages)),messages);
  assert.deepEqual(unpackLocale(packLocale({test:['中文 $1 😀','Text $1 <b>'] })),{test:['中文 $1 😀','Text $1 <b>']});
});

async function files(dir) {
  const result=[];
  for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})) {
    const file=dir+'/'+item.name;
    if(item.isDirectory())result.push(...await files(file));else result.push(file);
  }return result;
}

// These regular expressions classify webpage data, script ranges and translated error responses.
// They are not interface copy. Exact token values keep the exception list reviewable.
const DATA_REGEX_FILES = new Set(['extension/content/subtitles/json3.js']);
test('UI modules and static HTML have no hardcoded Chinese interface strings',async()=>{
  const source=[...await files('extension/ui'),...await files('extension/sidepanel'),...await files('extension/content'),'extension/pdf/viewer.js','extension/pdf/viewer.html'];
  const han=/[\u3400-\u9fff]/;
  for(const file of source) {
    if(!/\.(?:js|html)$/.test(file))continue;
    const text=await read(file);
    if(file.endsWith('.html')) {assert.ok(!han.test(text.replace(/<!--[\s\S]*?-->/g,'')),file);continue;}
    for(const token of tokens(text,file)) {
      const raw=text.slice(token.start,token.end);
      if(!han.test(raw))continue;
      if(token.kind==='regex'&&DATA_REGEX_FILES.has(file)) {
        assert.equal(raw,'/\\[(?:[^\\]]{0,80})\\]|\\((?:music|applause|laughter|laughing|silence|noise|音楽|音乐|掌声|笑声)\\)/gi');continue;
      }
      assert.fail(`hardcoded interface text: ${file}:${text.slice(0,token.start).split('\n').length}`);
    }
  }
});

test('all literal message references exist, including static HTML and manifest metadata',async()=>{
  const en=await catalogue('en');
  for(const file of await files('extension')) {
    if(!/\.(?:js|html|json)$/.test(file)||/\/vendor\//.test(file)||/\/_locales\//.test(file)||file.endsWith('i18n-messages.js'))continue;
    for(const match of (await read(file)).matchAll(/\b(?:t|l10n|message)\(\s*['"](\w+)['"]|data-i18n(?:-[\w-]+)?="(\w+)"|__MSG_(\w+)__/g)) {
      assert.ok(en[match[1]||match[2]||match[3]],`${file}: ${match[0]}`);
    }
  }
});

test('startup locale dictionary excludes onboarding/settings copy but lazy resource includes it',async()=>{
  const startup=await buildBundle(path.join(root,'extension/userscript/entry.js'),{root:path.join(root,'extension')});
  const lazy=await buildBundle(path.join(root,'extension/userscript/ui-resource.js'),{root:path.join(root,'extension'),entryExports:['mountSettingsForm']});
  const dictionary=bundle=>unpackLocale(bundle.match(/messages\s*=\s*unpackLocale\("([^"]+)"\)/)?.[1]);
  const initial=dictionary(startup),settings=dictionary(lazy);
  assert.ok(initial.m41&&initial.polishConsentAI,'content confirmation copy is present');
  assert.equal(initial.mik,undefined,'onboarding must be lazy');
  assert.equal(initial.mhy,undefined,'device transfer must be lazy');
  for (const key of ['m8u','m90','m8j','mk']) {
    assert.equal(initial[key],undefined,`settings metadata must be lazy: ${key}`);
    assert.ok(settings[key],`lazy resource is missing metadata: ${key}`);
  }
  assert.ok(settings.mik&&settings.mhy);
});
