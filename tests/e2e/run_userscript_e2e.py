#!/usr/bin/env python3
"""Offline userscript desktop/touch E2E, no extension or real provider.

Build first: node scripts/build_userscript.mjs
Run with the same Python/browser environment as run_e2e.py. Profiles and evidence remain
under DUALLENS_E2E_OUT (system temporary directory by default). GM/shadow instrumentation is test-only, outside the product bundle.
"""
from __future__ import annotations
import argparse
import json
import time
import traceback
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
from run_e2e import REPO, E2E_ROOT, start_fixtures, remove_runtime_dir, check

ARTIFACTS = E2E_ROOT / 'artifacts' / 'userscript'

STUB = r"""(() => {
  const data = new Map();
  const listeners = new Map();
  const commands = new Map();
  const roots = [];
  const calls = [];
  const tasks = [];
  const resourceReads = [];
  let resourceMode = 'valid';
  const settingsSource = '__DUALLENS_RESOURCE_TEXT__';
  window.GM_getResourceText = name => {
    resourceReads.push(name);
    if (resourceMode === 'throw') throw Error('fixture resource unavailable');
    if (resourceMode === 'missing' || name !== 'duallens-settings') return '';
    return resourceMode === 'tampered' ? settingsSource.replace('const ', 'let   ') : settingsSource;
  };
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = original.call(this, init);
    if (this.localName === 'dl-ui') roots.push({host:this,root});
    return root;
  };
  // Legacy cases exercise the LLM path; the machine-translation cases choose their own mode.
  data.set('duallens:sync', {settings:{version:3,provider:{active:'mock'},translation:{mode:'llm'},selection:{enabled:true},hover:{enabled:true},input:{enabled:true},floatBall:{enabled:true},comics:{enabled:true}}});
  window.GM_getValue = (key, fallback) => structuredClone(data.get(key) ?? fallback);
  window.GM_setValue = (key, value) => {
    const old = data.get(key); data.set(key,structuredClone(value));
    for (const cb of listeners.get(key) || []) cb(key,old,value,false);
  };
  window.GM_deleteValue = key => {
    const old = data.get(key); data.delete(key);
    for (const cb of listeners.get(key) || []) cb(key,old,{},false);
  };
  window.GM_addValueChangeListener = (key, cb) => {
    if(!listeners.has(key)) listeners.set(key,[]);
    listeners.get(key).push(cb);
    return listeners.get(key).length;
  };
  window.GM_registerMenuCommand = (label, fn) => commands.set(label,fn);
  window.GM_xmlhttpRequest = req => {
    // GM transport mock, never page fetch; exercise the real OpenAI adapter offline.
    calls.push({url:req.url,method:req.method,anonymous:req.anonymous,hasAuth:!!req.headers.Authorization,authCorrect:req.headers.Authorization==='Bearer sk-test-not-real'});
    if (req.url.startsWith('https://edge.microsoft.com/translate/translatetext')) {
      // The free Microsoft endpoint: a JSON array of strings in, translations out.
      const texts=JSON.parse(req.data); let gone=false;
      const timer=setTimeout(() => { if(!gone) req.onload({status:200,responseHeaders:'Content-Type: application/json',responseText:JSON.stringify(texts.map(t=>({translations:[{text:'【机翻】'+t}]})))}); },20);
      return {abort(){gone=true;clearTimeout(timer);req.onabort?.();}};
    }
    let stopped=false;
    const timer=setTimeout(() => {
      if(stopped)return;
      if(req.method==='GET') req.onload({status:200,responseText:JSON.stringify({data:req.url==='https://openrouter.ai/api/v1/models'
        ? ['a','b','c'].map(id=>({id:id+'/mock:free',name:id+' free',context_length:32000,pricing:{prompt:'0',completion:'0'},supported_parameters:['response_format']}))
        : [{id:'mock'}]}),responseHeaders:''});
      else {
        const payload=JSON.parse(req.data);
        const user=payload.messages.find(m=>m.role==='user').content;
        const input=JSON.parse(user.slice(user.indexOf('{'),user.lastIndexOf('}')+1));
        req.onload({status:200,responseHeaders:'Content-Type: application/json',responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({t:input.t.map(t=>'【译】'+t)})}}]})});
      }
    },30);
    return {abort(){stopped=true;clearTimeout(timer);req.onabort?.();}};
  };
  try { new PerformanceObserver(list => tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true}); } catch {}
  // This object is exclusively a fixture instrumentation surface, never emitted by the packer.
  window.__platformFixture = {
    command(label) { if(!commands.has(label))throw Error('Command unavailable'); return commands.get(label)(); },
    hasCommand:label=>commands.has(label),
    settings(patch) {
      const merge=(a,b)=>{const r=structuredClone(a||{});for(const[k,v]of Object.entries(b))r[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(r[k],v):v;return r;};
      const old=data.get('duallens:local')||{};
      const current={...old.settings,...old['settings.core'],glossary:old['settings.glossary'],...old['settings.sites']};
      const next=merge(current,patch),{glossary,siteRules,autoTranslateLangs,...core}=next;
      GM_setValue('duallens:local',{...old,'settings.core':core,'settings.glossary':glossary,'settings.sites':{siteRules,autoTranslateLangs}});
    },
    elements(selector) { return roots.filter(r=>r.host.isConnected).flatMap(r=>[...r.root.querySelectorAll(selector)]); },
    rect(selector) { const el=this.elements(selector).find(e=>getComputedStyle(e).display!=='none'); if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; },
    data(key) { return structuredClone(data.get(key)); },
    calls, tasks, resourceReads,
    resourceMode(mode) { resourceMode = mode; },
  };
})();"""

