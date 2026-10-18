import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, patternMatches as matches, comparePatterns, pathPattern } from '../../extension/shared/site-pattern.js';
import { DEFAULT_SETTINGS, mergeSettings, siteRuleFor, settingsForSite, setSitePageRule, createSettingsStore } from '../../extension/shared/settings.js';
import { memoryArea } from './storage-memory.mjs';
import { importSettings, safeExport } from '../../extension/ui/validation.js';
import { exportConfig, importConfig } from '../../extension/shared/configcrypto.js';

test('path patterns: protocol, subdomains, arbitrary stars, query and hash ignored', () => {
  for (const [pattern, url, expected] of [
    ['mail.sjtu.edu.cn/zimbra/*','https://mail.sjtu.edu.cn/zimbra/inbox?x=1#mail',true],
    ['*.example.com/checkout/*','https://example.com/checkout/pay',true],
    ['*.example.com/checkout/*','https://a.b.example.com/checkout/pay',true],
    ['*.example.com/checkout/*','https://badexample.com/checkout/pay',false],
    ['example.com/docs/*/api','https://example.com/docs/v1/deep/api',true],
    ['example.com/docs/*/api','https://example.com/docs/v1/api/',false],
    ['HTTPS://EXAMPLE.COM/Docs/*','https://example.com/Docs/x',true],
    ['https://example.com/Docs/*','http://example.com/Docs/x',false],
    ['example.com/Docs/*','https://example.com/docs/x',false],
    ['example.com/','https://example.com/?x=1',true],
    ['example.com/','https://example.com/x',false],
    ['example.com/docs/*','https://example.com/docs/',true],
    ['example.com/docs/*','https://example.com/docs',false],
    ['localhost:8080/a/*','http://localhost:8080/a/x',true],
    ['localhost:8080/a/*','http://localhost:8081/a/x',false],
    ['https://example.com:443/*','https://example.com/x',true],
    ['example.com/*','https://example.com:8443/x',true],
    ['[::1]:8080/*','http://[::1]:8080/x',true],
    ['example.com','file:///example.com',false],
  ]) assert.equal(matches(pattern,url),expected,pattern+' -> '+url);
});

test('invalid patterns are rejected rather than normalized into a broader rule', () => {
  for (const p of ['', '*', 'exa*mple.com', 'example..com', '-a.com', 'a-.com', 'example.com:0', 'example.com:65536',
    'ftp://example.com/x', 'https://a@b.com/x', 'example.com/path?q=x', 'example.com/path#x', 'example.com/a b',
    'example.com\\x', '127.1', '*.com:abc', '[::::]', '*.example.com/'+'x'.repeat(2048)]) {
    assert.equal(parsePattern(p),null,p); assert.equal(matches(p,'https://example.com/'),false,p);
  }
  assert.ok(parsePattern(' Example.COM/docs/* '));
});

test('specificity: longer literal paths, fewer stars, exact host, explicit port/protocol', () => {
  for (const [a,b] of [['example.com/mail/*','example.com'],['example.com/docs/*/api','example.com/docs/*'],
    ['example.com/docs/*','example.com/docs/**'],['example.com','*.example.com'],
    ['example.com:443','example.com'],['https://example.com','example.com']]) assert.ok(comparePatterns(a,b)>0,a);
});

test('old lists need no migration: never wins equal patterns and selectors remain independent', () => {
  const legacy = {siteRules:{always:['*.example.com'],never:['example.com'],custom:[{match:'*.example.com',include:'article'}]}};
  const s=mergeSettings(DEFAULT_SETTINGS,legacy);
  assert.equal(siteRuleFor(s,'example.com').mode,'never');
  assert.equal(siteRuleFor(s,'https://a.example.com/docs/x').mode,'always');
  assert.equal(siteRuleFor(s,'example.com').custom.include,'article');
  assert.deepEqual(legacy.siteRules.always,['*.example.com']);
});

const rules = {always:['*.example.com'],never:[],custom:[
  {match:'example.com/mail/*',page:'never',selection:'off',hover:'off',input:'off'},
  {match:'example.com/mail/public/*',page:'default',hover:'on'},
  {match:'example.com/articles/*',page:'always',selection:'on',hover:'default',input:'default'},
]};

test('one most-specific custom rule controls features; default inherits globals, never permits explicit work', () => {
  const s=mergeSettings(DEFAULT_SETTINGS,{siteRules:rules,selection:{enabled:false},floatBall:{enabled:true}});
  const mail=settingsForSite(s,'https://example.com/mail/x');
  for (const f of ['selection','hover','input','floatBall']) assert.equal(mail[f].enabled,false);
  assert.equal(siteRuleFor(s,'https://example.com/mail/x').mode,'never');
  const pub=settingsForSite(s,'https://example.com/mail/public/x');
  assert.equal(siteRuleFor(s,'https://example.com/mail/public/x').mode,null);
  assert.equal(pub.hover.enabled,true); assert.equal(pub.selection.enabled,false); assert.equal(pub.floatBall.enabled,true);
  assert.equal(settingsForSite(s,'https://example.com/articles/x').selection.enabled,true);
  assert.equal(s.floatBall.enabled,true); assert.equal(s.selection.enabled,false);
  assert.equal(mail.siteRules.custom[0].match,'example.com'); // legacy controller gets selected path selectors
});

test('path shortcut overrides exact old entry while retaining feature and selector data', () => {
  const s=mergeSettings(DEFAULT_SETTINGS,{siteRules:rules});
  assert.equal(pathPattern('https://example.com:8443/articles/x?y=z'),'example.com:8443/articles/*');
  assert.equal(pathPattern('https://example.com/'),'example.com/*');
  const next=setSitePageRule(s,'EXAMPLE.COM/mail/*',null);
  assert.equal(next.custom.length,rules.custom.length);
  assert.equal(next.custom[0].page,'default'); assert.equal(next.custom[0].hover,'off');
  assert.equal(siteRuleFor({...s,siteRules:next},'https://example.com/mail/x').mode,null);
  assert.equal(s.siteRules.custom[0].page,'never');
});

test('sync, plaintext and encrypted backups retain paths and feature flags; invalid rules fail before writes', async () => {
  const local=memoryArea(), sync=memoryArea(), store=createSettingsStore({localArea:local,syncArea:sync});
  const s=await store.save({siteRules:rules});
  assert.deepEqual(sync.data['settings.sites'].siteRules,rules);
  assert.equal(sync.data['settings.core'].siteRules,undefined);
  assert.deepEqual(importSettings(safeExport(s),s).siteRules,rules);
  const encrypted=await exportConfig(s,{password:'test-only-long-passphrase'});
  const imported=await importConfig(encrypted,'test-only-long-passphrase');
  assert.deepEqual(importSettings(imported.settings,s).siteRules,rules);
  const writes=sync.writes.length;
  await assert.rejects(store.save({siteRules:{always:['example.com/?x=1']}}),/站点模式无效/);
  await assert.rejects(store.save({siteRules:{custom:[{match:'example.com',hover:'invalid'}]}}),/须为开/);
  assert.equal(sync.writes.length,writes);
});
