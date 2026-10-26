"""Mock-only PDF visual review using canonical isolated staging and original fixtures.

Use --before to stage HEAD's viewer markup/styles without changing the checkout.
Outputs default to the external E2E cache; no OCR download or provider access.
"""
import argparse
import importlib.util
import os
import subprocess
import sys
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

WORKTREE = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before', action='store_true')
parser.add_argument('--output', type=Path, default=Path.home() / '.cache/duallens-e2e/pdf-visual')
args = parser.parse_args()
os.environ.setdefault('DUALLENS_E2E_OUT', str(Path.home() / '.cache/duallens-e2e'))
OUT = args.output.resolve() / ('before' if args.before else 'after')
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('pdf_e2e_visual', WORKTREE / 'tests/e2e/run_pdf_e2e.py')
pdf = importlib.util.module_from_spec(spec)
sys.modules['pdf_e2e_visual'] = pdf
spec.loader.exec_module(pdf)
e2e = pdf.e2e

STALL = """async()=>{
  const {PdfTranslations}=await import('./translate.js');const start=PdfTranslations.prototype.start;
  window.exportCalls=[];PdfTranslations.prototype.start=function(){
    this.service={translateBatch(req,reply){const call={req,reply,cancelled:false};exportCalls.push(call);
      let finish;return{done:new Promise(r=>finish=r),cancel(){call.cancelled=true;finish();}};}};
    start.call(this);
  };
}"""


def shot(page, name, header=False):
    page.wait_for_timeout(150)
    if not args.before:
        contrast = page.evaluate(r"""() => {
          const rgb = value => value.match(/[\d.]+/g).slice(0,3).map(Number);
          const luminance = color => rgb(color).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4)
            .reduce((total,n,i)=>total+n*[.2126,.7152,.0722][i],0);
          const background = luminance(getComputedStyle(document.body).backgroundColor);
          return [...document.querySelectorAll('#status, header .hint, .rf-t')]
            .filter(e=>e.getClientRects().length && e.textContent.trim()).map(e=>{
              const foreground=luminance(getComputedStyle(e).color);
              return {selector:e.id||e.className,ratio:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)};
            });
        }""")
        assert all(item['ratio'] >= 4.5 for item in contrast), contrast
    if header:
        box = page.locator('header').bounding_box()
        page.screenshot(path=str(OUT / (name + '.png')), clip={'x': 0, 'y': 0, 'width': page.viewport_size['width'], 'height': box['height'] + 24})
    else:
        page.screenshot(path=str(OUT / (name + '.png')))
    print('shot', name, flush=True)


def theme(page, choice, system, expected):
    page.select_option('#theme', choice)
    page.emulate_media(color_scheme=system)
    if not args.before:
        assert page.evaluate('getComputedStyle(document.body).backgroundColor') == expected


def narrow_checks(page):
    if args.before:
        return
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Narrow page overflow'
    assert page.evaluate("""() => [...document.querySelectorAll('header button, header select, #page-number, .file-button, .check')]
      .filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)"""), 'Touch target below 44px'


def settle(page, first='.pdf-page[data-page="1"]'):
    page.locator(first + ' .tb[data-stage="final"]').first.wait_for(timeout=20000)
    pdf.wait_for(page, f"() => !document.querySelector('{first} .tb-wait')", 20)


