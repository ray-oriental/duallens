"""Generate Chrome/Edge store artwork from the real unpacked DualLens extension.

The browser scenes use the same isolated Playwright harness as the public E2E
suite and the deterministic mock provider. No credentials or network requests
are needed. The promo tile is the only deliberately designed scene.
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "store"
FIXTURE = "store-article.html"
ZH_FIXTURE = ROOT / "tests" / "fixtures" / "store-article.zh.json"
STUB_KEY = "sk-test-not-real"
STUB_MODEL = "duallens-store-stub"


def _load_harness():
    sys.path.insert(0, str(ROOT / "tests" / "e2e"))
    import run_e2e  # noqa: PLC0415 - reuse canonical E2E helpers
    return run_e2e


def _screenshot(page, path: Path, width: int = 1280, height: int = 800) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.screenshot(path=str(path), full_page=False)


def _wait_translated(harness, session) -> None:
    session.wait_state(lambda state: state.get("done", 0) >= 1, 30, "real fixture translations")
    session.wait_quiet(30)


def _start_stub_server() -> tuple[ThreadingHTTPServer, str]:
    translations = json.loads(ZH_FIXTURE.read_text(encoding="utf-8"))
    normalized = {re.sub(r"\s+", " ", re.sub(r"</?g\d+>|<x\d+/>", "", key)).strip(): value
                  for key, value in translations.items()}

    class StubHandler(BaseHTTPRequestHandler):
        server_version = "DualLensStoreStub/1.0"

        def log_message(self, format, *args):  # noqa: A002 - quiet local fixture server
            pass

        def _reply(self, status: int, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler API
            if self.path != "/v1/chat/completions":
                self._reply(404, {"error": {"message": "not found"}})
                return
            if self.headers.get("Authorization") != f"Bearer {STUB_KEY}":
                self._reply(401, {"error": {"message": "unauthorized"}})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                messages = payload.get("messages", [])
                user = next(m for m in reversed(messages) if m.get("role") == "user")
                content = str(user.get("content", ""))
                input_text = content[content.index("<input>") + len("<input>"):]
                input_text = input_text[:input_text.index("</input>")]
                values = json.loads(input_text)
                source_items = values["t"]
                if not isinstance(source_items, list):
                    raise ValueError("t must be an array")
                translated = []
                for source in source_items:
                    source = str(source)
                    result = translations.get(source)
                    if result is None:
                        key = re.sub(r"\s+", " ", re.sub(r"</?g\d+>|<x\d+/>", "", source)).strip()
                        result = normalized.get(key)
                    if result is None:
                        raise ValueError(f"missing translation fixture for: {source[:80]}")
                    markers = re.findall(r"</?g\d+>|<x\d+/>", source)
                    for marker in markers:
                        if marker not in result:
                            result += marker
                    translated.append(result)
                assistant = json.dumps({"t": translated}, ensure_ascii=False)
                self._reply(200, {"id": "duallens-store-stub", "object": "chat.completion",
                                  "model": payload.get("model", STUB_MODEL),
                                  "choices": [{"index": 0, "message": {"role": "assistant", "content": assistant},
                                               "finish_reason": "stop"}]})
            except (ValueError, KeyError, IndexError, json.JSONDecodeError) as exc:
                self._reply(400, {"error": {"message": str(exc)}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), StubHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/v1"


def _logo(size: int) -> bytes:
    """Edge Add-ons requires a 1:1 listing logo (300x300 recommended); render the packaged icon's design at that size."""
    spec = importlib.util.spec_from_file_location('duallens_icons', ROOT / 'extension' / 'icons' / 'generate_icons.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.icon(size)


def _promo(page, path: Path, language: str, width: int, height: int) -> None:
    tagline = '安静的双语网页翻译' if language == 'zh-CN' else 'Quiet bilingual web translation'
    large = width > 440
    # The large tile shows what the product does with type alone: one source line and its quiet,
    # muted translation, as the default style renders it. No illustration, gradient or colour.
    pair = ("""<aside><p class='src'>The quiet revolution<br>of the library.</p>
      <p class='dst'>图书馆的悄然变革。</p></aside>""" if large else '')
    page.set_viewport_size({'width': width, 'height': height})
    page.set_content(f"""<!doctype html><html lang='{language}'><meta charset='utf-8'><style>
      *{{box-sizing:border-box}}body{{margin:0;background:#FAFAF9;color:#1C1C1E;
        font-family:system-ui,'Segoe UI','Microsoft YaHei UI',sans-serif}}
      /* A composited layer drops LCD text, so large type renders without colour fringes. */
      main{{height:100vh;display:flex;align-items:center;justify-content:space-between;
        padding:0 {'120' if large else '34'}px;will-change:transform}}
      h1{{font-size:{'88' if large else '46'}px;font-weight:600;letter-spacing:-.04em;margin:0}}
      header p{{font-size:{'28' if large else '18'}px;line-height:1.5;color:#5F6066;margin:{'22' if large else '18'}px 0 0}}
      aside{{border-left:1px solid #DEDED9;padding:6px 0 6px 56px;width:520px}}
      aside p{{margin:0}}
      .src{{font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1.3;color:#1C1C1E}}
      .dst{{font-family:'Microsoft YaHei UI','PingFang SC',sans-serif;font-size:30px;line-height:1.5;
        color:#7A7B80;margin-top:18px}}
      </style><main><header><h1>DualLens</h1><p>{tagline}</p></header>{pair}</main></html>""")
    page.screenshot(path=str(path))


def _popup_overlay(session) -> None:
    """Composite the unmodified real popup over the fixture, as in a toolbar popup.

    An extension popup cannot be embedded in an ordinary web frame. Capture its
    real pixels, then place that capture over the article; never recreate the UI.
    """
    popup = session.ctx.new_page()
    try:
        popup.set_viewport_size({'width': 360, 'height': 600})
        popup.emulate_media(color_scheme='light')
        # Keep the real tab id (the popup messages it) but show a neutral reserved domain, not the
        # local fixture server's 127.0.0.1 address.
        popup.add_init_script('chrome.tabs.query=async()=>'+json.dumps([
            {'id': session.tab_id, 'url': 'https://example.com/field-notes/quiet-interfaces'}])+';')
        popup.goto(f'chrome-extension://{session.ext_id}/ui/popup.html')
        popup.locator('#toggle:not([disabled])').wait_for()
        for feature in ['floatBall','selection','hover','input','subtitles','comics']:
            assert not popup.locator('#feature-'+feature).is_checked()
        pixels = popup.locator('.dl-popup').screenshot()
    finally:
        popup.close()
    session.page.evaluate("""async src=>{const img=document.createElement('img');
      img.id='store-popup-capture';img.src=src;img.alt='DualLens';
      Object.assign(img.style,{position:'fixed',top:'32px',right:'32px',width:'360px',
        boxShadow:'0 8px 24px rgba(0,0,0,.12)',borderRadius:'10px',zIndex:'2147483647'});
      document.body.append(img);await img.decode();}""",
      'data:image/png;base64,'+base64.b64encode(pixels).decode('ascii'))


def generate(output_dir: Path = OUT) -> list[Path]:
    """Generate five 1280x800 screenshots, two promo sizes and the 300x300 Edge logo per UI language."""
    output_dir = output_dir.resolve()
    harness = _load_harness()
    fixture_server = stub_server = session = run_dir = None
    paths: list[Path] = []
    try:
        with sync_playwright() as playwright:
            fixture_server, base = harness.start_fixtures()
            stub_server, stub_base = _start_stub_server()
            run_dir = harness.E2E_ROOT / f'run-store-assets-{uuid.uuid4().hex[:8]}'
            run_dir.mkdir(parents=True)
            ext_dir, missing = harness.stage_extension(run_dir)
            harness.check(not missing, f'extension has missing references: {missing}')
            session = harness.Session(playwright, ext_dir, base, 'store-assets')
            session.start()
            # Fail closed if a scene accidentally tries a public translation service.
            session.ctx.route('https://**/*', lambda route: route.abort())
            for language in ['zh-CN', 'en']:
                target = output_dir / language
                target.mkdir(parents=True, exist_ok=True)
                session.settings({'uiLanguage':language,'targetLang':'zh-CN','style':'muted',
                    'translation':{'mode':'llm'},
                    **{key:{'enabled':False} for key in ['floatBall','selection','hover','input','subtitles','comics']},
                    'provider':{'active':'store-stub','chain':[{'profileId':'store-stub','model':STUB_MODEL}],
                        'profiles':[{'id':'store-stub','kind':'openai','name':'Local screenshot stub',
                            'baseUrl':stub_base,'model':STUB_MODEL,'apiKey':STUB_KEY,
                            'requiresKey':True,'fallbackModels':[],'jsonMode':True,
                            'maxItems':12,'maxChars':6000,'concurrency':2,'timeoutMs':30000}]}})
                session.sw_eval("async()=>{await chrome.storage.local.set({'ui.device':{onboarded:true,acked:[],upgradeNoticeSeen:true}})}")
                session.open(FIXTURE+'?lang='+language)
                session.page.emulate_media(color_scheme='light')
                session.page.set_viewport_size({'width':1280,'height':800})
                session.command('toggle-page')
                _wait_translated(harness, session)
                session.wait_units(['h1','#lead'])
                path = target / '01-bilingual-light.png'
                _screenshot(session.page,path); paths.append(path)

                # Show the real popup with the fresh-install defaults: automatic mode, no AI service, all extras off.
                session.command('toggle-page')
                session.settings({'provider':{'active':'','chain':[]},'translation':{'mode':'mt+llm','mt':{'engine':'microsoft','fallback':True}}})
                _popup_overlay(session)
                path = target / '02-popup.png'
                _screenshot(session.page,path); paths.append(path)
                session.page.evaluate("document.querySelector('#store-popup-capture').remove()")

                options = session.ctx.new_page()
                options.set_viewport_size({'width':1280,'height':800})
                options.emulate_media(color_scheme='light')
                options.goto(f'chrome-extension://{session.ext_id}/ui/options.html#common')
                options.locator('#uiLanguage').wait_for()
                assert options.locator('#uiLanguage').input_value() == language
                path = target / '03-settings-common.png'
                _screenshot(options,path); paths.append(path)
                options.close()

                session.page.close()
                session.open(FIXTURE+'?consent='+language)
                session.page.emulate_media(color_scheme='light')
                session.page.set_viewport_size({'width':1280,'height':800})
                session.command('toggle-page')
                session.page.locator('dl-ui').wait_for(state='attached')
                # A pending, unconfirmed page has no translation wrappers or outgoing text.
                assert session.page.locator('dl-t').count() == 0
                path = target / '04-first-send.png'
                _screenshot(session.page,path); paths.append(path)
                session.page.keyboard.press('Escape')
                session.page.locator('dl-ui').wait_for(state='detached')
                session.page.close()

                session.settings({'provider':{'active':'store-stub','chain':[{'profileId':'store-stub','model':STUB_MODEL}]},
                                  'translation':{'mode':'llm'}})
                session.open(FIXTURE+'?dark='+language)
                session.page.set_viewport_size({'width':1280,'height':800})
                session.page.emulate_media(color_scheme='dark')
                session.command('toggle-page')
                _wait_translated(harness,session)
                session.wait_units(['h1','#lead'])
                path = target / '05-bilingual-dark.png'
                _screenshot(session.page,path); paths.append(path)
                session.page.close()

                promo = session.ctx.new_page()
                for name,width,height in [('00-promo-small.png',440,280),('00-promo-large.png',1400,560)]:
                    path = target / name
                    _promo(promo,path,language,width,height); paths.append(path)
                promo.close()
                path = target / '00-logo-300.png'
                path.write_bytes(_logo(300)); paths.append(path)
    finally:
        if session is not None: session.close()
        if run_dir is not None and run_dir.exists(): harness.remove_runtime_dir(run_dir)
        for server in [fixture_server,stub_server]:
            if server is not None: server.shutdown(); server.server_close()
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,default=OUT)
    args = parser.parse_args(argv)
    paths = generate(args.output_dir)
    print(f'Generated {len(paths)} real-interface store assets in {args.output_dir.resolve()}')
    for path in paths: print(path)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