# Emulate the manager's install-time resource cache. No runtime request is made.
_settings_asset = REPO / 'dist' / 'duallens-settings.js'
STUB = STUB.replace("'__DUALLENS_RESOURCE_TEXT__'", json.dumps(
    _settings_asset.read_text(encoding='utf-8') if _settings_asset.is_file() else '', ensure_ascii=True))


def command(page, label):
    page.evaluate('label => __platformFixture.command(label)', label)


def rect(page, selector):
    return page.evaluate('s => __platformFixture.rect(s)', selector)


def click_shadow(page, selector):
    # Navigate the v1 grouped UI before exercising the actual pointer target.
    group = page.evaluate("s=>__platformFixture.elements(s)[0]?.closest('[data-group]')?.dataset.group", selector)
    if group:
        page.evaluate("g=>__platformFixture.elements('[data-group-link]').find(n=>n.dataset.groupLink===g)?.click()", group)
    page.evaluate("s => __platformFixture.elements(s)[0]?.scrollIntoView({block:'center'})", selector)
    r = rect(page, selector)
    check(bool(r), 'missing UI control: ' + selector)
    page.mouse.click(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)


def fill_shadow(page, label, value):
    # No production test hooks: fixture captures closed roots before bundle execution.
    page.evaluate("""({label,value}) => {
      const wrap=__platformFixture.elements('label').find(el=>el.firstChild?.textContent===label);
      const input=wrap.querySelector('input,select'); input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
    }""", {'label': label, 'value': value})


def secret_prompt(page, selector, value):
    handled = []
    def handle(dialog):
        check(dialog.type == 'prompt' and dialog.default_value == '', 'secret prompt must be native and never prefilled')
        handled.append(True)
        if value is None: dialog.dismiss()
        else: dialog.accept(value)
    page.once('dialog', handle)
    click_shadow(page, selector)
    check(len(handled) == 1, 'native secret dialog was not shown')


def wait_done(page, selector='#p-plain'):
    page.wait_for_function('(s) => document.querySelector(s)?.querySelector(\'dl-t[data-dl-state="done"]\')', arg=selector)


def select_text(page, selector='#p-plain'):
    return page.evaluate("""s => {
      const el=document.querySelector(s); const text=[...el.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(50,text.length));
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      const r=range.getBoundingClientRect();document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
      return {bottom:r.bottom,left:r.left};
    }""", selector)


def ready(page, base, fixture='article.html'):
    page.goto(base + '/' + fixture)
    page.wait_for_function("__platformFixture.hasCommand('翻译 / 恢复当前页面')")
    page.wait_for_function("!!__platformFixture.rect('.ball')")


