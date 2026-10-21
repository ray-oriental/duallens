"""Mock permission lifecycle. Real scripting/revocation, explicit gesture/prompt skips.

Fixture-only manifest reloads grant scoped/broad hosts in an isolated profile. They do
not certify browser gesture delivery or the native optional-permission approval dialog.
"""
import json
import time
import uuid
import run_e2e as e


def until(action, predicate=bool, seconds=10):
    deadline = time.monotonic() + seconds
    value = None
    while time.monotonic() < deadline:
        value = action()
        if predicate(value):
            return value
        time.sleep(.1)
    raise AssertionError('permission condition timed out: ' + str(value))


def main():
    server, base = e.start_fixtures()
    run = e.E2E_ROOT / ('run-permissions-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    passed = skipped = 0
    try:
        ext, missing = e.stage_extension(run, fixture_hosts=False)
        assert not missing, missing
        release = json.loads((ext / 'manifest.json').read_text(encoding='utf-8'))
        worker = ext / 'background/service-worker.js'
        # Capture and invoke the actual registered shortcut handler in the staged copy only.
        worker.write_text("""const testCommands=[];
const addCommand=chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);
chrome.commands.onCommand.addListener=cb=>{testCommands.push(cb);addCommand(cb);};
globalThis.permissionTestCommand=async(name,tabId)=>{for(const cb of testCommands)await cb(name,{id:tabId});};
""" + worker.read_text(encoding='utf-8'), encoding='utf-8')
        with e.sync_playwright() as p:
            h = e.Session(p, ext, base, 'permissions')
            try:
                def bridge():
                    page = h.ctx.new_page()
                    page.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
                    return page

                def restart(hosts):
                    h.ctx.close()
                    manifest = dict(release, host_permissions=release['host_permissions'] + hosts)
                    (ext / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
                    h.start()
                    return bridge()

                h.start()
                ui = bridge()
                broad = lambda: ui.evaluate("() => chrome.permissions.contains({origins:['<all_urls>']})")
                scripts = lambda: ui.evaluate('() => chrome.scripting.getRegisteredContentScripts()')
                ensure = lambda: ui.evaluate("tabId=>chrome.runtime.sendMessage({type:'tab-ensure',tabId})", h.tab_id)
                assert not broad()
                until(scripts, lambda value: not value)
                h.page = h.ctx.new_page(); h.page.goto(base + '/article.html')
                h.page.bring_to_front()
                h.tab_id = h.sw_eval("async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id")
                assert ensure() == {'ok': False, 'reason': 'no-access'}
                assert not h.page.locator('dl-ui,dl-t').count()
                print('PASS default: release manifest has no broad grant, resident scripts or page UI; unauthorized ensure rejected', flush=True)
                passed += 1
                h.page.keyboard.press('Alt+KeyA')
                h.page.wait_for_timeout(600)
                if not h.page.locator('dl-t').count():
                    print('SKIP activeTab-native-gesture: headless synthetic Alt+A does not invoke browser shortcut', flush=True)
                    skipped += 1

                ui = restart([base + '/*'])
                assert not broad()
                h.page = h.ctx.new_page(); h.page.goto(base + '/article.html?scoped=1')
                h.tab_id = h.sw_eval(e.JS_FIND_TAB, h.page.url)
                before = h.page.evaluate('document.body.outerHTML')
                # This shortcut handler must ensure injection itself before sending its command.
                h.sw_eval('async id=>permissionTestCommand("toggle-page",id)', h.tab_id)
                h.wait_units(['#p-plain'])
                h.command('toggle-page')
                until(lambda: h.page.locator('dl-t').count(), lambda count: count == 0)
                assert ensure() == {'ok': True, 'injected': True}
                assert ensure() == {'ok': True, 'injected': True}
                h.command('toggle-page'); h.wait_units(['#p-plain']); h.command('toggle-page')
                until(lambda: h.page.locator('dl-t').count(), lambda count: count == 0)
                assert h.page.evaluate('document.body.outerHTML') == before
                print('PASS scoped: actual shortcut-handler injection and tab-ensure translate/restore; one fixture origin, no broad grant', flush=True)
                passed += 1

                ui = restart(['<all_urls>'])
                # Move the already-granted host to optional, making it genuinely removable.
                ui = restart([])
                assert broad()
                print('SKIP optional-native-prompt: broad grant seeded by fixture manifest reload, not native approval dialog', flush=True)
                skipped += 1
                h.settings({'floatBall': {'enabled': True},'subtitles': {'enabled': True}})
                until(lambda: ui.evaluate("async()=> (await chrome.storage.local.get('settings')).settings.subtitles.enabled"))
                until(scripts, lambda value: any(s['id'] == 'duallens-pages' for s in value))
                page = h.ctx.new_page(); page.goto(base + '/article.html?resident=1')
                until(lambda: page.locator('dl-ui').count())
                print('PASS resident: real broad permission plus opt-in registers and automatically injects new pages', flush=True)
                passed += 1

                assert ui.evaluate("() => chrome.permissions.remove({origins:['<all_urls>']})")
                until(scripts, lambda value: not value)
                until(lambda: ui.evaluate("async()=> (await import('chrome-extension://' + chrome.runtime.id + '/shared/settings.js')).loadSettings()"),
                      lambda settings: not settings['floatBall']['enabled'])
                assert not broad()
                until(lambda: page.locator('dl-ui').count(), lambda count: count == 0)
                new_page = h.ctx.new_page(); new_page.goto(base + '/article.html?revoked=1')
                new_page.wait_for_timeout(400)
                assert not new_page.locator('dl-ui,dl-t').count()
                notice = ui.evaluate("()=>chrome.storage.local.get('ui.permissionsRevoked')")
                assert notice['ui.permissionsRevoked']['features']
                print('PASS revoke: real onRemoved unregisters, saves switches off, clears existing/new page UI and records notice', flush=True)
                passed += 1
                popup=h.ctx.new_page();popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
                popup.locator('#permissions-revoked').wait_for()
                assert '权限已撤销' in popup.locator('#permissions-revoked').inner_text()
                until(lambda:popup.evaluate("()=>chrome.storage.local.get('ui.permissionsRevoked')"),lambda record:not record)
                popup.close()
                print('PASS revoke-popup: notice displayed and consumed by local-storage readback',flush=True)
                passed += 1
            finally:
                h.close()
    except Exception:
        import traceback
        traceback.print_exc()
        print(f'SUMMARY permissions PASS={passed} FAIL=1 SKIP={skipped}', flush=True)
        return 1
    finally:
        server.shutdown(); e.remove_runtime_dir(run)
    print(f'SUMMARY permissions PASS={passed} FAIL=0 SKIP={skipped}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