def run(p, ext, base):
    h = e2e.Session(p, ext, base, 'visual')
    try:
        h.start()
        runtime_errors = []
        h.ctx.on('page', lambda page: page.on('pageerror', lambda error: runtime_errors.append(str(error))))
        # Session enables passive features for legacy interaction cases; visual review keeps them off.
        h.settings({name: {'enabled': False} for name in ('floatBall', 'selection', 'hover', 'input', 'comics')})
        # 1. Toolbar, light and dark (reader switch and system preference).
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'side')
        page.wait_for_timeout(400)
        shot(page, '01-toolbar-light', header=True)
        page.select_option('#theme', 'dark')
        shot(page, '02-toolbar-dark', header=True)
        page.select_option('#theme', 'auto')
        page.emulate_media(color_scheme='dark')
        shot(page, '03-toolbar-dark-system', header=True)
        page.select_option('#theme', 'light')
        shot(page, '03b-toolbar-light-forced-on-dark-system', header=True)
        theme(page, 'light', 'dark', 'rgb(250, 250, 249)')
        theme(page, 'dark', 'light', 'rgb(27, 27, 29)')
        theme(page, 'auto', 'dark', 'rgb(27, 27, 29)')
        theme(page, 'auto', 'light', 'rgb(250, 250, 249)')
        page.select_option('#theme', 'auto')
        page.emulate_media(color_scheme='light')
        page.keyboard.press('Tab')
        page.keyboard.press('Tab')
        shot(page, '03c-toolbar-keyboard-focus', header=True)
        # 2. Export panel open, light and dark.
        page.click('#export-pdf')
        if not args.before:
            assert page.locator('button.primary:visible').count() == 1
            assert page.locator('#export-panel').evaluate("e=>getComputedStyle(e).boxShadow") == 'none'
        shot(page, '04-export-open')
        page.select_option('#export-scope', 'range')
        page.fill('#export-range', '1-3')
        shot(page, '04b-export-range', header=True)
        page.emulate_media(color_scheme='dark')
        shot(page, '05-export-open-dark', header=True)
        page.emulate_media(color_scheme='light')
        page.select_option('#export-scope', 'all')
        # 3. Export in progress (translation requests held open, then cancelled).
        page.evaluate(STALL)
        page.click('#export-start')
        pdf.wait_for(page, '()=>window.exportCalls.length>0')
        page.wait_for_timeout(300)
        shot(page, '06-export-progress', header=True)
        page.emulate_media(color_scheme='dark')
        shot(page, '06a-export-progress-dark', header=True)
        page.emulate_media(color_scheme='light')
        page.click('#export-cancel')
        pdf.wait_for(page, "()=>!document.querySelector('#export-start').disabled")
        shot(page, '06b-export-cancelled', header=True)
        page.close()

        # 4. Translated two-column page, light and dark.
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'side')
        page.click('#translate')
        settle(page)
        shot(page, '07-translated-side')
        page.select_option('#theme', 'dark')
        shot(page, '08-translated-side-dark')
        page.select_option('#theme', 'auto')
        page.select_option('#mode', 'reflow')
        page.locator('.pdf-page[data-page="1"] .reflow .rf-t').first.wait_for(timeout=10000)
        shot(page, '09-reflow-light')
        page.select_option('#theme', 'dark')
        shot(page, '09b-reflow-dark')
        page.close()

        # 5. OCR prompt on the scanned fixture (no recognition started).
        page, errors = pdf.viewer(h, base + '/scanned-notes.pdf', 'side')
        page.locator('#ocr-toggle').wait_for(state='visible', timeout=20000)
        shot(page, '10-ocr-prompt', header=True)
        page.click('#ocr-toggle')
        pdf.wait_for(page, "()=>!document.querySelector('#ocr-start').disabled")
        if not args.before:
            assert page.locator('button.primary:visible').count() == 1
        shot(page, '11-ocr-panel')
        page.emulate_media(color_scheme='dark')
        shot(page, '12-ocr-panel-dark', header=True)
        page.close()

        # 6. Narrow window: reflow default under 600 px.
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'reflow', {'width': 375, 'height': 900})
        page.click('#translate')
        page.locator('.pdf-page[data-page="1"] .reflow .rf-t').first.wait_for(timeout=20000)
        narrow_checks(page)
        shot(page, '13-narrow-375')
        page.select_option('#theme', 'dark')
        shot(page, '13b-narrow-dark')
        page.select_option('#theme', 'light')
        page.click('#export-pdf')
        narrow_checks(page)
        shot(page, '14-narrow-export')
        page.close()
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'side', {'width': 760, 'height': 860})
        shot(page, '15-mid-760', header=True)
        page.close()

        # 8. Pending marks, then a failed block with its retry control, then hover link.
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'side')
        page.evaluate(STALL)
        page.click('#translate')
        pdf.wait_for(page, "()=>window.exportCalls.length>0 && !!document.querySelector('.tb-wait')")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / '18-pending.png'), clip={'x': 0, 'y': 0, 'width': 1280, 'height': 420})
        page.evaluate("""()=>{const c=exportCalls[0];c.reply(c.req.items.map((i,n)=>n%2?{id:i.id,error:{code:'network',message:'fixture'}}:{id:i.id,text:'【译】'+(i.text||'fixture'),stage:'final'}));}""")
        page.locator('.tb-retry').first.wait_for(timeout=10000)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / '19-retry.png'), clip={'x': 0, 'y': 0, 'width': 1280, 'height': 420})
        page.locator('.tb[data-stage="final"]').first.hover()
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / '20-hover-link.png'), clip={'x': 0, 'y': 0, 'width': 1280, 'height': 420})
        print('shot 18-20', flush=True)
        page.close()

        # Draft reflow text keeps the shared ink contrast while refinement is pending.
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'reflow')
        page.evaluate(STALL)
        page.click('#translate')
        pdf.wait_for(page, '()=>window.exportCalls.length>0')
        page.evaluate("""()=>exportCalls.forEach(c=>c.reply(c.req.items.map(i=>({id:i.id,text:'【译】'+(i.text||'fixture'),stage:'draft'}))))""")
        page.locator('.rf-t[data-stage=draft]').first.wait_for(timeout=10000)
        if not args.before:
            assert page.locator('.rf-t[data-stage=draft]').first.evaluate('e=>getComputedStyle(e).opacity') == '1'
        shot(page, '25-draft-reflow-light')
        page.select_option('#theme', 'dark')
        shot(page, '26-draft-reflow-dark')
        page.close()

        # 7. Status line: origin prompt with its inline button, and an error message.
        page = h.ctx.new_page(); h.page = page
        page.add_init_script("""if(globalThis.chrome?.permissions){
          chrome.permissions.contains=async()=>false;chrome.permissions.request=async()=>false;}""")
        h.ctx.route('https://files.example/**', lambda route: route.abort())
        page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file=https%3A%2F%2Ffiles.example%2Ffixture.pdf')
        page.locator('#status button').wait_for()
        shot(page, '16-origin-prompt', header=True)
        page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?notice=not-pdf')
        page.locator('#status.error').wait_for()
        shot(page, '17-status-error', header=True)
        page.emulate_media(color_scheme='dark')
        shot(page, '17b-status-error-dark', header=True)
        page.close()

        # 9. English interface: longest labels in the toolbar and export panel.
        h.settings({'uiLanguage': 'en'})
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'side')
        page.click('#export-pdf')
        shot(page, '21-english-export', header=True)
        page.close()
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'side', {'width': 1024, 'height': 700})
        shot(page, '22-english-1024', header=True)
        page.close()
        page, errors = pdf.viewer(h, base + '/pdf-field-notebook.pdf', 'reflow', {'width': 375, 'height': 900})
        page.click('#export-pdf')
        narrow_checks(page)
        shot(page, '23-english-narrow-export')
        page.select_option('#export-scope', 'range')
        page.fill('#export-range', '1-3')
        narrow_checks(page)
        shot(page, '24-english-narrow-range')
        page.close()
        assert not runtime_errors, runtime_errors
    finally:
        h.close()


def main():
    fixtures = e2e.E2E_ROOT / 'pdf-visual-fixture'
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / 'pdf-field-notebook.pdf').write_bytes(pdf.fixture.make_pdf())
    (fixtures / 'scanned-notes.pdf').write_bytes(pdf.fixture.make_scanned_pdf(2))
    run_dir = e2e.E2E_ROOT / ('run-pdf-visual-' + uuid.uuid4().hex[:8])
    run_dir.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run_dir, WORKTREE / 'extension')
    assert not missing, missing
    if args.before:
        for name in ('viewer.html', 'viewer.css'):
            content = subprocess.check_output(['git', 'show', 'HEAD:extension/pdf/' + name], cwd=WORKTREE)
            (ext / 'pdf' / name).write_bytes(content)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(pdf.Handler, directory=str(fixtures)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    try:
        with e2e.sync_playwright() as p:
            run(p, ext, base)
        print('PDF VISUAL: screenshots complete; ' + ('HEAD baseline' if args.before else 'theme, primary action and narrow layout checks PASS'), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        e2e.remove_runtime_dir(run_dir)


if __name__ == '__main__':
    main()
