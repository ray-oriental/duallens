"""Mock-only iframe regressions, using canonical extension staging and GM fixture transport."""
import json
import subprocess
import uuid
import traceback
from playwright.sync_api import sync_playwright
import run_e2e as e
from run_userscript_e2e import STUB, command


def child(page, selector):
    return page.locator(selector).element_handle().content_frame()


def wait(frame, predicate):
    # Hidden frames do not paint; rAF polling would never observe their successful restore.
    frame.wait_for_function(predicate, polling=100, timeout=15000)


def translated(frame):
    wait(frame, "!!document.querySelector('dl-t[data-dl-state=done]')")
    assert frame.locator('dl-t').first.inner_text().startswith('【译】')
    assert frame.locator('dl-t dl-t').count() == 0


def exercise(page, toggle, mode, extension):
    ids = ['mail', 'srcdoc', 'blank', 'cross', 'small', 'small-cross', 'hidden-cross']
    frames = {key: child(page, '#' + key) for key in ids}
    originals = {key: f.evaluate('document.body.outerHTML') for key, f in frames.items()}
    toggle()
    for key in ['mail', 'srcdoc', 'blank'] + (['cross'] if extension else []):
        try: translated(frames[key])
        except Exception as exc: raise AssertionError('initial translation failed: ' + key) from exc
    page.wait_for_timeout(800)
    for key in ['small', 'small-cross', 'hidden-cross'] + ([] if extension else ['cross']):
        assert frames[key].locator('dl-t').count() == 0, key + ' must be skipped'
    assert all(f.locator('dl-ui').count() == 0 for f in frames.values()), 'child frame created UI'
    mode()
    for key in ['mail', 'srcdoc', 'blank'] + (['cross'] if extension else []):
        wait(frames[key], "!!document.querySelector('dl-o.dl-hide')")
        assert frames[key].locator('dl-o').first.evaluate('e=>getComputedStyle(e).display') == 'none'
    toggle()
    for key, f in frames.items():
        wait(f, "!document.querySelector('dl-t,dl-o,dl-w,dl-r')")
        assert f.evaluate('document.body.outerHTML') == originals[key], key + ' restore mismatch'
    for key in ['mail', 'srcdoc', 'blank']:
        assert frames[key].locator('style').count() == 0, key + ' leaked style'
    mode()  # back to bilingual
    toggle(); translated(frames['mail'])
    page.evaluate('replaceMailLater()')
    wait(frames['mail'], "document.querySelector('#message')?.textContent.includes('second message')")
    translated(frames['mail'])
    assert frames['mail'].locator('dl-t').count() == 1, 'replaced document translated twice'
    if extension:
        frames['cross'].goto(frames['cross'].url + '?new-message=2')
        translated(frames['cross'])
        page.locator('#hidden-cross').evaluate("e=>e.style.display='block'")
        translated(frames['hidden-cross'])
        page.locator('#hidden-cross').evaluate("e=>e.style.display='none'")
        wait(frames['hidden-cross'], "!document.querySelector('dl-t')")
    # Late iframe insertion, visibility changes and document navigation are independent discoveries.
    page.evaluate("""() => {const f=document.createElement('iframe');f.id='late';f.srcdoc='<p>A newly inserted frame needs translation after the initial scan.</p>';document.querySelector('.frames').prepend(f);} """)
    late = child(page, '#late'); translated(late)
    toggle()
    for key, f in frames.items():
        wait(f, "!document.querySelector('dl-t,dl-o,dl-w,dl-r')")
        expected = page.evaluate('mailOriginal') if key == 'mail' else originals[key]
        assert f.evaluate('document.body.outerHTML') == expected, key + ' second restore mismatch'
    wait(late, "!document.querySelector('dl-t')")
    assert late.evaluate('document.body.outerHTML') == '<body><p>A newly inserted frame needs translation after the initial scan.</p></body>'
    page.evaluate("""() => {
      const f=document.createElement('iframe');f.id='lazy-frame';
      f.srcdoc='<style>p{height:120px;margin:0}</style>'+Array.from({length:40},(_,i)=>'<p id="line-'+i+'">The distant letter paragraph contains an independent explanation number '+i+'.</p>').join('');
      document.querySelector('.frames').prepend(f);
    }""")
    lazy=child(page,'#lazy-frame'); wait(lazy,"document.querySelectorAll('p').length===40")
    before=lazy.evaluate('document.body.outerHTML')
    toggle(); translated(lazy); page.wait_for_timeout(300)
    assert lazy.locator('dl-t').count()<10, 'frame scrolled offscreen paragraphs were eagerly translated'
    lazy.locator('#line-30').scroll_into_view_if_needed()
    wait(lazy,"!!document.querySelector('#line-30 dl-t[data-dl-state=done]')")
    toggle(); wait(lazy,"!document.querySelector('dl-t')")
    assert lazy.evaluate('document.body.outerHTML')==before, 'scrolled frame restore mismatch'
    return 'blank/srcdoc/dynamic roots, 1s mail rewrite, child mode/navigation/visibility, tiny exclusion, frame scroll laziness, no child UI, exact restore'


