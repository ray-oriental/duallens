"""Mock-only input/selection/hover acceptance on MV3 and the unchanged userscript bundle.
Uses isolated staged profiles and test-only closed-shadow instrumentation; never real services.
"""
import json
import uuid
from playwright.sync_api import sync_playwright
import run_e2e as e2e
from run_userscript_e2e import STUB
from trusted_input import touch_hold

ROOTS = """(() => {
  const roots=[]; const attach=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(init){const root=attach.call(this,init);if(this.localName==='dl-ui')roots.push({host:this,root});return root;};
  globalThis.__inputFixture={elements:s=>roots.filter(r=>r.host.isConnected).flatMap(r=>[...r.root.querySelectorAll(s)])};
})();"""
PASSED = []

FIELDS = """() => {
  const area=document.createElement('section');area.id='input-fixtures';
  for(const [tag,id] of [['textarea','controlled'],['input','single'],['div','rich'],['div','editor'],['div','reject']]) {
    const n=document.createElement(tag);n.id=id;if(tag==='div')n.contentEditable='true';
    n.style.cssText='display:block;min-height:44px;white-space:pre-wrap';area.append(n);
  }
  document.body.prepend(area);
  const field=document.querySelector('#controlled'), proto=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
  // A React-style own setter is deliberately bypassed; input must update the owner's state.
  Object.defineProperty(field,'value',{get(){return proto.get.call(this);},set(){throw Error('use native setter');},configurable:true});
  field.addEventListener('input',()=>{field.dataset.accepted=field.value;});
  for(const id of ['editor','reject']) {
    const el=document.getElementById(id);el.textContent='LEFT hello RIGHT';let accepted=el.textContent;
    el.addEventListener('input',()=>queueMicrotask(()=>{if(el.textContent!==accepted)el.textContent=accepted;}));
    el.addEventListener('beforeinput',e=>{
      e.preventDefault();
      if(id==='reject')return;
      const sel=getSelection();const range=sel.getRangeAt(0);range.deleteContents();range.insertNode(document.createTextNode(e.data));
      accepted=el.textContent;el.dataset.accepted=accepted;
    });
  }
}"""


class Harness:
    def __init__(self, page, mode, session=None):
        self.page, self.mode, self.session = page, mode, session
        if session:
            self.cdp = session.ctx.new_cdp_session(page)
            contexts = []
            self.cdp.on('Runtime.executionContextCreated', lambda e: contexts.append(e['context']))
            self.cdp.send('Runtime.enable')
            self.context_id = next(c['id'] for c in contexts if self.cdp.send('Runtime.evaluate', {'contextId': c['id'], 'expression': 'typeof __inputFixture'})['result'].get('value') == 'object')

    def ui(self, code):
        if self.mode == 'extension':
            result = self.cdp.send('Runtime.evaluate', {'contextId': self.context_id, 'expression': '(' + code + ')(__inputFixture)', 'returnByValue': True, 'awaitPromise': True})
            assert 'exceptionDetails' not in result, result.get('exceptionDetails')
            return result['result'].get('value')
        return self.page.evaluate("code=>Function('f','return ('+code+')(f)')(__platformFixture)", code)

    def settings(self, patch):
        if self.session:
            self.session.settings(patch)
        else:
            self.page.evaluate('p=>__platformFixture.settings(p)', patch)
        self.page.wait_for_timeout(220)

    def command(self):
        if self.session:
            self.session.command('translate-input')
        else:
            self.page.evaluate("()=>__platformFixture.command('翻译当前输入框')")

    def field(self, selector, text, selection=None):
        self.page.eval_on_selector(selector, """(el,{text,selection})=>{
          if(el.tagName==='DIV')el.textContent=text;
          else Object.getOwnPropertyDescriptor(el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(el,text);
          el.focus();if(selection){if(el.tagName==='DIV'){const r=document.createRange();r.setStart(el.firstChild,selection[0]);r.setEnd(el.firstChild,selection[1]);const s=getSelection();s.removeAllRanges();s.addRange(r);}else el.setSelectionRange(...selection);}
          else if(el.tagName!=='DIV')el.setSelectionRange(text.length,text.length);
        }""", {'text': text, 'selection': selection})

    def wait_value(self, selector, expected):
        self.page.wait_for_function("({selector,expected})=>{const el=document.querySelector(selector);return (el.value??el.innerText)===expected;}", arg={'selector': selector, 'expected': expected}, timeout=6000)

    def wait_ui(self, predicate):
        for _ in range(60):
            if self.ui(predicate):
                return
            self.page.wait_for_timeout(100)
        raise AssertionError('Timed out waiting for UI: ' + predicate)