def desktop_cases(page, base):
    ready(page, base)
    original = page.evaluate('document.body.outerHTML')
    command(page, '翻译 / 恢复当前页面'); wait_done(page)
    check('【译】' in page.locator('#p-plain dl-t').inner_text(), 'missing mock translation')
    check(page.locator('#p-links dl-t a').count() > 0, 'inline links were lost')
    command(page, '切换双语 / 仅译文')
    page.wait_for_function("document.querySelector('#p-plain').classList.contains('dl-only')")
    check(page.locator('#p-plain dl-o').evaluate("e=>getComputedStyle(e).display") == 'none', 'source remains visible')
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    check(page.evaluate('document.body.outerHTML') == original, 'restore is not DOM-identical')
    command(page, '切换双语 / 仅译文')
    select_text(page)
    page.wait_for_function("!!__platformFixture.rect('.icon.show')")
    click_shadow(page, '.icon.show')
    page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.startsWith('【译】'))")
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('form').length===1")
    fill_shadow(page, '目标语言', 'ja')
    click_shadow(page, 'button[type=submit]')
    page.wait_for_function("__platformFixture.data('duallens:local')['settings.core'].targetLang==='ja'")
    check(all(page.evaluate("[...document.querySelectorAll('dl-ui')].map(e=>e.shadowRoot===null)")), 'overlay must stay closed')
    page.keyboard.press('Escape')
    page.wait_for_function("__platformFixture.elements('form').length===0")
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#targetLang')[0]?.value==='ja'")
    check(page.evaluate('__platformFixture.resourceReads') == ['duallens-settings'], 'settings resource was not cached across opens')
    page.keyboard.press('Escape')
    # Dynamic fixture exercises timed appends and SPA updates using the same controller.
    ready(page, base, 'dynamic.html')
    command(page, '翻译 / 恢复当前页面')
    wait_done(page, '#dyn-1')
    page.locator('#nav-btn').click(); wait_done(page, '#spa-route-2-1')
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    return 'translation, exact restore, only mode, selection, settings, dynamic append/SPA'


def settings_resource_case(page, base):
    ready(page, base)
    check(page.evaluate('__platformFixture.resourceReads.length') == 0, 'settings resource read at startup')
    command(page, 'DualLens')
    page.wait_for_function("__platformFixture.elements('#onboard-skip').length===1")
    click_shadow(page, '#onboard-skip')
    page.wait_for_function("__platformFixture.elements('#toggle').some(e=>!e.disabled)")
    check(page.evaluate('__platformFixture.calls.length') == 0, 'popup sent text before a user action')
    click_shadow(page, '#toggle'); wait_done(page)
    click_shadow(page, '#toggle');page.wait_for_function("!document.querySelector('dl-t')")
    page.keyboard.press('Escape')
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('修改后'))")
    check(page.evaluate('__platformFixture.calls.length') == 0, 'opening settings made a network/model request')
    fill_shadow(page, '目标语言', 'ja'); click_shadow(page, '#save')
    page.wait_for_function("__platformFixture.data('duallens:local')['settings.core'].targetLang==='ja'")
    page.keyboard.press('Escape'); command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#targetLang')[0]?.value==='ja'")
    check(page.evaluate('__platformFixture.resourceReads') == ['duallens-settings'], 'resource cache not reused')
    for mode in ['missing', 'tampered', 'throw']:
        ready(page, base)
        page.evaluate('mode=>__platformFixture.resourceMode(mode)', mode)
        command(page, 'DualLens 设置')
        page.wait_for_function("__platformFixture.elements('*').some(e=>e.textContent.includes('重新安装用户脚本'))")
        check(page.evaluate('__platformFixture.elements("form").length') == 0, 'unverified form mounted')
        check(page.evaluate('__platformFixture.calls.length') == 0, 'resource failure made a network request')
        page.keyboard.press('Escape')
        page.evaluate("__platformFixture.resourceMode('valid')")
        command(page, 'DualLens 设置')
        page.wait_for_function("__platformFixture.elements('form').length===1")
        page.keyboard.press('Escape')
    return 'offline cache: lazy verified load, save/reopen, no network; missing/tampered/GM error show reinstall guidance and recover'