def main():
    first, base = e.start_fixtures(); second, remote = e.start_fixtures()
    remote = remote.replace('127.0.0.1', 'localhost')
    run = e.E2E_ROOT / ('run-frames-' + uuid.uuid4().hex[:8]); run.mkdir(parents=True)
    results = []
    try:
        ext, missing = e.stage_extension(run); e.check(not missing, str(missing))
        bundle = run / 'duallens.user.js'
        subprocess.run(['node', str(e.REPO / 'scripts/build_userscript.mjs'), '--output', str(bundle)], check=True)
        with sync_playwright() as pw:
            h = e.Session(pw, ext, base, 'frames')
            try:
                h.start()
                # A child-origin never rule must not override top-page consent/state.
                h.settings({'siteRules':{'never':['localhost']}})
                h.open('frames.html?remote=' + remote)
                detail = exercise(h.page, lambda: h.command('toggle-page'), lambda: h.command('toggle-translation-only'), True)
                results.append({'name':'extension','status':'PASS','detail':detail})
                print('PASS frames extension: ' + detail, flush=True)
            except Exception as exc:
                traceback.print_exc(limit=5)
                results.append({'name':'extension','status':'FAIL','detail':str(exc)})
                print('FAIL frames extension: ' + str(exc), flush=True); h.screenshot('frames-extension')
            finally: h.close()
            browser = pw.chromium.launch(headless=True)
            try:
                context = browser.new_context(viewport=e.VIEWPORT)
                context.add_init_script(script=STUB); context.add_init_script(path=str(bundle))
                page = context.new_page(); page.goto(base + '/frames.html?remote=' + remote)
                wait(page, "__platformFixture.hasCommand('翻译 / 恢复当前页面')")
                detail = exercise(page, lambda: command(page,'翻译 / 恢复当前页面'), lambda: command(page,'切换双语 / 仅译文'), False)
                results.append({'name':'userscript','status':'PASS','detail':detail})
                print('PASS frames userscript: ' + detail, flush=True)
            except Exception as exc:
                traceback.print_exc(limit=5)
                results.append({'name':'userscript','status':'FAIL','detail':str(exc)})
                print('FAIL frames userscript: ' + str(exc), flush=True)
            finally: browser.close()
    finally:
        first.shutdown(); second.shutdown(); e.remove_runtime_dir(run)
    artifact = e.E2E_ROOT / 'artifacts' / 'frames'; artifact.mkdir(parents=True,exist_ok=True)
    (artifact / 'last-run.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    fails = sum(r['status']=='FAIL' for r in results)
    print(f'SUMMARY frames total={len(results)} PASS={len(results)-fails} FAIL={fails} SKIP=0')
    return int(bool(fails))


if __name__ == '__main__':
    raise SystemExit(main())
