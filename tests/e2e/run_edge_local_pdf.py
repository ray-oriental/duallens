"""Local-only Edge regression, outside CI; --chromium / --chrome run comparisons.

Only a keyless extension copy and the repository PDF fixture are loaded.
Profiles are created in the dedicated E2E cache and removed on exit.
"""
from pathlib import Path
import argparse
import json
import shutil
import tempfile
import time
import urllib.request
from playwright.sync_api import Error, sync_playwright

PROJECT = Path(__file__).resolve().parents[2]
CACHE = Path.home() / '.cache' / 'duallens-e2e'
SNAPSHOT = '''async id=>{const tab=await chrome.tabs.get(id);return {
  url:tab.url??null,title:tab.title??null,
  fileAccess:await chrome.extension.isAllowedFileSchemeAccess(),
  status:await chrome.runtime.sendMessage({type:'pdf-status',tabId:id})}}'''


def wait(page, predicate):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if page.evaluate(predicate):
            return
        page.wait_for_timeout(50)
    raise AssertionError('reader did not render the fixture')


def run(p, root, chromium, chrome=False):
    ext = root / 'extension'
    shutil.copytree(PROJECT / 'extension', ext)
    manifest = json.loads((ext / 'manifest.json').read_text(encoding='utf-8'))
    manifest.pop('key', None)
    if chromium:
        # Try a shortcut only in staging; release commands stay intact.
        manifest['commands']['translate-input'].pop('suggested_key', None)
        manifest['commands']['_execute_action'] = {'suggested_key': {'default': 'Alt+Shift+P'}}
    (ext / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    pdf = root / '测试 目录' / 'Thursday Work.pdf'
    pdf.parent.mkdir()
    shutil.copyfile(PROJECT / 'tests/fixtures/pdf-field-notebook.pdf', pdf)
    try:
        ctx = p.chromium.launch_persistent_context(
            str(root / 'profile'), channel=None if chromium else 'chrome' if chrome else 'msedge',
            headless=False, ignore_default_args=['--disable-extensions'],
            args=['--headless=new', '--no-first-run', '--no-default-browser-check',
                  '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
                  '--disable-features=DisableLoadExtensionCommandLineSwitch',
                  f'--load-extension={ext}'])
    except Error as error:
        if not chromium and ('not found' in str(error) or "doesn't exist" in str(error)):
            print(('Chrome' if chrome else 'Edge')+' local PDF: 0 PASS, 0 FAIL, 1 SKIP (browser not installed)')
            return 0
        raise
    try:
        page = ctx.pages[0]
        cdp = ctx.new_cdp_session(page)
        print('VERSION', cdp.send('Browser.getVersion')['product'], flush=True)
        port = (root / 'profile/DevToolsActivePort').read_text().splitlines()[0]
        browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
        browser_cdp = browser.new_browser_cdp_session()
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/protocol', timeout=5) as response:
            protocol = json.load(response)
        methods = [c['name'] for d in protocol['domains'] if d['domain'] == 'Extensions' for c in d.get('commands', [])]
        print('ACTION_PROTOCOL', 'triggerAction' if 'triggerAction' in methods else 'unavailable; trying _execute_action', flush=True)
        if not ctx.service_workers:
            try:
                ctx.wait_for_event('serviceworker', timeout=2000)
            except Error:
                browser_cdp.send('Extensions.loadUnpacked', {'path': str(ext)})
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=15000)
        extension_id = sw.url.split('/')[2]
        manager = ctx.new_page()
        manager.goto('chrome://extensions/')
        manager.evaluate('()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})')
        passed = skipped = 0

        def trigger(url):
            page.bring_to_front()
            if 'triggerAction' not in methods:
                page.keyboard.press('Alt+Shift+P')
                page.wait_for_timeout(200)
                return False
            targets = browser_cdp.send('Target.getTargets', {'filter': [{'exclude': False}]})['targetInfos']
            normalize = lambda value: value.replace('chrome://', 'edge://')
            matches = [t for t in targets if t['type'] == 'tab' and normalize(t['url']) in (normalize(url), normalize(page.url))]
            assert len(matches) == 1, 'could not identify the isolated browser tab'
            browser_cdp.send('Extensions.triggerAction', {'id': extension_id, 'targetId': matches[0]['targetId']})
            return True

        for allowed in [False, True]:
            manager.evaluate('([id,fileAccess])=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,fileAccess})', [extension_id, allowed])
            # File access changes reload the extension and destroy its old pages.
            bridge = ctx.new_page()
            for attempt in range(20):
                try:
                    bridge.goto(f'chrome-extension://{extension_id}/ui/options.html')
                    break
                except Error as error:
                    if 'ERR_BLOCKED_BY_CLIENT' not in str(error) or attempt==19:
                        raise
                    manager.wait_for_timeout(100)
            bridge.evaluate("()=>chrome.storage.local.set({'ui.device':{onboarded:true,acked:[],upgradeNoticeSeen:true}})")
            page.goto(pdf.as_uri())
            page.bring_to_front()
            page.wait_for_timeout(300)
            tab_id = bridge.evaluate('async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].id')

            def record(label):
                result = bridge.evaluate(SNAPSHOT, tab_id)
                print(label, 'ON' if allowed else 'OFF', json.dumps(result, ensure_ascii=False).replace(pdf.as_uri(), 'file:///<fixture>/测试%20目录/Thursday%20Work.pdf'), flush=True)
                return result

            record('BEFORE')
            native = trigger(pdf.as_uri())
            after = record('AFTER_ACTION')
            assert after['fileAccess'] == allowed
            if not native and allowed and after['url'] is None:
                print('SKIP one-click comparison: _execute_action did not grant activeTab; triggerAction unavailable', flush=True)
                skipped += 1
                continue
            if not allowed:
                assert not after['status']['available']
            else:
                assert after['url'] == pdf.as_uri() and after['status']['available']
            # Headless Edge grants activeTab but exposes no toolbar popup target.
            # An inactive popup document uses the same active tab and real grant.
            with ctx.expect_page() as pending:
                bridge.evaluate('()=>chrome.tabs.create({url:chrome.runtime.getURL("ui/popup.html"),active:false})')
            popup = pending.value
            if allowed:
                popup.locator('#pdf-open').wait_for()
                with ctx.expect_page() as pending:
                    popup.click('#pdf-open')
            else:
                popup.locator('#pdf-local-open').wait_for()
                assert popup.locator('#pdf-open').count() == 0
                assert popup.locator('#pdf-local-help').count() == 0
                with ctx.expect_page() as pending:
                    popup.click('#pdf-local-open')
            reader = pending.value
            reader.wait_for_url(f'chrome-extension://{extension_id}/pdf/viewer.html*')
            reader.wait_for_load_state('domcontentloaded')
            if not allowed:
                reader.locator('#local-notice').wait_for()
                assert reader.locator('#local-choose').is_visible()
                assert reader.locator('#status').inner_text() == ''
                assert reader.locator('#local-choose').get_attribute('class') == 'primary'
                assert '允许访问文件网址' in reader.locator('#local-explanation').inner_text()
                with ctx.expect_page() as details_pending:
                    reader.click('#extension-details')
                details = details_pending.value
                details.wait_for_url(lambda url: url.startswith(('edge://extensions/', 'chrome://extensions/')) and extension_id in url)
                print('DETAILS_OPEN', details.url.split('?')[0], flush=True)
                details.close()
                with reader.expect_file_chooser() as chooser:
                    reader.click('#local-choose')
                chooser.value.set_files(str(pdf))
            wait(reader, '()=>document.querySelector(".pdf-page")?.dataset.rendered==="true"')
            assert reader.locator('.pdf-page').count() == 8
            assert '?' not in reader.url
            print('PASS file-access', 'ON one-click' if allowed else 'OFF visible entry -> notice -> primary fixture picker', flush=True)
            passed += 1
            reader.close()
            popup.close()
            for restricted_url in ['chrome://settings/', 'chrome://newtab/', 'about:blank']:
                page.goto(restricted_url)
                page.wait_for_timeout(200)
                trigger(restricted_url)
                record('RESTRICTED ' + restricted_url)
            bridge.close()
        name = 'Chromium comparison' if chromium else 'Chrome local PDF' if chrome else 'Edge local PDF'
        print(f'{name}: {passed} PASS, 0 FAIL, {skipped} SKIP', flush=True)
        return 0
    finally:
        ctx.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--chromium', action='store_true')
    mode.add_argument('--chrome', action='store_true')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='edge-pdf-probe-', dir=CACHE) as temporary:
        with sync_playwright() as p:
            return run(p, Path(temporary), args.chromium, args.chrome)


if __name__ == '__main__':
    raise SystemExit(main())