def machine_first_case(page, base):
    shots = E2E_ROOT / 'v04' / 'dev-engine'; shots.mkdir(parents=True, exist_ok=True)
    tag = 'userscript-%dx%d' % (page.viewport_size['width'], page.viewport_size['height'])
    ready(page, base)
    # A fresh install: no model, default mode. Machine translation answers through the anonymous GM transport.
    page.evaluate("() => __platformFixture.settings({provider:{active:'',chain:[]},translation:{mode:'mt+llm'}})")
    page.wait_for_timeout(300)
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("__platformFixture.elements('.confirm').length===1")
    check(page.evaluate('__platformFixture.calls.length') == 0, 'MT sent text before consent')
    click_shadow(page, '.confirm .primary'); wait_done(page)
    first = page.evaluate("() => { const t = document.querySelector('#p-plain dl-t'); return { text: t.textContent.trim(), stage: t.getAttribute('data-dl-stage') }; }")
    check(first['text'].startswith('【机翻】') and first['stage'] == 'final', 'no-LLM page translation is not a final machine translation: %r' % (first,))
    calls = page.evaluate('__platformFixture.calls')
    check(calls and all(c['anonymous'] and not c['hasAuth'] and c['url'].startswith('https://edge.microsoft.com/') for c in calls), 'machine translation must use anonymous, keyless GM requests: %r' % (calls[:2],))
    page.screenshot(path=str(shots / (tag + '-machine.png')))
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    # Now add a model: the LLM text replaces the machine draft in place.
    page.evaluate("() => __platformFixture.settings({provider:{active:'mock'}})")
    page.wait_for_timeout(300)
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("document.querySelector('#p-plain dl-t')?.getAttribute('data-dl-stage')==='final' && document.querySelector('#p-plain dl-t').textContent.startsWith('【译】')")
    page.wait_for_function("document.querySelectorAll('dl-t[data-dl-stage=draft]').length === 0")
    page.screenshot(path=str(shots / (tag + '-refined.png')))
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    # Exercise the actual closed-shadow refinement button, not just its backend message.
    select_text(page)
    page.wait_for_function("!!__platformFixture.rect('.icon.show')")
    click_shadow(page, '.icon.show')
    page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.startsWith('【机翻】'))")
    refine = 'button[title="用大模型精修这段译文"]'
    page.wait_for_function('(s) => !!__platformFixture.rect(s)', arg=refine)
    click_shadow(page, refine)
    page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.startsWith('【译】'))")
    page.keyboard.press('Escape')
    # The floating-ball input command also defaults to MT in mixed mode.
    page.locator('#ta').fill('Translate this message quickly.')
    page.locator('#ta').focus()
    command(page, '翻译当前输入框')
    page.wait_for_function("document.querySelector('#ta').value.startsWith('【机翻】')")
    return 'keyless GM machine translation, page refinement, selection refine button and MT input; screenshots in ' + str(shots)


def secret_transport_case(page, base):
    ready(page, base)
    page.evaluate("""() => {
      __platformFixture.settings({provider:{active:'custom',profiles:[{id:'custom',name:'Mock endpoint',kind:'openai',model:'mock',baseUrl:'https://mock.invalid/v1',concurrency:2,maxItems:12,maxChars:4000,timeoutMs:5000,jsonMode:false,fallbackModels:[]}]}});
    }""")
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('修改后'))")
    check(page.evaluate("__platformFixture.elements('#apiKey').length") == 0, 'userscript rendered a key input')
    secret_prompt(page, '#set-key', 'sk-test-not-real')
    click_shadow(page, 'button[type=submit]')
    page.wait_for_function("!!__platformFixture.data('duallens:local')?.secrets?.custom")
    check(page.evaluate("JSON.stringify(__platformFixture.data('duallens:local')['settings.core']).includes('sk-test')") is False, 'key leaked into public settings')
    check(page.evaluate("__platformFixture.elements('#key-status')[0].textContent") == '已设置', 'saved key status missing')
    click_shadow(page, '#test')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('连接正常'))")
    page.keyboard.press('Escape'); command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("__platformFixture.elements('.confirm').length || document.querySelector('dl-t[data-dl-state=done]')")
    if page.evaluate("__platformFixture.elements('.confirm').length"):
        click_shadow(page, '.confirm .primary')
    wait_done(page)
    check(page.evaluate('__platformFixture.calls.every(c=>c.anonymous&&c.hasAuth)') is True, 'GM transport was not anonymous/authenticated')
    check(page.evaluate('localStorage.length') == 0, 'host localStorage was used')
    check(page.evaluate("document.body.outerHTML.includes('sk-test')") is False, 'key leaked into document')
    return 'GM HTTP exercised; secret remains in GM local area; no DOM/public-settings key'