def cases(h, calls):
    p = h.page
    count = 0

    def passed(name):
        nonlocal count
        count += 1
        PASSED.append((h.mode, name))
        print(f'PASS input {h.mode} {name}', flush=True)

    # No real input has occurred since navigation, including on the touch fixture.
    h.settings({'selection': {'enabled': True, 'showIcon': False}})
    before = len(calls())
    p.evaluate("""()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#p-bold'));
      getSelection().removeAllRanges();getSelection().addRange(r);
      for(const type of ['mouseup','keyup','pointerup'])document.dispatchEvent(type==='keyup'
        ?new KeyboardEvent(type,{bubbles:true,key:'ArrowRight',shiftKey:true})
        :type==='pointerup'?new PointerEvent(type,{bubbles:true,pointerType:'touch',isPrimary:true})
        :new MouseEvent(type,{bubbles:true,button:0}));}""")
    p.wait_for_timeout(650)
    assert not h.ui("f=>f.elements('.card.show,.icon.show').length")
    assert len(calls()) == before
    passed('synthetic_selection_no_icon_no_card_or_request')
    p.mouse.up()
    h.wait_ui("f=>f.elements('.card.show .dst').some(e=>e.textContent.startsWith('【译】'))")
    passed('trusted_mouseup_direct_selection')
    p.keyboard.press('Escape')
    h.settings({'selection': {'showIcon': True}})
    if h.mode == 'userscript':
        box = p.locator('#p-bold').bounding_box()
        p.touchscreen.tap(box['x'] + 5, box['y'] + 5)
        p.evaluate("""()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#p-bold'));
          getSelection().removeAllRanges();getSelection().addRange(r);}""")
        p.wait_for_function("()=>__platformFixture.elements('.icon.show').length===1")
        passed('trusted_touch_allows_following_selectionchange')
        p.keyboard.press('Escape')

    h.settings({'input': {'mode': 'bilingual', 'order': 'source-first', 'profileId': '', 'model': ''}})
    h.field('#controlled', 'hello'); h.command()
    h.wait_value('#controlled', 'hello\n【译】hello')
    assert p.locator('#controlled').get_attribute('data-accepted') == 'hello\n【译】hello'
    passed('bilingual_newline_controlled_setter')
    h.settings({'input': {'order': 'translation-first'}})
    h.field('#single', 'hello'); h.command(); h.wait_value('#single', '【译】hello hello')
    passed('bilingual_single_space_reverse')
    h.field('#controlled', 'LEFT hello RIGHT', [5, 10]); h.command()
    h.wait_value('#controlled', 'LEFT 【译】hello\nhello RIGHT')
    passed('partial_outside_unchanged')

    # Plain contenteditable keeps the exact unselected sibling nodes and attributes.
    h.settings({'input': {'order': 'source-first'}})
    p.eval_on_selector('#rich', """el=>{el.replaceChildren();for(const t of ['LEFT ','hello',' RIGHT']){const s=document.createElement('span');s.textContent=t;el.append(s);}el.firstChild.dataset.keep='yes';window.__outside=[el.firstChild,el.lastChild];el.focus();const r=document.createRange();r.selectNodeContents(el.children[1]);getSelection().removeAllRanges();getSelection().addRange(r);}""")
    h.command(); h.wait_value('#rich', 'LEFT hello\n【译】hello RIGHT')
    assert p.eval_on_selector('#rich', "el=>el.firstChild===__outside[0]&&el.lastChild===__outside[1]&&el.firstChild.dataset.keep==='yes'")
    passed('contenteditable_bilingual_preserves_outside_nodes')

    h.settings({'input': {'mode': 'replace'}})
    h.field('#editor', 'LEFT hello RIGHT', [5, 10]); h.command()
    h.wait_value('#editor', 'LEFT 【译】hello RIGHT')
    assert p.locator('#editor').get_attribute('data-accepted') == 'LEFT 【译】hello RIGHT'
    passed('beforeinput_editor_readback')

    h.field('#reject', 'LEFT hello RIGHT', [5, 10]); h.command()
    p.wait_for_timeout(350)
    assert p.locator('#reject').inner_text() == 'LEFT hello RIGHT'
    assert h.ui("f=>f.elements('.failure textarea').some(e=>e.value==='【译】hello')")
    assert h.ui("f=>f.elements('.failure').some(e=>e.textContent.includes('未写回译文'))")
    passed('all_strategies_rejected_explicit_copy_fallback')
    h.ui("f=>f.elements('.failure button').find(b=>b.textContent==='关闭').click()")

    # A fake OpenAI transport is delayed, and records only model/endpoint identity.
    profile = {'id': 'interaction-test', 'name': 'Interaction fixture', 'kind': 'openai', 'baseUrl': 'https://input.duallens.invalid/v1', 'model': 'base-model', 'fallbackModels': [], 'jsonMode': True, 'maxItems': 20, 'maxChars': 4000, 'concurrency': 2, 'timeoutMs': 5000}
    # This regression tests editor behavior with a previously confirmed fake destination.
    # First-send blocking and dismissal have their own page_ui acceptance runner.
    if h.session:
        h.session.sw_eval("() => chrome.storage.local.set({'ui.device':{acked:['llm:https://input.duallens.invalid']}})")
    else:
        p.evaluate("() => GM_setValue('duallens:local',{...__platformFixture.data('duallens:local'),'ui.device':{acked:['llm:https://input.duallens.invalid']}})")
    if h.session:
        profiles = h.session.sw_eval("async()=>(await chrome.storage.local.get('settings.core'))['settings.core'].provider.profiles")
    else:
        profiles = p.evaluate("()=>__platformFixture.data('duallens:local')['settings.core'].provider.profiles")
    h.settings({'provider': {'profiles': [*profiles, profile], 'active': 'mock', 'chain': [{'profileId': 'mock', 'model': 'mock'}]},
                'translation': {'mode': 'mt+llm', 'mt': {'engine': 'mock'}},
                'input': {'profileId': 'interaction-test', 'model': 'input-model'}})
    h.field('#single', 'identity input'); h.command(); h.wait_value('#single', '【译】identity input')
    assert any(c['model'] == 'input-model' and c['url'] == 'https://input.duallens.invalid/v1/chat/completions' for c in calls())
    passed('input_service_identity_overrides_mixed_mt')

    h.settings({'input': {'enabled': True, 'trigger': 'triple-space'}})
    before = len(calls()); h.field('#single', 'synthetic space fixture')
    p.eval_on_selector('#single', """el=>{for(let i=0;i<3;i++)
      el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:' ',code:'Space'}));}""")
    p.wait_for_timeout(650)
    assert len(calls()) == before
    assert p.locator('#single').input_value() == 'synthetic space fixture'
    passed('synthetic_triple_space_no_request_or_writeback')
    for _ in range(3):
        p.keyboard.press('Space')
    h.wait_value('#single', '【译】synthetic space fixture')
    assert len(calls()) > before
    passed('trusted_triple_space_translates')

    h.field('#single', 'waiting'); h.command(); p.locator('#single').press('End'); p.locator('#single').press('x'); p.wait_for_timeout(450)
    assert p.locator('#single').input_value() == 'waitingx'
    passed('continued_typing_no_overwrite')
    h.field('#single', 'edit then undo'); h.command()
    p.eval_on_selector('#single', "el=>{el.value+='x';el.dispatchEvent(new InputEvent('input',{bubbles:true}));el.value=el.value.slice(0,-1);el.dispatchEvent(new InputEvent('input',{bubbles:true}));}")
    p.wait_for_timeout(450); assert p.locator('#single').input_value() == 'edit then undo'
    passed('input_revision_survives_undo')
    before = len(calls()); h.field('#single', 'IME text')
    p.eval_on_selector('#single', "el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))")
    h.command()
    for _ in range(3):
        p.keyboard.press('Space')
    p.wait_for_timeout(200); assert len(calls()) == before
    p.eval_on_selector('#single', "el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
    assert p.locator('#single').input_value() == 'IME text   '
    h.field('#single', 'IME text')
    h.command(); h.wait_value('#single', '【译】IME text')
    passed('IME_blocks_command_and_triple_space_then_recovers')

    h.field('#single', 'composition during wait'); h.command()
    p.eval_on_selector('#single', "el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));}")
    p.wait_for_timeout(450); assert p.locator('#single').input_value() == 'composition during wait'
    passed('composition_during_request_discards_late_result')
    h.field('#single', 'deliberate failure'); h.command(); p.wait_for_timeout(450)
    assert p.locator('#single').input_value() == 'deliberate failure'
    passed('failed_translation_no_writeback')

    h.settings({'hover': {'enabled': True, 'modifier': 'Shift', 'profileId': 'interaction-test', 'model': 'hover-model'}})
    p.evaluate('()=>{document.activeElement.blur();getSelection().removeAllRanges();}')
    before = len(calls())
    p.eval_on_selector('#p-plain', """el=>{const r=el.getBoundingClientRect();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true,bubbles:true}));
      el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,shiftKey:true,clientX:r.x+10,clientY:r.y+10}));
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true,pointerId:91}));}""")
    p.wait_for_timeout(700)
    assert len(calls()) == before and p.locator('#p-plain dl-t').count() == 0
    passed('synthetic_shift_move_and_touch_no_hover_request')
    if h.mode == 'extension':
        # Isolate the key and move gates: a trusted pointer must not make a fake key real,
        # nor may a real held modifier authorize a page-script move to another paragraph.
        p.locator('#p-plain').hover()
        p.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true,bubbles:true}))")
        p.wait_for_timeout(450)
        assert len(calls()) == before and p.locator('#p-plain dl-t').count() == 0
        passed('trusted_pointer_synthetic_shift_no_hover_request')
        p.keyboard.down('Shift')
        try:
            p.wait_for_function("()=>document.querySelector('#p-plain dl-t[data-dl-state=done]')")
            passed('trusted_pointer_and_shift_translate')
            before = len(calls())
            p.eval_on_selector('#p-bold', """el=>{const r=el.getBoundingClientRect();
              el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,shiftKey:true,clientX:r.x+10,clientY:r.y+10}));}""")
            p.wait_for_timeout(450)
            assert len(calls()) == before and p.locator('#p-bold dl-t').count() == 0
            passed('trusted_shift_synthetic_move_no_hover_request')
        finally:
            p.keyboard.up('Shift')
    h.settings({'hover': {'modifier': 'none'}})
    p.locator('#p-plain').hover()
    if h.mode == 'userscript':
        touch_hold(p, '#p-plain')
    p.wait_for_function("()=>document.querySelector('#p-plain dl-t[data-dl-state=done]')")
    assert any(c['model'] == 'hover-model' for c in calls())
    passed('hover_service_identity')

    if h.session:
        h.session.msg({'type': 'translate-selection', 'text': 'selection service'})
    else:
        p.eval_on_selector('#p-bold', "el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);}")
        p.mouse.up()
        p.wait_for_timeout(80)
        h.ui("f=>f.elements('.icon').find(e=>e.classList.contains('show')).click()")
    p.wait_for_timeout(150)
    h.ui("f=>{const a=f.elements('[aria-label=划词服务]')[0],b=f.elements('[aria-label=划词模型]')[0];a.value='interaction-test';a.dispatchEvent(new Event('change'));b.value='selection-model';f.elements('.services .retry')[0].click();}")
    p.wait_for_timeout(450)
    assert any(c['model'] == 'selection-model' for c in calls())
    assert h.ui("f=>f.elements('.dst').some(e=>e.textContent.startsWith('【译】'))")
    passed('selection_temporary_service_model_identity')
    if h.session:
        stored = h.session.sw_eval("async()=>(await chrome.storage.local.get('settings.core'))['settings.core'].provider")
    else:
        stored = p.evaluate("()=>__platformFixture.data('duallens:local')['settings.core'].provider")
    assert stored['active'] == 'mock' and stored['chain'] == [{'profileId': 'mock', 'model': 'mock'}]
    assert p.locator('#single').input_value() == 'deliberate failure', 'Failed request wrote a late result'
    assert 'sk-test-not-real' not in p.content()
    passed('page_chain_unchanged_no_key_in_page')
    if h.mode == 'userscript':
        p.evaluate("()=>__platformFixture.command('DualLens 设置')")
        p.wait_for_function("()=>__platformFixture.elements('#inputMode').length")
        h.ui("""f=>{for(const [id,value] of Object.entries({inputMode:'bilingual',inputOrder:'translation-first',inputProfile:'interaction-test',inputModel:'saved-input',hoverProfile:'interaction-test',hoverModel:'saved-hover'})){const el=f.elements('#'+id)[0];el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}f.elements('#save')[0].click();}""")
        p.wait_for_function("()=>__platformFixture.data('duallens:local')['settings.core'].input.model==='saved-input'")
        stored = p.evaluate("()=>__platformFixture.data('duallens:local')['settings.core']")
        assert stored['input']['mode'] == 'bilingual' and stored['input']['order'] == 'translation-first'
        assert stored['hover']['profileId'] == 'interaction-test' and stored['hover']['model'] == 'saved-hover'
        assert p.evaluate('()=>document.documentElement.scrollWidth<=innerWidth')
        p.keyboard.press('Escape')
        passed('mobile_settings_resource_saves_all_new_fields')

    # A genuine failed paragraph supplies a retry marker in page-controlled DOM.
    h.settings({'hover': {'enabled': False}, 'selection': {'enabled': False},
                'provider': {'active': 'interaction-test', 'chain': [{'profileId': 'interaction-test', 'model': 'retry-model'}]},
                'translation': {'mode': 'llm'},
                'siteRules': {'custom': [{'match': '127.0.0.1/*', 'include': '#trusted-retry'}]}})
    p.evaluate("""()=>{const el=document.createElement('p');el.id='trusted-retry';
      el.textContent='deliberate failure for trusted retry';document.body.prepend(el);}""")
    if h.session:
        h.session.command('toggle-page')
    else:
        p.evaluate("()=>__platformFixture.command('翻译 / 恢复当前页面')")
    marker = p.locator('#trusted-retry dl-r')
    marker.wait_for()
    p.wait_for_timeout(500)
    before = len(calls())
    marker.evaluate("""el=>{el.click();for(const key of ['Enter',' '])
      el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key}));}""")
    p.wait_for_timeout(700)
    assert len(calls()) == before
    assert p.locator('#trusted-retry dl-t[data-dl-state=error] dl-r').count() == 1
    passed('synthetic_inline_retry_click_and_keys_no_request')
    marker.click()
    p.wait_for_timeout(700)
    assert len(calls()) > before
    passed('trusted_inline_retry_click_sends_request')
    before = len(calls())
    marker.focus(); p.keyboard.press('Enter'); p.wait_for_timeout(700)
    assert len(calls()) > before
    passed('trusted_inline_retry_enter_sends_request')
    return count


