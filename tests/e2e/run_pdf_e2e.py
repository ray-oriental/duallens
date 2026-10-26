"""PDF browser checks using the canonical staging/session helper.

Default run is mock-only: no account or model server; original fixtures are regenerated in the
E2E cache. Real-provider runs use run_acceptance.py and are reported separately.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import sys
import uuid
import time
import hashlib
import base64
import shutil
from urllib.parse import quote
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from threading import Thread

PROJECT = Path(__file__).resolve().parents[2]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, PROJECT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


e2e = load('duallens_pdf_e2e', 'tests/e2e/run_e2e.py')
fixture = load('duallens_pdf_fixture', 'tests/fixtures/generate_pdf.py')
math_fixture = load('duallens_pdf_math_fixture', 'tests/fixtures/generate_math_pdf.py')

LONG_TASKS = """() => { window.__pdfLong = []; try { new PerformanceObserver(list => {
  for (const entry of list.getEntries()) window.__pdfLong.push({ at: Math.round(entry.startTime), ms: Math.round(entry.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch {} }"""
# Translated blocks must stay inside their sheet and must not overlap each other.
LAYOUT_OK = """sel => { const sheet = document.querySelector(sel + ' .sheet.trans'); const s = sheet.getBoundingClientRect();
  const elements = [...sheet.querySelectorAll('.tb')];
  const boxes = elements.map(e => e.getBoundingClientRect());
  const inside = boxes.every(b => b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= s.top - 2 && b.bottom <= s.bottom + 2);
  const pairs = [];
  boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2)
    pairs.push({ids:[elements[i].dataset.id,elements[j].dataset.id], width:Math.min(a.right,b.right)-Math.max(a.left,b.left), height:Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top),
      boxes:[i,j].map(k=>({top:boxes[k].top-s.top,bottom:boxes[k].bottom-s.top,left:boxes[k].left-s.left,right:boxes[k].right-s.left,
        font:elements[k].style.fontSize,lineHeight:elements[k].style.lineHeight,atoms:[...elements[k].querySelectorAll('canvas')].map(c=>({width:c.style.width,height:c.style.height,align:c.style.verticalAlign}))}))}); }));
  return { count: boxes.length, inside, overlap: pairs.length > 0, pairs }; }"""


def wait_for(page, predicate, timeout=20):
    # Playwright 1.48 wait_for_function internally evaluates a source string on
    # each poll, which extension CSP can reject after a worker render. Call a
    # function via CDP directly instead; never weaken the extension CSP.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if page.evaluate(predicate):
            return
        page.wait_for_timeout(50)
    raise AssertionError('PDF condition timed out: ' + predicate)


def rendered(number):
    return f'() => document.querySelector(\'.pdf-page[data-page="{number}"]\')?.dataset.rendered === "true"'


class Handler(SimpleHTTPRequestHandler):
    requests = []

    def record(self):
        self.requests.append({'method': self.command, 'path': self.path,
                              'range': self.headers.get('Range'),
                              'cookie': bool(self.headers.get('Cookie')),
                              'authorization': bool(self.headers.get('Authorization'))})

    def log_message(self, *args):
        pass

    def do_HEAD(self):
        self.record()
        if self.path in ['/range-download', '/range-html']:
            self.send_response(405)
            self.end_headers()
            return
        if self.path == '/download':
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.end_headers()
        else:
            super().do_HEAD()

    def do_GET(self):
        self.record()
        if self.path == '/slow-pdf':
            time.sleep(1)
            self.path = '/pdf-field-notebook.pdf'
        if self.path in ['/range-download', '/range-html']:
            body = fixture.make_pdf() if self.path == '/range-download' else b'<html><body>Ordinary page</body></html>'
            partial = self.headers.get('Range') == 'bytes=0-1023'
            self.send_response(206 if partial else 200)
            self.send_header('Content-Type', 'application/pdf' if self.path == '/range-download' else 'text/html')
            self.send_header('Content-Length', str(min(len(body), 1024) if partial else len(body)))
            if partial:
                self.send_header('Content-Range', f'bytes 0-{min(len(body),1024)-1}/{len(body)}')
            self.end_headers()
            try:
                self.wfile.write(body[:1024] if partial else body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # The header-only probe intentionally cancels this body.
            return
        if self.path == '/download':
            self.path = '/pdf-field-notebook.pdf'
        super().do_GET()


def viewer(h, url, view=None, viewport=None):
    page = h.ctx.new_page()
    h.page = page
    if viewport:
        page.set_viewport_size(viewport)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    if view:
        page.add_init_script(f"try {{ localStorage.setItem('duallens.pdf.view', '{view}'); }} catch {{}}")
    page.add_init_script(f'({LONG_TASKS})()')
    page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file={quote(url, safe="")}')
    page.wait_for_timeout(600)
    if page.locator('#status.error').count():
        diagnostic = page.evaluate("""async url => {
          try {
            const {readPDFURL} = await import('./source.js');
            const lib = await import('../vendor/pdfjs/pdf.min.js');
            lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js',location.href).href;
            const data=await readPDFURL(url);
            const task=lib.getDocument({data,isEvalSupported:false});
            const pdf=await task.promise;
            await task.destroy();
            return {pages:pdf.numPages};
          } catch(e) { return {error:e.name+': '+e.message}; }
        }""", url)
        raise AssertionError(f'PDF initialization: {diagnostic}; page errors: {errors}')
    wait_for(page, "() => !!document.querySelector('.pdf-page[data-page=\"1\"] .reflow .rf')" if view == 'reflow' else rendered(1), 30)
    return page, errors


def pdf_consent(h):
    profile={'id':'consent','kind':'openai','name':'Offline consent fixture','baseUrl':'https://consent.example/v1',
             'model':'fixture','requiresKey':False,'fallbackModels':[]}
    h.settings({'provider':{'active':'consent','profiles':[profile],'chain':[]},'translation':{'mode':'llm'}})
    h.sw_eval("""()=>{globalThis.pdfConsentCalls=0;const original=globalThis.fetch;
      globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://consent.example/')){
        pdfConsentCalls++;const messages=JSON.parse(init.body).messages;const user=messages.find(m=>m.role==='user').content;
        const input=JSON.parse(user.slice(user.indexOf('{'),user.lastIndexOf('}')+1));
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({t:input.t.map(t=>'【译】'+t)})}}]}),{status:200,headers:{'content-type':'application/json'}});
      }return original(url,init);};}""")
    h.ctx.add_init_script("""(()=>{window.consentRoots=[];const attach=Element.prototype.attachShadow;
      Element.prototype.attachShadow=function(opts){const root=attach.call(this,opts);consentRoots.push(root);return root;};})();""")
    page,errors=viewer(h,h.base+'/pdf-field-notebook.pdf','side')
    assert 'consent.example' in page.locator('#privacy').inner_text()
    # Call the worker directly to prove the reader cannot bypass the network guard.
    refusal=page.evaluate("()=>chrome.runtime.sendMessage({type:'translate-text',purpose:'pdf',text:'Synthetic PDF text'})")
    assert refusal['error']['code']=='confirmation-required'
    assert refusal['error']['destination']['id']=='llm:https://consent.example'
    assert h.sw_eval('()=>pdfConsentCalls')==0
    before=page.locator('#pdf-pages').inner_html()
    page.click('#translate')
    wait_for(page,"()=>consentRoots.some(r=>r.querySelector('.confirm'))")
    assert page.locator('.tb,.tb-wait,.rf-t').count()==0
    assert h.sw_eval('()=>pdfConsentCalls')==0
    page.evaluate("()=>consentRoots.find(r=>r.querySelector('.confirm')).querySelector('.close').click()")
    page.wait_for_timeout(200)
    assert page.locator('#pdf-pages').inner_html()==before
    page.click('#translate')
    wait_for(page,"()=>consentRoots.some(r=>r.querySelector('.confirm'))")
    page.evaluate("()=>consentRoots.find(r=>r.querySelector('.confirm')).querySelector('.primary').click()")
    page.locator('.tb[data-stage=final]').first.wait_for(timeout=20000)
    assert h.sw_eval('()=>pdfConsentCalls')>0
    assert not errors,errors
    return 'worker refuses PDF sends with zero network; reader discloses actual destination; close preserves DOM; consent retries successfully'


def pdf_reading(h):
    page, errors = viewer(h, h.base + '/pdf-field-notebook.pdf', 'side')
    page.wait_for_timeout(500)
    first = '.pdf-page[data-page="1"]'
    assert page.locator('.pdf-page').count() == 8
    assert page.locator('.pdf-page[data-page="8"] canvas').count() == 0, 'Distant page rendered eagerly'
    assert page.locator('.tb,.rf-t').count() == 0, 'PDF translated without opt-in'
    assert page.locator(first + ' .sheet.orig .textLayer span').count() > 0, 'Selectable text layer missing'
    same_size = page.evaluate(f"""() => {{ const [o, t] = [...document.querySelectorAll('{first} .sheet')].map(e => e.getBoundingClientRect());
      return Math.abs(o.width - t.width) < 1 && Math.abs(o.height - t.height) < 1 && Math.abs(o.top - t.top) < 1; }}""")
    assert same_size, 'Original and translated sheets must be the same size and aligned'
    before = page.locator(first).evaluate('(e)=>e.outerHTML')
    page.click('#translate')
    final = first + ' .tb[data-stage="final"]'
    page.locator(final).first.wait_for(timeout=20000)
    wait_for(page, f"() => !document.querySelector('{first} .tb-wait')", 20)
    assert '【译】' in page.locator(final).first.inner_text()
    layout = page.evaluate(LAYOUT_OK, first)
    assert layout['count'] == 6 and layout['inside'] and not layout['overlap'], layout
    # Original page keeps its pixels; the translation is painted on the copy only.
    assert page.locator(first + ' .sheet.orig .tb').count() == 0
    assert page.locator('.pdf-page[data-page="8"] .tb').count() == 0, 'Distant page translated eagerly'
    page.select_option('#mode', 'translated')
    assert not page.locator(first + ' .sheet.orig').is_visible() and page.locator(first + ' .sheet.trans').is_visible()
    page.select_option('#mode', 'original')
    assert page.locator(first + ' .sheet.orig').is_visible() and not page.locator(first + ' .sheet.trans').is_visible()
    page.select_option('#mode', 'reflow')
    page.locator(first + ' .reflow .rf-t').first.wait_for(timeout=10000)
    assert '【译】' in page.locator(first + ' .reflow .rf-t').first.inner_text()
    assert not page.locator(first + ' .sheet.orig').is_visible()
    page.select_option('#mode', 'side')
    wait_for(page, rendered(1))
    page.select_option('#theme', 'dark')
    assert page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(21, 27, 36)'
    page.screenshot(path=str(e2e.ARTIFACTS / 'pdf-side-by-side-dark.png'))
    page.select_option('#theme', 'auto')
    page.click('#restore')
    assert page.locator('.tb,.tb-wait,.tb-retry,.rf-t').count() == 0
    # Reflow paragraphs built while translating stay as original text; everything else is identical.
    after = page.locator(first).evaluate("""(e) => { const c = e.cloneNode(true);
      c.querySelectorAll('.reflow').forEach(r => r.replaceChildren()); return c.outerHTML; }""")
    expected = page.evaluate("""html => { const t = document.createElement('template'); t.innerHTML = html;
      t.content.querySelectorAll('.reflow').forEach(r => r.replaceChildren()); return t.content.firstElementChild.outerHTML; }""", before)
    assert after == expected, 'Restore changed the original page DOM: ' + e2e.first_diff(expected, after)
    page.select_option('#zoom', '1.5')
    wait_for(page, f"() => document.querySelector('{first} .sheet.orig').getBoundingClientRect().width === 918")
    wait_for(page, rendered(1))
    page.select_option('#zoom', '1')
    wait_for(page, f"() => document.querySelector('{first} .sheet.orig').getBoundingClientRect().width === 612")
    # A rapid zoom change may race canvas/worker rendering; the final scale wins.
    page.evaluate("""() => { const zoom=document.getElementById('zoom');
      for(const value of ['2','0.5','1.25']) {zoom.value=value;zoom.dispatchEvent(new Event('change'));}
    }""")
    wait_for(page, f"() => document.querySelector('{first} .sheet.orig').getBoundingClientRect().width === 765")
    wait_for(page, rendered(1))
    assert page.evaluate(f"() => document.querySelector('{first} .sheet.orig canvas').width >= 765")
    page.click('#translate')
    page.fill('#page-number', '8')
    page.click('#jump')
    last = '.pdf-page[data-page="8"] .tb[data-stage="final"]'
    page.locator(last).first.wait_for(timeout=20000)
    assert '【译】' in page.locator(last).first.inner_text()
    canvases = page.locator('.sheet > canvas').count()
    assert canvases <= 10, f'Canvas residency limit exceeded: {canvases}'
    # Restore cancels outstanding batches; late replies must not reinsert translations.
    page.click('#restore')
    page.wait_for_timeout(800)
    assert page.locator('.tb,.tb-wait,.rf-t').count() == 0
    long_tasks = page.evaluate('() => window.__pdfLong || []')
    assert not errors, errors
    return (f'8-page PDF; same-size side-by-side sheets; opt-in + lazy translation; inside/non-overlapping blocks; '
            f'translated/original/reflow views; exact restore; zoom/jump/dark; {canvases} canvases; long tasks {long_tasks}')


def pdf_math(h):
    page, errors = viewer(h, h.base + '/math-notes.pdf', 'side')
    page.wait_for_timeout(400)
    h.tab_id = page.evaluate('async()=>(await chrome.tabs.getCurrent()).id')
    h.wait_ready()
    assert h.state()['ui']['floatBall']
    first = '.pdf-page[data-page="1"]'
    blocks = page.evaluate('() => globalThis.__duallensPdfBlocks(1)')
    kinds = {b['kind'] for b in blocks}
    assert {'text', 'math', 'margin'} <= kinds, blocks
    before = page.locator(first).evaluate('(e)=>e.outerHTML')
    page.click('#translate')
    page.locator(first + ' .tb[data-stage="final"]').first.wait_for(timeout=20000)
    wait_for(page, f"() => !document.querySelector('{first} .tb-wait')", 20)
    page.wait_for_timeout(300)
    blocks = page.evaluate('() => globalThis.__duallensPdfBlocks(1)')
    translated = [b for b in blocks if b.get('state') == 'final']
    assert translated and all(b['kind'] == 'text' for b in translated), 'Only natural-language blocks are translated'
    assert all(b.get('state') is None for b in blocks if b['kind'] != 'text'), 'Formulas/margins must keep the original rendering'
    # Inline formulas travel as atoms and come back as crops of the original page.
    assert any('<x0/>' in (b.get('source') or '') for b in translated), translated
    assert page.locator(first + ' .tb canvas.tm').count() > 0, 'Inline formula crops missing'
    layout = page.evaluate(LAYOUT_OK, first)
    assert layout['inside'] and not layout['overlap'], layout
    page.select_option('#mode', 'reflow')
    page.locator(first + ' .rf-t').first.wait_for(timeout=10000)
    assert page.locator(first + ' .rf[data-kind="math"]').count() >= 2
    assert page.locator(first + ' .rf[data-kind="math"] sup').count() == 1, 'Raised exponent survives in reflow'
    assert page.locator(first + ' .rf-t .tx').count() > 0, 'Inline formula text kept in reflow translation'
    page.select_option('#mode', 'side')
    page.click('#restore')
    page.wait_for_timeout(100)
    restored = page.locator(first).evaluate("(e)=>{const c=e.cloneNode(true);c.querySelectorAll('.reflow').forEach(r=>r.replaceChildren());return c.outerHTML;}")
    expected = page.evaluate("""html => { const t = document.createElement('template'); t.innerHTML = html;
      t.content.querySelectorAll('.reflow').forEach(r => r.replaceChildren()); return t.content.firstElementChild.outerHTML; }""", before)
    assert restored == expected, 'Restore changed the original page DOM: ' + e2e.first_diff(expected, restored)
    # The popup's shared display-mode switch maps onto the PDF views.
    popup = h.ctx.new_page()
    popup.add_init_script('if(globalThis.chrome?.tabs)chrome.tabs.query=async()=>[{id:' + str(h.tab_id) + ',url:' + json.dumps(page.url) + '}];')
    popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
    popup.locator('#onboard-skip,#toggle').first.wait_for(state='attached')
    if popup.locator('#onboard-skip').count():popup.locator('#onboard-skip').click()
    popup.locator('#toggle:enabled').wait_for()
    popup.click('#toggle')
    page.locator(first + ' .tb[data-stage="final"]').first.wait_for(timeout=20000)
    popup.locator('input[value=translation-only]').first.check()
    wait_for(page, "() => document.body.dataset.view === 'translated'")
    assert not page.locator(first + ' .sheet.orig').is_visible()
    h.command('toggle-page')
    assert page.locator('.tb').count() == 0
    popup.close()
    assert not errors, errors
    return 'math PDF; formulas/margins untouched; inline formula crops; reflow keeps scripts; exact restore; popup mode + toggle'


def pdf_entries(h):
    bridge = h.ctx.new_page()
    bridge.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html')
    bridge.evaluate("()=>chrome.storage.local.set({'ui.device':{onboarded:true,acked:[],upgradeNoticeSeen:true}})")
    def send(kind, tab_id):
        return bridge.evaluate('async req=>await chrome.runtime.sendMessage(req)', {'type':kind,'tabId':tab_id})
    for suffix in ['/pdf-field-notebook.pdf', '/download']:
        tab = h.sw_eval('async url=>await chrome.tabs.create({url,active:true})', h.base + suffix)
        h.ctx.pages[-1].wait_for_timeout(500)
        status = send('pdf-status', tab['id'])
        assert status['available'], f'PDF type not recognized: {suffix}'
        popup=h.ctx.new_page()
        popup.add_init_script('if(globalThis.chrome?.tabs)chrome.tabs.query=async()=>[{id:'+str(tab['id'])+',url:'+json.dumps(h.base+suffix)+'}];')
        popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
        popup.locator('#pdf-open').wait_for()
        with h.ctx.expect_page() as new_page:
            popup.locator('#pdf-open').click()
        popup.close()
        pdf_page = new_page.value
        h.page = pdf_page
        pdf_page.wait_for_url(f'chrome-extension://{h.ext_id}/pdf/viewer.html*')
        wait_for(pdf_page, rendered(1), 30)
        assert '?' not in pdf_page.url, 'one-shot token retained in reader URL'
        assert pdf_page.evaluate("""async()=>{const {createPDFHandoff}=await import('./handoff.js');
          const db=await new Promise((ok,fail)=>{const r=indexedDB.open('duallens-pdf-handoff',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
          return await new Promise(ok=>{const r=db.transaction('files').objectStore('files').count();r.onsuccess=()=>{db.close();ok(r.result);};});} """) == 0, 'reader left captured PDF bytes in handoff cache'
    page = h.ctx.new_page()
    h.page = page
    page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file=file%3A%2F%2F%2FC%3A%2Fmissing.pdf')
    page.locator('#status.error').wait_for()
    assert '允许访问文件网址' in page.locator('#status').inner_text()
    page.locator('#local-file').set_input_files(str(e2e.E2E_ROOT / 'pdf-fixture' / 'pdf-field-notebook.pdf'))
    wait_for(page, rendered(1), 30)
    # A slow URL response must not replace a newer local file selection.
    page = h.ctx.new_page()
    h.page = page
    page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file={quote(h.base + "/slow-pdf", safe="")}')
    page.locator('#local-file').set_input_files(str(e2e.E2E_ROOT / 'pdf-fixture' / 'math-notes.pdf'))
    wait_for(page, rendered(1), 30)
    page.wait_for_timeout(1400)
    assert page.locator('.pdf-page').count() == 6, 'Late URL response replaced the selected local PDF'
    assert not page.locator('#status.error').count(), 'An old source error replaced the current status'
    return '.pdf / application/pdf entry; file permission/local chooser; latest local selection wins over a slow URL'


def pdf_handoff(h):
    page=h.ctx.new_page();h.page=page
    page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html')
    result=page.evaluate("""async()=>{
      const {createPDFHandoff}=await import('./handoff.js');
      const {registerPDFHandoffCleanup}=await import('../background/pdf.js');
      let time=1000;const store=createPDFHandoff({now:()=>time});
      const data=new TextEncoder().encode('%PDF-1.4\\nlocal fixture');
      const keys=async()=>{
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('duallens-pdf-handoff',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
        try{return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=reject;});}
        finally{db.close();}
      };
      const token=await store.put(data);
      const pair=await Promise.allSettled([store.take(token),store.take(token)]);
      if(pair.filter(r=>r.status==='fulfilled').length!==1)throw Error('token replay accepted');
      const first=pair.find(r=>r.status==='fulfilled').value;
      if(new TextDecoder().decode(first)!==new TextDecoder().decode(data))throw Error('bytes changed');
      if((await keys()).includes(token))throw Error('consumed bytes remain after take');
      const abandoned=await store.put(data);time+=299999;
      const live=await store.put(data);time++;
      const events={};registerPDFHandoffCleanup({runtime:{onStartup:{addListener:fn=>events.start=fn},onInstalled:{addListener:fn=>events.install=fn}}},store);
      await events.start();
      if((await keys()).includes(abandoned)||!(await keys()).includes(live))throw Error('startup cleanup deleted live data or retained expired bytes');
      time+=300000;await events.install();
      if((await keys()).length)throw Error('install cleanup retained expired bytes');
      const beforePut=await store.put(data);time+=300000;
      const afterPut=await store.put(data);
      if((await keys()).includes(beforePut)||!(await keys()).includes(afterPut))throw Error('put did not purge expired bytes');
      await store.take(afterPut);
      const expired=await store.put(data);time+=300001;
      try{await store.take(expired);throw Error('expiry accepted');}catch(e){if(e.message==='expiry accepted')throw e;}
      const tokens=[];for(let i=0;i<4;i++)tokens.push(await store.put(data));
      const kept=await Promise.allSettled(tokens.map(t=>store.take(t)));
      if(kept.filter(r=>r.status==='fulfilled').length!==3)throw Error('unbounded cache');
      try{await store.take('../invalid');throw Error('invalid accepted');}catch(e){if(e.message==='invalid accepted')throw e;}
      return true;
    }""")
    assert result
    return 'real extension IndexedDB: immediate physical deletion after take; startup/install/put expiry purge preserves live bytes; exact bytes, concurrent single consumption, replay/expiry/malformed rejection, bounded abandoned entries'


def pdf_origin_prompt(h):
    page=h.ctx.new_page();h.page=page
    page.add_init_script("""if(globalThis.chrome?.permissions){
      chrome.permissions.contains=async()=>false;
      chrome.permissions.request=async request=>{window.originRequest=request;return false;};
    }""")
    calls=[]
    h.ctx.route('https://files.example/**',lambda route:(calls.append(route.request.url),route.abort()))
    page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file=https%3A%2F%2Ffiles.example%2Ffixture.pdf')
    page.locator('#status button').wait_for()
    assert not calls,'direct source fetched before origin grant'
    page.locator('#status button').click()
    assert page.evaluate('()=>window.originRequest')=={'origins':['https://files.example/*']}
    assert not calls and page.locator('.pdf-page').count()==0
    return 'other reader source: button invokes scoped requestOrigin; denied permission sends no request'


def pdf_stages(h):
    page, errors = viewer(h, h.base + '/math-notes.pdf', 'side')
    # Test only: replace this page's service at the existing class seam. Production
    # modules and the transport are unchanged; no account or real provider is used.
    page.evaluate("""async () => {
      const {PdfTranslations} = await import('./translate.js');
      const start = PdfTranslations.prototype.start;
      window.__pdfReplies = [];
      PdfTranslations.prototype.start = function() {
        this.service = {translateBatch(req, reply) {
          let finish;
          const call = {req, reply, cancelled:false, finish:()=>finish()};
          window.__pdfReplies.push(call);
          return {done:new Promise(resolve=>{finish=resolve;}),cancel(){call.cancelled=true;finish();}};
        }};
        start.call(this);
      };
    }""")
    page.click('#translate')
    wait_for(page, '() => window.__pdfReplies.length > 0')
    target = page.evaluate("""() => { const call=window.__pdfReplies[0];
      const item=call.req.items.find(i=>i.text.includes('<x0/>')); window.__pdfStageId=item.id;
      call.reply([{id:item.id,text:'草稿 <x0/>',stage:'draft'}]); return item.id; }""")
    block = page.locator(f'.tb[data-id="{target}"]')
    wait_for(page, f"() => document.querySelector('.tb[data-id=\"{target}\"]')?.dataset.stage === 'draft'")
    assert block.locator('canvas.tm').count() == 1
    page.evaluate("""() => window.__pdfReplies[0].reply([{id:window.__pdfStageId,text:'<img src=x onerror="window.pdfInjected=true">终稿 <x0/>',stage:'final'}])""")
    wait_for(page, f"() => document.querySelector('.tb[data-id=\"{target}\"]')?.dataset.stage === 'final'")
    assert '终稿' in block.inner_text() and '草稿' not in block.inner_text()
    assert block.locator('canvas.tm').count() == 1 and block.locator('img').count() == 0
    assert not page.evaluate('() => !!window.pdfInjected')
    # A final echo restores the exact source pixels even after a draft whiteout.
    page.evaluate("""() => { const call=window.__pdfReplies[0]; const item=call.req.items.find(i=>i.id===window.__pdfStageId);
      call.reply([{id:item.id,text:item.text,stage:'final'}]); }""")
    wait_for(page, f"() => !document.querySelector('.tb[data-id=\"{target}\"]')")
    block_number = target.split('-b')[1]
    assert page.locator(f'.pdf-page[data-page="1"] .wo[data-block="{block_number}"]').count() == 0
    page.click('#restore')
    page.evaluate("""() => window.__pdfReplies[0].reply([{id:window.__pdfStageId,text:'迟到 <x0/>',stage:'final'}])""")
    page.wait_for_timeout(100)
    assert page.locator('.tb,.tb-wait,.wo').count() == 0
    assert page.evaluate('() => window.__pdfReplies.every(c=>c.cancelled)')
    assert not errors, errors
    return 'draft -> final in place; formula crop retained; unsafe tags discarded; final echo restores pixels; restore rejects late replies'


def pdf_reflow_start(h):
    page, errors = viewer(h, h.base + '/pdf-field-notebook.pdf', 'reflow', {'width': 375, 'height': 812})
    assert page.locator('.sheet > canvas').count() == 0, 'Reflow-only startup should not render hidden page canvases'
    assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
    page.click('#translate')
    first = '.pdf-page[data-page="1"]'
    page.locator(first + ' .rf-t').first.wait_for(timeout=20000)
    assert page.locator('.pdf-page[data-page="8"] .rf-t').count() == 0
    page.select_option('#mode', 'translated')
    wait_for(page, rendered(1))
    page.locator(first + ' .tb[data-stage="final"]').first.wait_for(timeout=10000)
    page.select_option('#mode', 'reflow')
    assert page.locator(first + ' .rf-t').first.is_visible()
    page.click('#restore')
    page.wait_for_timeout(300)
    assert page.locator('.tb,.tb-wait,.rf-t').count() == 0
    assert not errors, errors
    return '375px reflow startup; no hidden canvases or document overflow; nearby-only translation; layout/reflow roundtrip + restore'


def pdf_probe(h):
    bridge = h.ctx.new_page()
    bridge.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html')
    permissions = bridge.evaluate('()=>chrome.runtime.getManifest().permissions')
    assert 'webRequest' not in permissions and 'webRequestBlocking' not in permissions
    for path in ['/ordinary.html', '/range-download', '/range-html']:
        tab = h.sw_eval('async url=>await chrome.tabs.create({url,active:true})', h.base + path)
        bridge.wait_for_timeout(500)
        # Ordinary navigation must not trigger PDF HEAD/Range probes.
        before = [r for r in Handler.requests if r['path'] == path]
        assert not any(r['method'] == 'HEAD' for r in before), 'Background HEAD observation'
        Handler.requests.clear()
        status = bridge.evaluate('async id=>await chrome.runtime.sendMessage({type:"pdf-status",tabId:id})', tab['id'])
        probes = [r for r in Handler.requests if r['path'] == path]
        expected = ['HEAD'] if path == '/ordinary.html' else ['HEAD', 'GET']
        assert [r['method'] for r in probes] == expected, probes
        assert all(not r['cookie'] and not r['authorization'] for r in probes), probes
        if path != '/ordinary.html':
            assert probes[-1]['range'] == 'bytes=0-1023', probes
        assert status['available'] == (path == '/range-download')
        Handler.requests.clear()
        if path == '/range-download':
            with h.ctx.expect_page() as opened:
                result = bridge.evaluate('async id=>await chrome.runtime.sendMessage({type:"pdf-open",tabId:id})', tab['id'])
            assert result['ok']
            page = opened.value
            h.page = page
            wait_for(page, rendered(1), 30)
        elif path == '/ordinary.html':
            with h.ctx.expect_page() as opened:
                result = bridge.evaluate('''async id=>{
                    const {createPDFEntries}=await import('../background/pdf.js');
                    return createPDFEntries(chrome).openFromMenu(await chrome.tabs.get(id));
                }''', tab['id'])
            assert not result['ok']
            page = opened.value
            h.page = page
            page.locator('#status.error').wait_for()
            assert '当前页面未确认是 PDF' in page.locator('#status').inner_text()
            assert page.locator('.pdf-page').count() == 0
    return 'no webRequest/startup probes; HEAD success/non-PDF; HEAD 405 -> anonymous Range GET; viewer/notice outcomes'


def read_export(page, path):
    info=page.evaluate("""async b64 => {
      const lib=await import('../vendor/pdfjs/pdf.min.js');
      const data=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
      const task=lib.getDocument({data,isEvalSupported:false});
      try {
        const pdf=await task.promise, pages=[];
        for(let n=1;n<=pdf.numPages;n++) {
          const page=await pdf.getPage(n), ops=await page.getOperatorList();
          const viewport=page.getViewport({scale:.5}),canvas=document.createElement('canvas');
          canvas.width=viewport.width;canvas.height=viewport.height;
          const ctx=canvas.getContext('2d',{willReadFrequently:true});
          await page.render({canvasContext:ctx,viewport}).promise;
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let ink=0,difference=0;
          for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width/2;x++){
            const i=(y*canvas.width+x)*4,j=(y*canvas.width+x+Math.floor(canvas.width/2))*4;
            if(pixels[i]<200)ink++;
            if(Math.abs(pixels[i]-pixels[j])>50)difference++;
          }
          pages.push({view:page.view,images:ops.fnArray.filter(op=>op===lib.OPS.paintImageXObject).length,
            text:(await page.getTextContent()).items.length,ink,difference,preview:n===1?canvas.toDataURL('image/png'):null});
          canvas.width=canvas.height=0;
        }
        return pages;
      } finally {await task.destroy();}
    }""", base64.b64encode(path.read_bytes()).decode('ascii'))
    for result in info:
        preview=result.pop('preview',None)
        if preview:path.with_suffix('.png').write_bytes(base64.b64decode(preview.split(',')[1]))
    return info


def pdf_export(h):
    page, errors = viewer(h,h.base+'/math-notes.pdf','side')
    page.click('#export-pdf');page.select_option('#export-scope','range')
    page.fill('#export-range','0, 2-1');page.click('#export-start')
    assert '页码无效' in page.locator('#export-status').inner_text()
    page.fill('#export-range','1')
    with page.expect_download(timeout=60000) as pending:
        page.click('#export-start')
    download=pending.value
    assert download.suggested_filename=='math-notes.bilingual.pdf',download.suggested_filename
    target=e2e.ARTIFACTS/'export-bilingual.pdf';download.save_as(target)
    info=read_export(page,target)
    assert len(info)==1 and info[0]['view']==[0,0,1224,792] and info[0]['images']==2,info
    assert info[0]['text']==0 and info[0]['ink']>100 and info[0]['difference']>100,info
    wait_for(page,"()=>!document.querySelector('#export-start').disabled")
    page.select_option('#export-layout','translated')
    with page.expect_download(timeout=60000) as pending:
        page.click('#export-start')
    download=pending.value
    assert download.suggested_filename=='math-notes.translated.pdf'
    target=e2e.ARTIFACTS/'export-translated.pdf';download.save_as(target)
    info=read_export(page,target)
    assert len(info)==1 and info[0]['view']==[0,0,612,792] and info[0]['images']==1,info
    assert not errors,errors
    assert page.locator('.export-sheet').count()==0
    return 'real PDF downloads: bilingual 1224x792 / 2 images; translated 612x792 / 1 image; PDF.js render + pixel difference; strict range validation; math original pixels retained'


def pdf_export_cancel(h):
    page,errors=viewer(h,h.base+'/pdf-field-notebook.pdf','side')
    downloads=[];page.on('download',lambda download:downloads.append(download))
    page.evaluate("""async()=>{
      const {PdfTranslations}=await import('./translate.js');const start=PdfTranslations.prototype.start;
      window.exportCalls=[];PdfTranslations.prototype.start=function(){
        this.service={translateBatch(req,reply){const call={req,reply,cancelled:false};exportCalls.push(call);
          let finish;return{done:new Promise(r=>finish=r),cancel(){call.cancelled=true;finish();}};}};
        start.call(this);
      };
    }""")
    page.click('#export-pdf');page.click('#export-start')
    wait_for(page,'()=>window.exportCalls.length>0')
    page.click('#export-cancel');wait_for(page,"()=>!document.querySelector('#export-start').disabled")
    assert '已取消' in page.locator('#export-status').inner_text()
    page.evaluate("()=>exportCalls.forEach(c=>c.reply(c.req.items.map(i=>({id:i.id,text:'late text',stage:'final'}))))")
    page.wait_for_timeout(300)
    assert not downloads and page.locator('.export-sheet').count()==0
    assert page.evaluate('()=>exportCalls.every(c=>c.cancelled)')
    assert not errors,errors
    return 'cancel while translating closes requests, ignores late replies, releases temporary DOM and produces zero downloads'


def pdf_export_consent(h):
    profile={'id':'export-consent','kind':'openai','name':'Offline export consent fixture','baseUrl':'https://consent.example/v1',
             'model':'fixture','requiresKey':False,'fallbackModels':[]}
    h.settings({'provider':{'active':profile['id'],'profiles':[profile],'chain':[]},'translation':{'mode':'llm'}})
    h.ctx.add_init_script("""(()=>{window.consentRoots=[];const attach=Element.prototype.attachShadow;
      Element.prototype.attachShadow=function(opts){const root=attach.call(this,opts);consentRoots.push(root);return root;};})();""")
    page,errors=viewer(h,h.base+'/pdf-field-notebook.pdf','side')
    downloads=[];page.on('download',lambda item:downloads.append(item))
    page.evaluate("""async()=>{
      const {PdfTranslations}=await import('./translate.js'),start=PdfTranslations.prototype.start;
      window.exportRequests=[];PdfTranslations.prototype.start=function(){
        this.service={translateBatch(req,reply){exportRequests.push(req);let cancelled=false;
          const done=new Promise(resolve=>setTimeout(()=>{if(!cancelled)reply(req.items.map(item=>({id:item.id,text:'【译】'+item.text})));resolve();},10));
          return{done,cancel(){cancelled=true;}};}};start.call(this);};
    }""")
    page.click('#export-pdf');page.select_option('#export-scope','range');page.fill('#export-range','8');page.click('#export-start')
    wait_for(page,"()=>consentRoots.some(r=>r.querySelector('.confirm'))")
    assert page.evaluate('()=>exportRequests.length')==0 and not downloads
    page.evaluate("()=>consentRoots.find(r=>r.querySelector('.confirm')).querySelector('.close').click()")
    wait_for(page,"()=>!document.querySelector('#export-start').disabled")
    assert page.evaluate('()=>exportRequests.length')==0 and not downloads
    page.click('#export-start');wait_for(page,"()=>consentRoots.some(r=>r.querySelector('.confirm'))")
    with page.expect_download(timeout=60000) as pending:
        page.evaluate("()=>consentRoots.find(r=>r.querySelector('.confirm')).querySelector('.primary').click()")
    target=e2e.ARTIFACTS/'export-consented.pdf';pending.value.save_as(target)
    assert len(read_export(page,target))==1
    assert page.evaluate("()=>exportRequests.every(req=>req.items.every(item=>item.id.startsWith('p8-')))")
    assert not errors,errors
    return 'export first-send gate: close sends zero text and downloads nothing; consent exports only selected offscreen page 8'


def pdf_ocr_cancel(h):
    page,errors=viewer(h,h.base+'/scanned-notes.pdf','side')
    downloads=[];page.on('download',lambda download:downloads.append(download))
    page.click('#ocr-toggle');wait_for(page,"()=>!document.querySelector('#ocr-start').disabled")
    page.evaluate("""()=>{
      const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.ocrCalls=[];window.ocrCancels=[];
      chrome.runtime.sendMessage=msg=>{
        if(msg.type==='pdf-ocr')return new Promise(resolve=>ocrCalls.push({msg,resolve}));
        if(msg.type==='pdf-ocr-cancel'){ocrCancels.push(msg);return Promise.resolve({ok:true});}
        return send(msg);
      };
    }""")
    page.check('#ocr-download');page.click('#ocr-start');wait_for(page,'()=>ocrCalls.length===1')
    page.click('#ocr-cancel');wait_for(page,"()=>!document.querySelector('#ocr-start').disabled")
    assert page.evaluate('()=>ocrCancels.length')==1
    page.evaluate("""()=>ocrCalls[0].resolve({ok:true,regions:[{text:'Late OCR result',confidence:99,bbox:{x0:.1,y0:.1,x1:.8,y1:.2}}]})""")
    page.wait_for_timeout(200)
    assert not downloads and page.locator('.tb,.rf-t').count()==0
    assert '已取消' in page.locator('#ocr-status').inner_text()
    assert not errors,errors
    return 'cancel during OCR returns promptly, sends job cancellation, rejects late recognized text and produces zero downloads/translations'


def pdf_scanned(h):
    manifest=json.loads((PROJECT/'extension/offscreen/languages.json').read_text(encoding='utf-8'))
    pack=e2e.E2E_ROOT/'comics-data/eng.traineddata'
    assert pack.stat().st_size==manifest['eng']['bytes']
    assert hashlib.sha256(pack.read_bytes()).hexdigest()==manifest['eng']['sha256']
    Handler.requests.clear()
    downloads=lambda:[r for r in Handler.requests if r['path']=='/eng.traineddata']
    page,errors=viewer(h,h.base+'/scanned-notes.pdf','side')
    assert not page.locator('#ocr-panel').is_visible()
    page.click('#ocr-toggle')
    page.locator('#ocr-panel').wait_for(state='visible')
    wait_for(page,"()=>!document.querySelector('#ocr-start').disabled")
    assert page.locator('.textLayer span').count()==0
    assert not downloads() and page.locator('.tb').count()==0
    assert '4.11 MB' in page.locator('#ocr-pack').inner_text()
    assert '127.0.0.1' in page.locator('#ocr-pack').inner_text()
    page.click('#ocr-start');assert not downloads()
    page.check('#ocr-download');page.click('#ocr-start')
    page.locator('.tb[data-stage=final]').first.wait_for(timeout=60000)
    texts=page.locator('.tb[data-stage=final]').all_text_contents()
    assert any('GARDEN' in text or 'LEAVES' in text or 'NOTES' in text for text in texts),texts
    assert len(downloads())==1,downloads()
    wait_for(page,"()=>!document.querySelector('#ocr-start').disabled")
    page.click('#export-pdf')
    with page.expect_download(timeout=60000) as pending:
        page.click('#export-start')
    target=e2e.ARTIFACTS/'export-ocr.pdf';pending.value.save_as(target)
    info=read_export(page,target)
    assert len(info)==2 and all(p['images']==2 for p in info),info
    assert all(p['difference']>100 for p in info),info
    assert len(downloads())==1,'verified OCR language cache not reused'
    assert not errors,errors
    page.screenshot(path=str(e2e.ARTIFACTS/'pdf-ocr.png'))
    return 'original image-only 2-page fixture; zero pre-confirmation downloads; pinned English pack size+SHA256; real Tesseract OCR + mock translation; sequential OCR export PDF.js readback; pack reused'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', action='append', default=[], help='mock case name filter')
    args = parser.parse_args()
    fixtures = e2e.E2E_ROOT / 'pdf-fixture'
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / 'pdf-field-notebook.pdf').write_bytes(fixture.make_pdf())
    (fixtures / 'math-notes.pdf').write_bytes(math_fixture.make_pdf())
    (fixtures / 'scanned-notes.pdf').write_bytes(fixture.make_scanned_pdf(2))
    (fixtures / 'ordinary.html').write_text('<!doctype html><title>PDF probe fixture</title><p>This original page is not a PDF.</p>', encoding='utf-8')
    run = e2e.E2E_ROOT / ('run-pdf-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run)
    assert not missing, missing
    e2e.ARTIFACTS = e2e.E2E_ROOT / 'artifacts' / 'pdf'
    e2e.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(fixtures)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    if not args.only or any('scan' in name for name in args.only):
        comics=load('duallens_pdf_comic_data','tests/e2e/run_comics_e2e.py')
        comics.runner.E2E_ROOT=e2e.E2E_ROOT
        comics.ensure_fixture_downloads()
        pack=e2e.E2E_ROOT/'comics-data/eng.traineddata'
        spec=json.loads((ext/'offscreen/languages.json').read_text(encoding='utf-8'))
        assert len(pack.read_bytes())==spec['eng']['bytes'] and hashlib.sha256(pack.read_bytes()).hexdigest()==spec['eng']['sha256']
        shutil.copyfile(pack,fixtures/'eng.traineddata')
        # Offscreen targets are not reliably intercepted by Playwright 1.48 routes.
        # Change only the isolated staging manifest's data URL, preserving size/hash.
        spec['eng']['url']=base+'/eng.traineddata'
        (ext/'offscreen/languages.json').write_text(json.dumps(spec),encoding='utf-8')
    results = []
    cases = [('pdf_consent',pdf_consent), ('pdf_reading', pdf_reading), ('pdf_math', pdf_math), ('pdf_stages', pdf_stages), ('pdf_reflow_start', pdf_reflow_start), ('pdf_entries', pdf_entries), ('pdf_probe', pdf_probe), ('pdf_handoff', pdf_handoff), ('pdf_origin_prompt', pdf_origin_prompt), ('pdf_export',pdf_export), ('pdf_export_cancel',pdf_export_cancel), ('pdf_export_consent',pdf_export_consent), ('pdf_ocr_cancel',pdf_ocr_cancel), ('pdf_scanned',pdf_scanned)]
    try:
        with e2e.sync_playwright() as p:
            for name, case in cases:
                if args.only and not any(o in name for o in args.only):
                    continue
                result = e2e.run_case(p, name, case, ext, base)
                results.append(result)
                print(result['status'], name + ':', result.get('detail', ''), flush=True)
        (e2e.ARTIFACTS / 'last-run.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        server.shutdown()
        server.server_close()
        e2e.remove_runtime_dir(run)
    failed = sum(r['status'] == 'FAIL' for r in results)
    if not results:
        print('PDF E2E: no matching cases')
        return 2
    print(f'PDF E2E: {len(results)-failed} PASS, {failed} FAIL, 0 SKIP')
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