def assert_secret_private(page):
    check(page.evaluate("localStorage.length") == 0, 'host localStorage was used')
    check(page.evaluate("!document.documentElement.outerHTML.includes('sk-test-not-real')"), 'key leaked into page markup')
    check(page.evaluate("__platformFixture.elements('input,textarea').every(e=>!e.value.includes('sk-test-not-real'))"), 'key leaked into closed-root field value')
    check(page.evaluate("__platformFixture.elements('.dl-settings').every(e=>!e.outerHTML.includes('sk-test-not-real'))"), 'key leaked into panel markup')
    check(page.evaluate("""() => {
      const seen=new Set();
      const clean=v=>{
        if(typeof v==='string')return !v.includes('sk-test-not-real');
        if(!v||typeof v!=='object'||seen.has(v))return true;
        seen.add(v);
        const p=Object.getPrototypeOf(v);
        if(!Array.isArray(v)&&p!==Object.prototype&&p!==null)return true;
        return Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>!Object.hasOwn(d,'value')||clean(d.value));
      };
      return Object.values(Object.getOwnPropertyDescriptors(window)).every(d=>!Object.hasOwn(d,'value')||clean(d.value));
    }"""), 'key leaked into window or a reachable plain object')
    check(page.evaluate("!__platformFixture.calls.some(c=>JSON.stringify(c).includes('sk-test-not-real'))"), 'test transport recorded a key')


def openrouter_profile_case(page, base):
    ready(page, base)
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('修改后'))")
    page.evaluate("() => {const e=__platformFixture.elements('#providerPreset')[0];e.value='openrouter';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    click_shadow(page, '#preset-openrouter')
    page.wait_for_function("__platformFixture.elements('#profile')[0].value==='openrouter'&&!__platformFixture.elements('#set-key')[0].disabled")
    check(page.evaluate("__platformFixture.elements('input[type=password]').length") == 0, 'userscript rendered a secret/password input')
    # A hostile page hooks composed keyboard/paste events and replaces its window.prompt.
    # The product must continue calling the native binding captured in its sandbox.
    page.evaluate("""() => {
      window.__secretAudit={inputEvents:0,pagePromptCalls:0};
      for(const name of ['beforeinput','input','paste','keydown'])document.addEventListener(name,e=>{
        if(name!=='keydown'||e.key.length===1)__secretAudit.inputEvents++;
      },true);
      window.prompt=()=>{__secretAudit.pagePromptCalls++;throw new Error('Page prompt must not be used');};
    }""")
    secret_prompt(page, '#set-key', None)
    check(page.evaluate("__platformFixture.elements('#key-status')[0].textContent") == '未设置', 'cancel changed empty key')
    secret_prompt(page, '#set-key', 'sk-test-not-real')
    check(page.evaluate("__secretAudit.inputEvents===0&&__secretAudit.pagePromptCalls===0"), 'key input reached page event listeners or page prompt')
    assert_secret_private(page)
    click_shadow(page, '#load-models')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('获取到 3'))")
    click_shadow(page, '#test')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('连接正常'))")
    check(page.evaluate("!__platformFixture.data('duallens:local').secrets?.openrouter"), 'draft key saved before Save')
    click_shadow(page, '#save')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('已保存'))")
    saved = page.evaluate("__platformFixture.data('duallens:local')")
    check(saved['secrets']['openrouter']['apiKey'] == 'sk-test-not-real', 'missing GM secret')
    check(saved['settings.core']['provider']['active'] == 'openrouter', 'new preset not selected')
    check(len(saved['settings.core']['provider']['chain']) == 3, 'free-model fallback chain missing')
    for key in ['settings', 'settings.core', 'settings.glossary', 'settings.sites']:
        check('sk-test-not-real' not in json.dumps(saved[key]), 'key in public GM setting: ' + key)
    assert_secret_private(page)
    check(page.evaluate("__platformFixture.elements('#key-status')[0].textContent") == '已设置', 'saved key status missing')
    page.keyboard.press('Escape')
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('修改后'))")
    check(page.evaluate("__platformFixture.elements('#apiKey').length") == 0, 'stored key editor appeared on reopen')
    secret_prompt(page, '#set-key', None)
    check(page.evaluate("__platformFixture.elements('#key-status')[0].textContent") == '已设置', 'cancel changed saved key')
    click_shadow(page, '#test')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('连接正常'))")
    assert_secret_private(page)
    # Saving an unrelated field preserves the stored key; public export remains key-free.
    fill_shadow(page, '目标语言', 'ja'); click_shadow(page, '#save')
    page.wait_for_function("__platformFixture.data('duallens:local')['settings.core'].targetLang==='ja'")
    check(page.evaluate("__platformFixture.data('duallens:local').secrets.openrouter.apiKey") == 'sk-test-not-real', 'unedited key overwritten')
    secret_prompt(page, '#export', '')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('已导出'))")
    assert_secret_private(page)
    secret_prompt(page, '#export', 'e2e backup passphrase')
    page.wait_for_function("__platformFixture.elements('#backupText')[0].value.startsWith('duallens-config:v1:')")
    click_shadow(page, '#clear-key')
    check(page.evaluate("__platformFixture.data('duallens:local').secrets.openrouter.apiKey") == 'sk-test-not-real', 'clear happened before confirmation')
    click_shadow(page, '.confirmation button:last-child')
    click_shadow(page, '#save')
    page.wait_for_function("__platformFixture.data('duallens:local').secrets.openrouter.apiKey===''")
    check(page.evaluate("__platformFixture.elements('#key-status')[0].textContent") == '未设置', 'clear status missing')
    # Cancellation preserves the cleared state; native passphrase import restores the key.
    secret_prompt(page, '#import-button', None)
    check(page.evaluate("__platformFixture.data('duallens:local').secrets.openrouter.apiKey") == '', 'cancel import changed key')
    secret_prompt(page, '#import-button', 'e2e backup passphrase')
    page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('已导入'))")
    check(page.evaluate("__platformFixture.data('duallens:local').secrets.openrouter.apiKey") == 'sk-test-not-real', 'encrypted import lost key')
    assert_secret_private(page)
    calls = page.evaluate('__platformFixture.calls')
    check(all(c['anonymous'] for c in calls), 'GM requests sent page cookies')
    check(all(not c['hasAuth'] for c in calls if c['method'] == 'GET'), 'public OpenRouter discovery sent key')
    check(all(c['authCorrect'] for c in calls if c['method'] == 'POST'), 'saved/draft key not resolved by GM transport')
    page.keyboard.press('Escape')
    check(page.evaluate("__platformFixture.elements('.dl-settings').length") == 0, 'destroy left shared form attached')
    return 'native sandbox dialogs: set/cancel/clear/reopen, backup roundtrip; hostile page prompt/event hooks see no key; GM-only secrets'