def main():
    server, base = e2e.start_fixtures()
    run = e2e.E2E_ROOT / ('run-input-' + uuid.uuid4().hex[:8]); run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run, e2e.EXT_SRC); assert not missing
    manifest = json.loads((ext / 'manifest.json').read_text(encoding='utf-8'))
    (ext / 'input-test-instrument.js').write_text(ROOTS, encoding='utf-8')
    manifest.setdefault('content_scripts', []).insert(0, {'matches': ['http://127.0.0.1/*'], 'js': ['input-test-instrument.js'], 'run_at': 'document_start'})
    (ext / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    total = failures = 0
    try:
        with sync_playwright() as pw:
            session = e2e.Session(pw, ext, base, 'input-acceptance')
            try:
                session.start()
                session.sw_eval("""()=>{globalThis.__inputCalls=[];globalThis.fetch=async(url,init)=>{
                  if(url!=='https://input.duallens.invalid/v1/chat/completions')throw Error('unexpected fixture endpoint');
                  const payload=JSON.parse(init.body);__inputCalls.push({url,model:payload.model});
                  const user=payload.messages.find(m=>m.role==='user').content;const input=JSON.parse(user.slice(user.indexOf('{'),user.lastIndexOf('}')+1)).t;
                  await new Promise(r=>setTimeout(r,160));
                  if(input.some(t=>t.includes('deliberate failure')))return new Response('{"error":{"message":"fixture failure"}}',{status:400});
                  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({t:input.map(t=>'【译】'+t)})}}]}),{status:200,headers:{'Content-Type':'application/json'}});
                };}""")
                session.open('article.html'); session.wait_ready(); session.page.evaluate(FIELDS)
                total += cases(Harness(session.page, 'extension', session), lambda: session.sw_eval('()=>__inputCalls'))
            except Exception:
                failures += 1; session.screenshot('input-extension-failure'); raise
            finally:
                session.close()

            profile = e2e.E2E_ROOT / ('profile-input-userscript-' + uuid.uuid4().hex[:8])
            ctx = pw.chromium.launch_persistent_context(str(profile), headless=True, locale="zh-CN", viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
            # Reuse canonical GM mock and add only request identities/delay/failure control.
            stub = STUB.replace("authCorrect:req.headers.Authorization==='Bearer sk-test-not-real'", "authCorrect:req.headers.Authorization==='Bearer sk-test-not-real',model:req.data?JSON.parse(req.data).model:null")
            stub = stub.replace('},30);', '},160);')
            stub = stub.replace('const payload=JSON.parse(req.data);', "const payload=JSON.parse(req.data);if(req.data.includes('deliberate failure')){req.onload({status:400,responseText:'fixture failure',responseHeaders:''});return;}")
            ctx.add_init_script(stub)
            ctx.add_init_script((e2e.REPO / 'dist/duallens.user.js').read_text(encoding='utf-8'))
            p = ctx.new_page()
            try:
                p.goto(base + '/article.html'); p.wait_for_function("()=>__platformFixture.hasCommand('翻译当前输入框')"); p.evaluate(FIELDS)
                total += cases(Harness(p, 'userscript'), lambda: p.evaluate('()=>__platformFixture.calls'))
            except Exception:
                failures += 1; p.screenshot(path=str(e2e.E2E_ROOT / 'input-userscript-failure.png')); raise
            finally:
                ctx.close(); e2e.remove_runtime_dir(profile)
    except Exception:
        failures = max(failures, 1)
        raise
    finally:
        server.shutdown(); e2e.remove_runtime_dir(run)
        print(f'SUMMARY input total={len(PASSED)+failures} PASS={len(PASSED)} FAIL={failures} SKIP=0', flush=True)


if __name__ == '__main__':
    main()
