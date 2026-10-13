"""Isolated settings-v2 wizard/backup checks; reuses the canonical E2E staging/session.
No accounts or real provider requests. Artifacts stay in the user's E2E cache.
"""
from pathlib import Path
import importlib.util
import json
import sys
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

PROJECT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("duallens_e2e", PROJECT / "tests/e2e/run_e2e.py")
e2e = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = e2e
spec.loader.exec_module(e2e)


def main():
    artifact = e2e.E2E_ROOT / "providers-settings"
    artifact.mkdir(parents=True, exist_ok=True)
    run = e2e.E2E_ROOT / ("run-providers-settings-" + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run, PROJECT / "extension")
    assert not missing, "Missing runtime assets"
    fixture = json.loads((PROJECT / "tests/unit/fixtures/openrouter-models.json").read_text(encoding="utf-8"))
    failures = []
    with e2e.sync_playwright() as p:
        h = e2e.Session(p, ext, "http://127.0.0.1", "providers-settings")
        try:
            h.start()
            h.sw_eval("async () => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); }")
            page = h.ctx.new_page()
            h.page = page
            page.set_viewport_size({"width": 375, "height": 812})
            calls = []

            def mock_request(route):
                req = route.request
                calls.append(req.url)
                if req.url == "https://openrouter.ai/api/v1/models":
                    assert req.headers.get("authorization") is None, "Public discovery sent credentials"
                    assert req.headers.get("x-title") == "DualLens"
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(fixture))
                elif req.url == "https://openrouter.ai/api/v1/chat/completions":
                    assert req.headers.get("authorization") == "Bearer sk-test-not-real"
                    assert req.headers.get("x-title") == "DualLens"
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"choices": [{"message": {"content": '{"t":["你好，世界。"]}'}}]}))
                else:
                    route.abort()

            h.ctx.route("https://**/*", mock_request)
            errors = []
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.goto(f"chrome-extension://{h.ext_id}/ui/options.html")
            page.locator("#status").filter(has_text="修改后").wait_for()
            assert page.locator("#wizard").is_visible()
            assert page.locator("#profile").input_value() == ""
            assert calls == [], "Fresh installation requested a remote service"
            page.screenshot(path=str(artifact / "wizard-375.png"))
            print("PASS fresh_wizard: no selected provider and no automatic network")

            page.select_option("#providerPreset", "openrouter")
            page.click("#add-profile")
            page.locator("#apiKey").fill("sk-test-not-real")
            page.click("#load-models")
            page.locator("#status").filter(has_text="获取到 4").wait_for()
            chain = json.loads(page.locator("#providerChain").input_value())
            assert len(chain) == 3
            assert len({c["model"].split("/")[0] for c in chain}) == 3
            page.click("#test")
            page.locator("#status").filter(has_text="连接正常").wait_for()
            before = h.sw_eval("async () => await chrome.storage.local.get('secrets')")
            assert not before.get("secrets"), "Wizard persisted key before Save"
            page.click("#save")
            page.locator("#status").filter(has_text="已保存").wait_for()
            assert page.locator("#wizard").is_hidden()
            saved = h.sw_eval("async () => ({ local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null) })")
            assert saved["local"]["secrets"]["openrouter"]["apiKey"] == "sk-test-not-real"
            assert "sk-test-not-real" not in json.dumps(saved["sync"])
            assert len(saved["sync"]["settings.core"]["provider"]["chain"]) == 3
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            targets = page.locator(".dl-settings button, .dl-settings select, .dl-settings input:not([type=checkbox]):not([hidden])")
            for n in range(targets.count()):
                box = targets.nth(n).bounding_box()
                if box:
                    assert box["height"] >= 44, "Touch target too small"
                    assert box["x"] >= 0 and box["x"] + box["width"] <= 375, "Control overflows mobile viewport"
            page.locator("#providerPreset").scroll_into_view_if_needed()
            page.screenshot(path=str(artifact / "provider-form-375.png"))
            page.emulate_media(color_scheme="dark")
            page.screenshot(path=str(artifact / "provider-form-375-dark.png"))
            page.emulate_media(color_scheme="light")
            print("PASS wizard_models_test_save: mocked discovery, diverse chain, local-only key, 375px controls >=44px")

            page.locator("#backupPassword").fill("browser test passphrase")
            with page.expect_download() as download:
                page.click("#export")
            download.value.save_as(artifact / "config.encrypted.txt")
            page.locator("#status").filter(has_text="已导出").wait_for()
            encrypted = page.locator("#backupText").input_value()
            assert encrypted.startswith("duallens-config:v1:") and "sk-test-not-real" not in encrypted
            page.locator("#targetLang").select_option("ja")
            page.click("#save")
            page.locator("#status").filter(has_text="已保存").wait_for()
            page.locator("#backupPassword").fill("incorrect")
            page.click("#import-button")
            page.locator("#status").filter(has_text="口令错误").wait_for()
            assert h.sw_eval("async () => (await chrome.storage.local.get('settings')).settings.targetLang") == "ja"
            page.locator("#backupPassword").fill("browser test passphrase")
            page.click("#import-button")
            page.locator("#status").filter(has_text="已导入").wait_for()
            assert page.locator("#targetLang").input_value() == "zh-CN"
            assert h.sw_eval("async () => (await chrome.storage.local.get('secrets')).secrets.openrouter.apiKey") == "sk-test-not-real"
            with page.expect_download() as download:
                page.click("#export")
            download.value.save_as(artifact / "config.public.json")
            page.locator("#status").filter(has_text="已导出").wait_for()
            assert "sk-test-not-real" not in page.locator("#backupText").input_value()
            print("PASS backup_roundtrip: encrypted transfer, wrong-password rejection and key-free plaintext")

            popup = h.ctx.new_page()
            popup.set_viewport_size({"width": 375, "height": 812})
            popup.goto(f"chrome-extension://{h.ext_id}/ui/popup.html")
            popup.locator("#profile").select_option("mock")
            popup.wait_for_function("document.querySelector('#model').value === 'mock'")
            popup.wait_for_function("async () => (await chrome.storage.local.get('settings')).settings?.provider.active === 'mock'")
            assert popup.evaluate("document.documentElement.scrollWidth <= innerWidth")
            popup.screenshot(path=str(artifact / "popup-375.png"))
            assert h.sw_eval("async () => (await chrome.storage.local.get('settings')).settings.provider.active") == "mock"
            assert not errors, "Settings page has JS errors"
            print("PASS popup_service_switch: selected mock and saved without horizontal overflow")

            class Handler(SimpleHTTPRequestHandler):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, directory=str(PROJECT), **kwargs)

                def log_message(self, *_):
                    pass

            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            Thread(target=server.serve_forever, daemon=True).start()
            try:
                independent = h.ctx.new_page()
                independent.set_viewport_size({"width": 375, "height": 812})
                independent.goto(f"http://127.0.0.1:{server.server_port}/tests/dom/form-fixture.html")
                independent.evaluate("""async () => {
                  for(const key of ['storage','runtime','tabs','i18n']) Object.defineProperty(globalThis.chrome, key,
                    { configurable: true, get() { throw new Error('Unexpected extension API'); } });
                  const {createSettingsStore} = await import('/extension/shared/settings.js');
                  const {mountSettingsForm} = await import('/extension/ui/forms/index.js');
                  const data = {}, listeners = new Set();
                  const area = {
                    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k=>Object.hasOwn(data,k)).map(k=>[k,structuredClone(data[k])])); },
                    async set(items) { Object.assign(data,structuredClone(items)); listeners.forEach(cb=>cb(Object.fromEntries(Object.keys(items).map(k=>[k,{}])))); },
                    async remove(keys) { for(const k of keys) delete data[k]; },
                    onChanged(cb) { listeners.add(cb); return ()=>listeners.delete(cb); }
                  };
                  const store = createSettingsStore({syncArea:area,localArea:area});
                  window.fixtureStore = store;
                  window.fixtureForm = await mountSettingsForm(document.querySelector('#form-root'), {store, platform:{kind:'userscript', async http() { throw new Error('Unexpected network'); }}});
                }""")
                independent.select_option("#providerPreset", "mock")
                independent.click("#add-profile")
                independent.click("#load-models")
                independent.locator("#status").filter(has_text="获取到 3").wait_for()
                independent.click("#test")
                independent.locator("#status").filter(has_text="连接正常").wait_for()
                independent.click("#save")
                independent.locator("#status").filter(has_text="已保存").wait_for()
                assert independent.evaluate("async () => (await fixtureStore.load()).provider.active") == "mock-2"
                assert "此设备未同步" in independent.locator("#sync-status").inner_text()
                assert independent.evaluate("document.documentElement.scrollWidth <= innerWidth")
                await_key_setup = "async () => { await fixtureStore.setSecret('mock-2','sk-old-test-not-real'); await fixtureForm.refresh(); }"
                independent.evaluate(await_key_setup)
                independent.locator("#glossary").fill("kernel → 内核")
                independent.evaluate("async () => fixtureStore.setSecret('mock-2','sk-updated-test-not-real')")
                independent.click("#save")
                independent.locator("#status").filter(has_text="已保存").wait_for()
                assert independent.evaluate("async () => await fixtureStore.getSecret('mock-2')") == "sk-updated-test-not-real", "Unedited cached key overwrote an external update"
                independent.screenshot(path=str(artifact / "injected-form-375.png"))
                independent.evaluate("fixtureForm.destroy()")
                assert independent.locator(".dl-settings").count() == 0
                independent.close()
                print("PASS injected_form: shared component with supplied storage/http, chrome API forbidden, destroy cleans up")
            finally:
                server.shutdown()
                server.server_close()
        except Exception as err:
            failures.append(type(err).__name__ + ": " + str(err))
            h.screenshot("providers-settings-failure")
            raise
        finally:
            h.close()
            e2e.remove_runtime_dir(run)
    print("SUMMARY settings-browser total=5 PASS=5 FAIL=0 mock-only viewport=375x812")
    print("ARTIFACTS " + str(artifact))
    return 0


if __name__ == "__main__":
    sys.exit(main())