def isolated_prompt_case(page, base):
    ready(page, base)
    # Remove the main-world test app, then poison page.prompt before loading the product
    # in a real Chromium isolated world. This covers hostile hooks predating boot.
    page.evaluate("__platformFixture.settings({siteRules:{never:['127.0.0.1']}})")
    page.wait_for_function("!__platformFixture.rect('.ball')")
    page.evaluate("""() => {
      window.__secretAudit={inputEvents:0,pagePromptCalls:0};
      for(const name of ['beforeinput','input','paste','keydown'])document.addEventListener(name,()=>__secretAudit.inputEvents++,true);
      window.prompt=()=>{__secretAudit.pagePromptCalls++;throw Error('Host page prompt intercepted');};
    }""")
    client = page.context.new_cdp_session(page)
    frame_id = client.send('Page.getFrameTree')['frameTree']['frame']['id']
    world = client.send('Page.createIsolatedWorld', {'frameId': frame_id, 'worldName': 'duallens-test-sandbox'})['executionContextId']
    def evaluate(expression):
        result = client.send('Runtime.evaluate', {'expression': expression, 'contextId': world, 'returnByValue': True, 'userGesture': True})
        check('exceptionDetails' not in result, 'isolated userscript evaluation failed')
        return result.get('result', {}).get('value')
    def wait(expression):
        deadline = time.time() + 15
        while time.time() < deadline:
            if evaluate(expression): return
            page.wait_for_timeout(50)
        check(False, 'isolated userscript condition timed out')
    evaluate(STUB + '\n' + (REPO / 'dist/duallens.user.js').read_text(encoding='utf-8'))
    wait("__platformFixture.hasCommand('DualLens 设置')")
    evaluate("__platformFixture.command('DualLens 设置')")
    wait("__platformFixture.elements('#status').some(e=>e.textContent.includes('修改后'))")
    evaluate("__platformFixture.elements('#providerPreset')[0].value='openrouter';__platformFixture.elements('#add-profile')[0].click()")
    wait("!__platformFixture.elements('#set-key')[0].disabled")
    dialogs = []
    def accept(dialog):
        check(dialog.type == 'prompt' and dialog.default_value == '', 'isolated native dialog is prefilled or wrong type')
        dialogs.append(True); dialog.accept('sk-test-not-real')
    page.once('dialog', accept)
    evaluate("__platformFixture.elements('#set-key')[0].click()")
    check(dialogs == [True], 'isolated world did not show a native prompt')
    evaluate("__platformFixture.elements('#model')[0].value='a/mock:free';__platformFixture.elements('#model')[0].dispatchEvent(new Event('change',{bubbles:true}));__platformFixture.elements('#save')[0].click()")
    wait("__platformFixture.data('duallens:local').secrets?.openrouter?.apiKey==='sk-test-not-real'")
    check(evaluate("__platformFixture.elements('input[type=password]').length===0"), 'isolated form rendered a password input')
    check(page.evaluate("__secretAudit.inputEvents===0&&__secretAudit.pagePromptCalls===0"), 'host page intercepted isolated secret input')
    assert_secret_private(page)
    client.detach()
    return 'unchanged bundle in Chromium isolated world; page.prompt poisoned before boot; native dialog and GM secret save succeed without page events'


