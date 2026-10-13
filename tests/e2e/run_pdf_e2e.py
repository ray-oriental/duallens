"""Mock-only PDF browser checks using the canonical staging/session helper.
No account/model server. Original fixture is regenerated in the E2E cache.
"""
from pathlib import Path
import importlib.util
import json
import sys
import uuid
import time
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


def viewer(h, url):
    page = h.ctx.new_page()
    h.page = page
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
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
    page.locator('.pdf-page[data-page="1"] .paragraphs p').first.wait_for(timeout=20000)
    wait_for(page, '() => document.querySelector(".pdf-page[data-page=\\"1\\"]").dataset.rendered === "true"')
    return page, errors


def pdf_reading(h):
    page, errors = viewer(h, h.base + '/pdf-field-notebook.pdf')
    page.wait_for_timeout(700)
    assert page.locator('.pdf-page').count() == 8
    assert page.locator('.pdf-page[data-page="8"] .paragraphs p').count() == 0, 'Distant page extracted eagerly'
    assert page.locator('dl-t').count() == 0, 'PDF translated without opt-in'
    assert page.locator('.textLayer span').count() > 0, 'Selectable text layer missing'
    before = page.locator('.pdf-page[data-page="1"] .paragraphs').evaluate('(e)=>e.outerHTML')
    page.click('#translate')
    first = '.pdf-page[data-page="1"] dl-t[data-dl-state="done"]'
    page.locator(first).first.wait_for(timeout=20000)
    assert '【译】' in page.locator(first).first.inner_text()
    assert page.locator('.pdf-page[data-page="8"] dl-t').count() == 0, 'Distant page translated eagerly'
    page.select_option('#mode', 'translation-only')
    assert not page.locator('.pdf-page[data-page="1"] .visual').is_visible()
    assert page.locator('.pdf-page[data-page="1"] dl-o').first.evaluate('(e)=>getComputedStyle(e).display') == 'none'
    page.select_option('#mode', 'bilingual')
    assert page.locator('.pdf-page[data-page="1"] .visual').is_visible()
    page.select_option('#theme', 'dark')
    assert page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(19, 26, 36)'
    page.screenshot(path=str(e2e.ARTIFACTS / 'pdf-bilingual-dark.png'))
    page.click('#restore')
    assert page.locator('dl-t,dl-o,dl-w,dl-r').count() == 0
    assert page.locator('.pdf-page[data-page="1"] .paragraphs').evaluate('(e)=>e.outerHTML') == before, 'Restore changed original paragraph DOM'
    page.select_option('#zoom', '1.5')
    wait_for(page, '() => document.querySelector(".pdf-page[data-page=\\"1\\"] canvas")?.style.width === "918px"')
    page.select_option('#zoom', '1')
    wait_for(page, '() => document.querySelector(".pdf-page[data-page=\\"1\\"] canvas")?.style.width === "612px"')
    # A rapid zoom change may race canvas/worker rendering; the final scale wins.
    page.evaluate("""() => { const zoom=document.getElementById('zoom');
      for(const value of ['2','0.5','1.25']) {zoom.value=value;zoom.dispatchEvent(new Event('change'));}
    }""")
    wait_for(page, '() => document.querySelector(".pdf-page[data-page=\\"1\\"] canvas")?.style.width === "765px"')
    wait_for(page, '() => document.querySelector(".pdf-page[data-page=\\"1\\"]").dataset.rendered === "true"')
    page.click('#translate')
    page.fill('#page-number', '8')
    page.click('#jump')
    last = '.pdf-page[data-page="8"] dl-t[data-dl-state="done"]'
    page.locator(last).first.wait_for(timeout=20000)
    assert '【译】' in page.locator(last).first.inner_text()
    assert page.locator('.pdf-surface canvas').count() <= 4, 'Canvas residency limit exceeded: ' + str(page.locator('canvas').evaluate_all('(els)=>els.map(e=>({page:e.closest(".pdf-page")?.dataset.page,parent:e.parentElement.className,width:e.width,height:e.height}))'))
    # Restore cancels outstanding batches; late replies must not reinsert translations.
    page.click('#restore')
    page.wait_for_timeout(800)
    assert page.locator('dl-t,dl-o,dl-w,dl-r').count() == 0
    assert not errors, errors
    return '8-page local PDF; canvas/text layer; opt-in + lazy translation; bilingual/only; exact restore; zoom/jump/dark; <=4 canvases'


def pdf_entries(h):
    bridge = h.ctx.new_page()
    bridge.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html')
    def send(kind, tab_id):
        return bridge.evaluate('async req=>await chrome.runtime.sendMessage(req)', {'type':kind,'tabId':tab_id})
    for suffix in ['/pdf-field-notebook.pdf', '/download']:
        tab = h.sw_eval('async url=>await chrome.tabs.create({url,active:true})', h.base + suffix)
        h.ctx.pages[-1].wait_for_timeout(500)
        status = send('pdf-status', tab['id'])
        assert status['available'], f'PDF type not recognized: {suffix}'
        with h.ctx.expect_page() as new_page:
            opened = send('pdf-open', tab['id'])
        assert opened['ok']
        pdf_page = new_page.value
        h.page = pdf_page
        pdf_page.wait_for_url(f'chrome-extension://{h.ext_id}/pdf/viewer.html?*')
        pdf_page.locator('.pdf-page[data-page="1"] .paragraphs p').first.wait_for(timeout=20000)
    page = h.ctx.new_page()
    h.page = page
    page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file=file%3A%2F%2F%2FC%3A%2Fmissing.pdf')
    page.locator('#status.error').wait_for()
    assert '允许访问文件网址' in page.locator('#status').inner_text()
    page.locator('#local-file').set_input_files(str(e2e.E2E_ROOT / 'pdf-fixture' / 'pdf-field-notebook.pdf'))
    page.locator('.pdf-page[data-page="1"] .paragraphs p').first.wait_for(timeout=20000)
    return '.pdf / application/pdf entry opens viewer; denied file URL explains permission; local chooser works'


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
            page.locator('.pdf-page[data-page="1"] .paragraphs p').first.wait_for(timeout=20000)
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


def main():
    fixtures = e2e.E2E_ROOT / 'pdf-fixture'
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / 'pdf-field-notebook.pdf').write_bytes(fixture.make_pdf())
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
    results = []
    try:
        with e2e.sync_playwright() as p:
            for name, case in [('pdf_reading', pdf_reading), ('pdf_entries', pdf_entries), ('pdf_probe', pdf_probe)]:
                result = e2e.run_case(p, name, case, ext, base)
                results.append(result)
                print(result['status'], name + ':', result.get('detail', ''), flush=True)
        (e2e.ARTIFACTS / 'last-run.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        server.shutdown()
        server.server_close()
        e2e.remove_runtime_dir(run)
    failed = sum(r['status'] == 'FAIL' for r in results)
    print(f'PDF E2E: {len(results)-failed} PASS, {failed} FAIL, 0 SKIP')
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