def mobile_cases(page, base):
    ready(page, base)
    check(page.evaluate("matchMedia('(pointer: coarse)').matches"), 'device has no coarse pointer')
    target = page.locator('#p-plain'); target.scroll_into_view_if_needed(); box = target.bounding_box()
    client = page.context.new_cdp_session(page)
    x, y = box['x'] + 30, box['y'] + 10
    client.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    page.wait_for_timeout(600)
    client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    wait_done(page)
    # Moving/scrolling within the hold threshold cancels long-press.
    cancel_target = page.locator('#p-bold'); cancel_target.scroll_into_view_if_needed(); cancel_box = cancel_target.bounding_box()
    cx, cy = cancel_box['x'] + 30, cancel_box['y'] + 10
    client.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx, 'y': cy}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx, 'y': cy - 30}]})
    page.wait_for_timeout(600); client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    check(page.locator('#p-bold dl-t').count() == 0, 'scroll gesture triggered long-press translation')
    target.scroll_into_view_if_needed(); selected = select_text(page)
    page.wait_for_function("!!__platformFixture.rect('.icon.show')")
    icon = rect(page, '.icon.show')
    check(icon['y'] >= selected['bottom'] and icon['height'] >= 44 and icon['width'] >= 44, 'selection icon is not a 44px target below the selection')
    click_shadow(page, '.icon.show')
    page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.startsWith('【译】'))")
    page.keyboard.press('Escape')
    # Pointer event drag from one edge to the other, using actual touch input.
    before = rect(page, '.ball')
    x, y = before['x'] + 22, before['y'] + 22
    client.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 40, 'y': 160}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(100)
    after = rect(page, '.ball')
    check(after['x'] < 20 and abs(after['y'] - before['y']) > 30, 'ball touch drag did not persist/move')
    check(after['height'] >= 44, 'ball touch target too small')
    # Input action keeps the last focused field while tapping the more/menu controls.
    page.evaluate("()=>__platformFixture.settings({input:{enabled:false}})");page.wait_for_timeout(200)
    page.locator('#ta').fill('Hello from the current input box.'); page.locator('#ta').focus()
    ball=rect(page,'.ball'); x,y=ball['x']+22,ball['y']+22
    client.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    page.wait_for_timeout(550)
    client.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    page.wait_for_function("__platformFixture.elements('.menu.show').length===1")
    page.evaluate("()=>__platformFixture.elements('.menu.show .row').find(e=>e.textContent==='翻译当前输入框').click()")
    page.wait_for_function("document.querySelector('#ta').value.startsWith('【译】')")
    command(page, 'DualLens 设置'); page.wait_for_function("__platformFixture.elements('form').length===1")
    panel = rect(page, '.panel')
    if page.viewport_size['width'] < 600:
        check(panel['x'] == 0 and panel['y'] == 0 and panel['width'] == page.viewport_size['width'], 'narrow settings not fullscreen')
    fill_shadow(page, '目标语言', 'ja'); click_shadow(page, 'button[type=submit]')
    page.wait_for_function("__platformFixture.data('duallens:local')['settings.core'].targetLang==='ja'")
    page.keyboard.press('Escape')
    # Long-page metrics include translation start and the full viewport-by-viewport scroll.
    ready(page, base, 'long.html')
    start = page.evaluate('performance.now()'); command(page, '翻译 / 恢复当前页面')
    page.wait_for_timeout(1000)
    # Translation changes document height. Re-read it after each slice so "bottom" means
    # the actual final bottom, not the shorter pre-translation document's old height.
    scrolls = 0
    while page.evaluate('scrollY + innerHeight < document.documentElement.scrollHeight - 2'):
        check(scrolls < 600, 'long-page scroll did not converge')
        page.evaluate('scrollBy(0, innerHeight * .65)'); page.wait_for_timeout(250)
        scrolls += 1
    page.wait_for_function("[...document.querySelectorAll('p.lp')].every(p=>p.querySelector('dl-t[data-dl-state=done]'))")
    check(page.evaluate('scrollY + innerHeight >= document.documentElement.scrollHeight - 2'), 'did not reach the final page bottom')
    end = page.evaluate('performance.now()')
    metrics = page.evaluate("""({start,end}) => {
      const tasks=__platformFixture.tasks.filter(t=>t.start>=start&&t.start<=end);
      const ms=tasks.reduce((n,t)=>n+t.duration,0);
      return {over50ms:tasks.filter(t=>t.duration>50).length,maxMs:Math.max(0,...tasks.map(t=>t.duration)),longTaskMs:ms,observedMs:end-start,
        translated:document.querySelectorAll('dl-t[data-dl-state=done]').length,
        sourceParagraphs:document.querySelectorAll('p[id^=lp-]').length,nonLongTimeRatio:1-ms/(end-start)};
    }""", {'start': start, 'end': end})
    check(metrics['translated'] >= metrics['sourceParagraphs'], 'long-page scroll did not translate all paragraphs')
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    return metrics


def main():
    from site_rules_cases import userscript_case
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--only', action='append', default=[])
    args = ap.parse_args()
    bundle = REPO / 'dist' / 'duallens.user.js'
    check(bundle.is_file(), 'build dist/duallens.user.js first')
    cases = [('desktop', 1280, 800, False, desktop_cases), ('settings_resource', 1280, 800, False, settings_resource_case), ('secret_transport', 1280, 800, False, secret_transport_case),
             ('openrouter_profile', 1280, 800, False, openrouter_profile_case),
             ('isolated_prompt', 1280, 800, False, isolated_prompt_case),
             ('mobile_375', 375, 812, True, mobile_cases), ('tablet_800', 800, 1280, True, mobile_cases),
             ('machine_first', 1280, 800, False, machine_first_case), ('machine_first_375', 375, 812, True, machine_first_case),
             ('site_rules', 1280, 800, False, userscript_case), ('site_rules_375', 375, 812, True, userscript_case)]
    if args.only: cases = [c for c in cases if any(o in c[0] for o in args.only)]
    if not cases: print('no matching cases'); return 2
    E2E_ROOT.mkdir(parents=True, exist_ok=True); ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server, base = start_fixtures(); results = []
    try:
        with sync_playwright() as pw:
            for name, width, height, touch, fn in cases:
                profile = E2E_ROOT / ('profile-userscript-' + uuid.uuid4().hex[:8])
                context = None; started = time.time(); page = None
                try:
                    context = pw.chromium.launch_persistent_context(str(profile), headless=True,
                        viewport={'width': width, 'height': height}, has_touch=touch, is_mobile=touch,
                        args=['--no-first-run', '--no-default-browser-check'])
                    # Stub is installed before the real, unchanged artifact. No extension is loaded.
                    context.add_init_script(script=STUB)
                    context.add_init_script(path=str(bundle))
                    page = context.new_page(); page.set_default_timeout(15000)
                    detail = fn(page, base)
                    results.append({'name': name, 'status': 'PASS', 'detail': detail, 'seconds': round(time.time() - started, 2)})
                    print('PASS ' + name + ': ' + json.dumps(detail, ensure_ascii=False), flush=True)
                except Exception as exc:
                    detail = type(exc).__name__ + ': ' + str(exc)
                    results.append({'name': name, 'status': 'FAIL', 'detail': detail})
                    print('FAIL ' + name + ': ' + detail, flush=True)
                    traceback.print_exc(limit=5)
                    if page: page.screenshot(path=str(ARTIFACTS / (name + '.png')))
                finally:
                    if context: context.close()
                    remove_runtime_dir(profile)
    finally:
        server.shutdown()
    (ARTIFACTS / 'last-run.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    failed = sum(r['status'] == 'FAIL' for r in results)
    print(f"SUMMARY userscript total={len(results)} PASS={len(results)-failed} FAIL={failed} SKIP=0")
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
