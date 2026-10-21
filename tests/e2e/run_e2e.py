#!/usr/bin/env python3
"""DualLens E2E runner: Playwright + Chromium with the extension loaded.

Usage (from the worktree root):
    python tests/e2e/run_e2e.py              run every case
    python tests/e2e/run_e2e.py --smoke      only check that the extension loads and exposes a service worker
    python tests/e2e/run_e2e.py --only lazy  run cases whose name contains "lazy" (repeatable)
    python tests/e2e/run_e2e.py --list       list cases

Design notes:
- Each case gets its own temporary profile under DUALLENS_E2E_OUT/profile-*, removed after the case.
- The extension is copied from extension/ (or --extension-dir) into a temp staging dir.
  Missing or empty manifest references fail before Chromium launches; no placeholders are synthesized.
- Commands go through the service worker: chrome.tabs.sendMessage(tabId, {type:'command', name}). Synthetic Alt+A
  is probed separately (case probe_alt_a) and reported as INFO.
- Settings are written into chrome.storage.local.settings with a deep merge that mirrors mergeSettings() in
  extension/shared/settings.js (arrays and scalars replace, plain objects merge).
- Failure screenshots go to DUALLENS_E2E_OUT/artifacts/<case>.png.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
import sys
import threading
import time
import traceback
import urllib.request
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Error as PWError
from playwright.sync_api import Playwright
from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
EXT_SRC = REPO / "extension"
FIXTURES = REPO / "tests" / "fixtures"

E2E_ROOT = Path(os.environ.get("DUALLENS_E2E_OUT") or Path(tempfile.gettempdir()) / "duallens-e2e").expanduser().resolve()
ARTIFACTS = E2E_ROOT / "artifacts"

# Use the standard Playwright browser cache, or an explicit PLAYWRIGHT_BROWSERS_PATH.
MOCK_PREFIX = "【译】"
MT_PREFIX = "【机翻】"
VIEWPORT = {"width": 1280, "height": 800}

ARTICLE_UNITS = [
    "#h-title", "#p-intro", "#h2-short", "#p-plain", "#p-links", "#p-bold",
    "#p-inline-code", "#div-direct", "#li-1", "#li-2", "#li-3", "#quote-1", "#td-1",
]
EXCLUDED_CODE_ZH_NOTRANSLATE = [
    "#pre-code", "#p-zh", "#notranslate-box", "#p-notranslate", "#translate-no-box", "#p-translate-no",
]
EXCLUDED_NON_TEXT = [
    "#p-numbers", "#p-url", "#p-symbols", "#p-aria-hidden", "#p-display-none",
    "#pw", "#ta", "#ce", "#p-ce",
]


class Skip(Exception):
    """Case cannot run in this environment (not a failure)."""


class Info(Exception):
    """Probe that reports an observation rather than pass/fail."""


def check(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


# ---------------------------------------------------------------- staging

def remove_runtime_dir(path: Path) -> None:
    # Every recursive cleanup target must remain a generated direct child of this local cache.
    target = path.resolve()
    check(target.parent == E2E_ROOT.resolve(), f"refusing cleanup outside E2E cache: {target}")
    check(target.name.startswith(("run-", "profile-")), f"unexpected cleanup target: {target}")
    shutil.rmtree(target, ignore_errors=True)


def manifest_refs(m: dict) -> list[str]:
    refs: list[str] = []
    bg = (m.get("background") or {}).get("service_worker")
    if bg:
        refs.append(bg)
    for cs in m.get("content_scripts") or []:
        refs += list(cs.get("js", [])) + list(cs.get("css", []))
    act = m.get("action") or {}
    if act.get("default_popup"):
        refs.append(act["default_popup"])
    icon = act.get("default_icon") or {}
    refs += [icon] if isinstance(icon, str) else list(icon.values())
    if m.get("options_page"):
        refs.append(m["options_page"])
    if (m.get("options_ui") or {}).get("page"):
        refs.append(m["options_ui"]["page"])
    refs += list((m.get("icons") or {}).values())
    refs += list((m.get("chrome_url_overrides") or {}).values())
    if m.get("devtools_page"):
        refs.append(m["devtools_page"])
    if (m.get("side_panel") or {}).get("default_path"):
        refs.append(m["side_panel"]["default_path"])
    for item in m.get("web_accessible_resources") or []:
        refs += list(item.get("resources", []))
    return sorted(set(refs))


def stage_extension(run_dir: Path, source: Path | None = None, *, fixture_hosts: bool = True) -> tuple[Path, list[str]]:
    dst = run_dir / "ext"
    src = (source or EXT_SRC).resolve()
    if not src.is_dir():
        raise ValueError(f"extension source directory does not exist: {src}")
    shutil.copytree(src, dst)
    manifest = json.loads((dst / "manifest.json").read_text(encoding="utf-8-sig"))
    if fixture_hosts:
        # Legacy interaction cases explicitly exercise passive features and cross-origin frames.
        # Grant access in this disposable fixture only; never alter the release manifest.
        manifest.setdefault('host_permissions', []).append('<all_urls>')
        (dst / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    missing: list[str] = []
    for rel in manifest_refs(manifest):
        path = Path(rel)
        if path.is_absolute() or ".." in path.parts:
            missing.append("unsafe manifest reference: " + rel)
            continue
        matches = list(dst.glob(rel))
        if not matches or not any(t.is_file() and t.stat().st_size > 0 for t in matches):
            missing.append(rel)
    return dst, missing


def save_results(results: list[dict]) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "last-run.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 - base class signature
        pass


def start_fixtures() -> tuple[ThreadingHTTPServer, str]:
    handler = partial(_QuietHandler, directory=str(FIXTURES))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


# ---------------------------------------------------------------- JS snippets

JS_MANIFEST = """() => {
  const m = chrome.runtime.getManifest();
  return { name: m.name, version: m.version, id: chrome.runtime.id };
}"""

JS_SET_SETTINGS = """async (patch) => {
  const deep = (base, over) => {
    if (over === null || typeof over !== 'object' || Array.isArray(over)) return structuredClone(over);
    const out = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {};
    for (const [k, v] of Object.entries(over)) out[k] = deep(out[k], v);
    return out;
  };
  const { loadSettings, saveSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
  const next = await saveSettings(deep(await loadSettings(), patch));
  return next;
}"""

JS_FIND_TAB = """async (url) => {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((t) => t.url === url);
  return tab ? tab.id : null;
}"""

JS_SEND = """async ({ tabId, msg }) => {
  try {
    const response = await chrome.tabs.sendMessage(tabId, msg);
    return { ok: true, response };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}"""

JS_QUIET = """() => document.querySelectorAll('[data-dl-state="pending"]').length === 0"""

# data-dl-id / data-dl-state sit on the dl-t run element (SPEC §5 as clarified by worker-dom), not on its parent.
# A pending dl-t carries only the classes "dl-t dl-inline", so style assertions must wait for data-dl-state="done".
JS_UNITS_DONE = """(sels) => document.querySelectorAll('dl-t[data-dl-state="pending"]').length === 0 &&
  sels.every((s) => { const el = document.querySelector(s); return !!el && !!el.querySelector('dl-t[data-dl-state="done"]'); })"""

JS_COUNT_DL = """() => document.querySelectorAll('dl-t').length"""
JS_ERROR_STATE = """() => document.querySelectorAll('[data-dl-state="error"]').length"""
JS_NESTED_DL = """() => document.querySelectorAll('dl-t dl-t').length"""
# Everything the translation layer adds, including the wrapper dl-w, the retry control dl-r and the classes
# dl-only / dl-solo / dl-hide. The dl-ui shadow host lives under <html>, outside body, so body.outerHTML is unaffected.
JS_NO_TRACE = """() => document.querySelectorAll(
  'dl-t, dl-o, dl-w, dl-r, [data-dl-id], [data-dl-state], .dl-only, .dl-solo, .dl-hide').length === 0"""

JS_STYLE_MUTED = """() => document.querySelectorAll('dl-t[data-dl-state="done"].dl-s-muted').length"""
JS_STYLE_UNDERLINE = """() => document.querySelectorAll('dl-t[data-dl-state="done"].dl-s-dashed').length > 0 &&
  document.querySelectorAll('dl-t.dl-s-muted').length === 0"""

JS_LP_TRANSLATED_COUNT = """() => [...document.querySelectorAll('p.lp')].filter((p) => p.querySelector('dl-t[data-dl-state="done"]')).length"""
JS_LP_TOTAL = """() => document.querySelectorAll('p.lp').length"""
JS_LP_ALL = """() => { const ps = [...document.querySelectorAll('p.lp')];
  return ps.length > 0 && ps.every((p) => !!p.querySelector('dl-t[data-dl-state="done"]')); }"""

JS_CJK_IN_TRANSLATIONS = r"""() => [...document.querySelectorAll('dl-t')]
  .filter((t) => /[一-鿿]/.test(t.textContent)).length"""

# The UI shadow host is <dl-ui>, appended to <html> (outside body). Its shadow root is closed, so the test only
# reads the host's bounding box and clicks its centre. Returns null for pick if the host has no visible box.




def first_diff(a: str, b: str) -> str:
    n = min(len(a), len(b))
    i = next((k for k in range(n) if a[k] != b[k]), n)
    lo = max(0, i - 80)
    return f"first difference at char {i}: before=...{a[lo:i + 80]!r} after=...{b[lo:i + 80]!r} (lengths {len(a)} vs {len(b)})"


# ---------------------------------------------------------------- session

def get_sw(ctx, timeout_s: float = 20.0):
    end = time.time() + timeout_s
    while time.time() < end:
        for w in ctx.service_workers:
            if w.url.startswith("chrome-extension://"):
                return w
        try:
            w = ctx.wait_for_event("serviceworker", timeout=500)
            if w.url.startswith("chrome-extension://"):
                return w
        except PWTimeout:
            pass
    urls = [w.url for w in ctx.service_workers] + [p.url for p in ctx.pages]
    raise RuntimeError(f"extension service worker did not start within {timeout_s:.0f}s; seen: {urls}")


class Session:
    def __init__(self, p: Playwright, ext_dir: Path, base: str, name: str):
        self.p = p
        self.ext_dir = ext_dir
        self.base = base
        self.name = name
        self.profile = E2E_ROOT / f"profile-{name}-{uuid.uuid4().hex[:8]}"
        self.ctx = None
        self.page = None
        self.tab_id = None
        self.ext_id = None

    # lifecycle
    def start(self) -> None:
        self.profile.mkdir(parents=True, exist_ok=True)
        self.ctx = self.p.chromium.launch_persistent_context(
            str(self.profile),
            headless=False,  # the --headless=new flag below keeps it headless while allowing extensions
            args=[
                "--headless=new",
                f"--disable-extensions-except={self.ext_dir}",
                f"--load-extension={self.ext_dir}",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            ignore_default_args=["--disable-extensions"],
            viewport=VIEWPORT,
        )
        sw = get_sw(self.ctx)
        self.ext_id = sw.url.split("/")[2]
        # Legacy cases exercise the LLM path; the double-engine cases below pick their own mode.
        self.settings({"version": 3, "provider": {"active": "mock"}, "translation": {"mode": "llm", "mt": {"engine": "mock"}}, **{f: {"enabled": True} for f in ("selection", "hover", "input", "floatBall", "comics")}})
        # The worker migrates this legacy write asynchronously; a second write racing that migration can be overwritten.
        time.sleep(0.5)

    def close(self) -> None:
        try:
            if self.ctx is not None:
                self.ctx.close()
        except Exception:
            pass
        for _ in range(3):
            remove_runtime_dir(self.profile)
            if not self.profile.exists():
                break
            time.sleep(1)

    def screenshot(self, label: str) -> str | None:
        if self.page is None:
            return None
        try:
            ARTIFACTS.mkdir(parents=True, exist_ok=True)
            path = ARTIFACTS / f"{label}.png"
            self.page.screenshot(path=str(path))
            return str(path)
        except Exception:
            return None

    # service worker
    def sw_eval(self, js: str, arg=None):
        last: Exception | None = None
        for _ in range(3):
            sw = get_sw(self.ctx)
            try:
                return sw.evaluate(js, arg)
            except PWError as e:  # worker may be stopping; re-fetch and retry
                last = e
                time.sleep(0.5)
        raise RuntimeError(f"service worker evaluate failed: {last}")

    def settings(self, patch: dict) -> dict:
        # MV3 workers cannot use dynamic import(). Use an isolated extension page
        # to exercise the public store and await persistence before the next action.
        bridge = self.ctx.new_page()
        try:
            bridge.goto(f'chrome-extension://{self.ext_id}/ui/options.html')
            return bridge.evaluate(JS_SET_SETTINGS, patch)
        finally:
            bridge.close()

    def msg(self, message: dict) -> dict:
        return self.sw_eval(JS_SEND, {"tabId": self.tab_id, "msg": message})

    def command(self, name: str) -> None:
        r = self.msg({"type": "command", "name": name})
        check(bool(r.get("ok")), f"command {name!r} not delivered to the tab: {r.get('error')}")

    def state(self) -> dict | None:
        """get-state response from the content script (SPEC §4.3), sent through the service worker."""
        r = self.msg({"type": "get-state"})
        return r.get("response") if r.get("ok") and isinstance(r.get("response"), dict) else None

    def wait_state(self, pred, timeout: float, what: str) -> dict:
        end = time.time() + timeout
        last = None
        while time.time() < end:
            last = self.state()
            if last is not None and pred(last):
                return last
            time.sleep(0.25)
        shown = json.dumps(last, ensure_ascii=False)[:400] if last is not None else "no response"
        raise AssertionError(f"timed out after {timeout:.0f}s waiting for {what}; last get-state: {shown}")

    def wait_ready(self, timeout: float = 20.0) -> None:
        bridge = self.ctx.new_page()
        try:
            bridge.goto(f'chrome-extension://{self.ext_id}/ui/options.html')
            result = bridge.evaluate("tabId => chrome.runtime.sendMessage({type:'tab-ensure',tabId})", self.tab_id)
            check(result.get('ok'), f'tab-ensure failed: {result}')
        finally:
            bridge.close()
        end = time.time() + timeout
        last = None
        while time.time() < end:
            r = self.msg({"type": "get-state"})
            if r.get("ok") and r.get("response") is not None:
                return
            last = r
            time.sleep(0.3)
        raise AssertionError(f"content script did not answer get-state within {timeout:.0f}s: {last}")

    # page
    def open(self, path: str) -> None:
        self.page = self.ctx.new_page()
        self.page.set_viewport_size(VIEWPORT)
        url = f"{self.base}/{path}"
        self.page.goto(url, wait_until="load")
        end = time.time() + 10
        while time.time() < end:
            self.tab_id = self.sw_eval(JS_FIND_TAB, url)
            if self.tab_id is not None:
                break
            time.sleep(0.2)
        check(self.tab_id is not None, f"extension cannot see tab for {url}")
        self.wait_ready()

    def js(self, expr: str, arg=None):
        return self.page.evaluate(expr, arg)

    def wait_js(self, expr: str, timeout: float = 15.0, arg=None, what: str = "condition"):
        try:
            return self.page.wait_for_function(expr, arg=arg, polling=200, timeout=timeout * 1000)
        except PWTimeout:
            raise AssertionError(f"timed out after {timeout:.0f}s waiting for {what}") from None

    def wait_units(self, selectors: list[str], timeout: float = 30.0) -> None:
        self.wait_js(JS_UNITS_DONE, timeout, arg=list(selectors),
                     what="translations under " + ", ".join(selectors)[:160])

    def wait_quiet(self, timeout: float = 30.0) -> None:
        self.wait_js(JS_QUIET, timeout, what="no pending units")


# ---------------------------------------------------------------- cases

CASES: list[tuple[str, object, str]] = []


def case(name: str, desc: str):
    def deco(fn):
        CASES.append((name, fn, desc))
        return fn
    return deco


@case("smoke_launch", "Chromium 带扩展启动，拿到 service worker 与扩展 id")
def smoke_launch(h: Session) -> str:
    m = h.sw_eval(JS_MANIFEST)
    check(m.get("name", "").startswith("DualLens"), f"unexpected manifest name: {m}")
    return f"ext id={h.ext_id} name={m['name']} version={m['version']}"


@case("probe_alt_a", "（信息）合成的 Alt+A 能否触发 toggle-page，决定是否只能走 SW 消息")
def probe_alt_a(h: Session) -> None:
    h.open("article.html")
    h.page.bring_to_front()
    h.page.keyboard.press("Alt+KeyA")
    time.sleep(3)
    triggered = h.js(JS_COUNT_DL) > 0
    raise Info(
        "synthetic Alt+A " + ("DID" if triggered else "did NOT")
        + " trigger translation; tests use the SW command path"
    )


@case("translate_basic", "toggle-page 后正文段落插入【译】译文，块/行内布局正确，无死循环")
def translate_basic(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    texts = h.js("() => [...document.querySelectorAll('dl-t')].map((t) => t.textContent.trim())")
    check(len(texts) >= len(ARTICLE_UNITS), f"only {len(texts)} dl-t inserted")
    bad = [t[:40] for t in texts if not t.startswith(MOCK_PREFIX)]
    check(not bad, f"translations not starting with {MOCK_PREFIX}: {bad[:3]}")
    check(h.js(JS_ERROR_STATE) == 0, "units in data-dl-state=error")
    # pending dl-t only has "dl-t dl-inline", so the layout class is checked on done runs only
    check(h.js("() => !!document.querySelector('#h2-short dl-t.dl-block[data-dl-state=\"done\"]') && !document.querySelector('#h2-short dl-o')"),
          "short headline must retain its source with a block translation")
    check(h.js("() => !!document.querySelector('#p-plain dl-t.dl-block[data-dl-state=\"done\"]')"),
          "long paragraph is not laid out as dl-block")
    n1 = h.js(JS_COUNT_DL)
    time.sleep(2)
    n2 = h.js(JS_COUNT_DL)
    check(n1 == n2, f"dl-t count changed {n1} -> {n2} after settling (mutation loop?)")
    check(h.js(JS_NESTED_DL) == 0, "nested dl-t found")


@case("links_keep_href", "译文中的链接仍是 <a>，href 与原文一致")
def links_keep_href(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(["#p-links"])
    orig = h.js("() => [...document.querySelectorAll('#p-links > a')].map((a) => a.getAttribute('href'))")
    trans = h.js("() => [...document.querySelectorAll('#p-links dl-t a')].map((a) => a.getAttribute('href'))")
    check(len(orig) == 2, f"fixture expected 2 links, found {len(orig)}")
    check(sorted(trans) == sorted(orig), f"translated links {trans} != original {orig}")


@case("inline_code_verbatim", "行内 code 在译文里原样保留（SPEC §6 xN 占位）")
def inline_code_verbatim(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(["#p-inline-code"])
    codes = h.js("() => [...document.querySelectorAll('#p-inline-code dl-t code')].map((c) => c.textContent)")
    check("npm run build" in codes, f"inline code not preserved in translation: {codes}")


@case("exclusion_code_zh_notranslate", "代码块、中文段、notranslate、translate=no 内没有 dl-t")
def exclusion_code_zh_notranslate(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    for sel in EXCLUDED_CODE_ZH_NOTRANSLATE:
        n = h.js(f"() => {{ const el = document.querySelector({json.dumps(sel)}); "
                 f"return el ? el.querySelectorAll('dl-t').length : -1; }}")
        check(n != -1, f"fixture element {sel} missing")
        check(n == 0, f"{sel} contains {n} dl-t")
    code = h.js("() => document.querySelector('#pre-code code').textContent")
    check(code.startswith("function add"), "code block text changed")


@case("exclusion_non_text_hidden", "数字、URL、符号、aria-hidden、display:none、表单控件、contenteditable 不翻译")
def exclusion_non_text_hidden(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    for sel in EXCLUDED_NON_TEXT:
        if sel=='#p-aria-hidden':
            h.wait_js("() => !!document.querySelector('#p-aria-hidden dl-t[data-dl-state=done]')")
            continue  # aria-hidden alone is not a visual exclusion (leader v0.4 contract)
        n = h.js(f"() => {{ const el = document.querySelector({json.dumps(sel)}); "
                 f"return el ? el.querySelectorAll('dl-t').length : -1; }}")
        check(n != -1, f"fixture element {sel} missing")
        check(n == 0, f"{sel} contains {n} dl-t")
    check(h.js("() => document.querySelector('#pw').value") == "", "password field value changed by page translation")


@case("restore_identical_dom", "恢复原文后 body 的 outerHTML 与翻译前完全一致")
def restore_identical_dom(h: Session) -> None:
    h.open("article.html")
    time.sleep(1)
    before = h.js("() => document.body.outerHTML")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    h.command("toggle-page")
    h.wait_js(JS_NO_TRACE, 10, what="extension markup removed after restore")
    after = h.js("() => document.body.outerHTML")
    check(after == before, "restore did not give back identical DOM: " + first_diff(before, after))


@case("translation_only_toggle", "仅译文：宿主 dl-only、原文包在 dl-o.dl-hide 中、译文 dl-solo；innerText 上原文不可见；切回双语恢复")
def translation_only_toggle(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    h.command("toggle-translation-only")
    h.wait_js(
        """() => { const u = document.querySelector('#p-plain');
          return !!u && u.classList.contains('dl-only') && !!u.querySelector('dl-o.dl-hide')
              && !!u.querySelector('dl-t.dl-solo'); }""",
        10, what="translation-only markup: host .dl-only, original in dl-o.dl-hide, translation .dl-solo",
    )
    h.wait_js(
        """() => { const el = document.querySelector('#p-plain');
          const original = el && el.querySelector('dl-o.dl-hide');
          const translated = el && el.querySelector('dl-t.dl-solo');
          return original && translated && getComputedStyle(original).display === 'none'
              && original.getClientRects().length === 0 && translated.getClientRects().length > 0; }""",
        10, what="translation-only mode hides the original paragraph",
    )
    visible = h.js("() => { const t = document.querySelector('#p-plain dl-t.dl-solo');"
                   " return !!t && t.getClientRects().length > 0; }")
    check(visible, "translation not visible in translation-only mode")
    h.command("toggle-translation-only")
    h.wait_js(
        """() => { const el = document.querySelector('#p-plain');
          return !!el && !el.classList.contains('dl-only') && !el.querySelector('dl-t.dl-solo')
              && el.innerText.includes('【译】') && el.innerText.includes('Good translation tools'); }""",
        10, what="bilingual mode: no dl-only/dl-solo, original and translation both visible",
    )


@case("lazy_viewport", "long.html：仅译视口附近，逐段访问后全部翻译，不跳过未访问段落")
def lazy_viewport(h: Session) -> None:
    h.open("long.html")
    total = h.js(JS_LP_TOTAL)
    check(total >= 200, f"fixture has {total} paragraphs, expected >= 200")
    h.command("toggle-page")
    h.wait_js("() => !!document.querySelector('#lp-001 dl-t[data-dl-state=\"done\"]')", 20,
              what="first paragraph translated")
    h.wait_quiet()
    initial = h.js(JS_LP_TRANSLATED_COUNT)
    check(0 < initial < total * 0.5,
          f"before scrolling {initial}/{total} paragraphs translated; expected a viewport-sized subset")
    check(not h.js("() => !!document.querySelector('#lp-200 dl-t')"),
          "paragraph 200 translated before any scrolling")
    # Translation grows page height; visit every source paragraph rather than skipping
    # never-seen viewports by jumping to the bottom of the enlarged page.
    for i in range(1, total + 1, 5):
        h.page.locator(f"#lp-{i:03}").scroll_into_view_if_needed()
        time.sleep(0.16)
    h.page.locator("#lp-220").scroll_into_view_if_needed()
    h.wait_js("() => !!document.querySelector('#lp-220 dl-t[data-dl-state=\"done\"]')", 40,
              what="last paragraph translated after scroll")
    h.wait_js(JS_LP_ALL, 30, what="all paragraphs translated after every viewport was visited")


@case("dynamic_timed_append", "dynamic.html：定时追加的段落也会被翻译")
def dynamic_timed_append(h: Session) -> None:
    h.open("dynamic.html")
    h.command("toggle-page")
    h.wait_units(["#p-static", "#app-initial"])
    h.wait_js("() => document.querySelectorAll('#feed p').length >= 6", 20, what="six timed items appended")
    h.wait_units([f"#dyn-{i}" for i in range(1, 7)], 40)


@case("dynamic_spa_pushstate", "dynamic.html：history.pushState 换内容后，新内容被翻译")
def dynamic_spa_pushstate(h: Session) -> None:
    h.open("dynamic.html")
    h.command("toggle-page")
    h.wait_units(["#p-static", "#app-initial"])
    h.js("() => window.__dlFixture.navigate('route-2')")
    h.wait_units([f"#spa-route-2-{i}" for i in (1, 2, 3)], 30)
    check(h.js("() => location.pathname") == "/spa/route-2", "pushState did not change the path")
    check(not h.js("() => !!document.querySelector('#app-initial')"), "old route content still in #app")


@case("style_change_syncs", "修改 settings.style 后，已插入译文的类名同步变化")
def style_change_syncs(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    check(h.js(JS_STYLE_MUTED) > 0, "default style class dl-s-muted not applied")
    h.settings({"style": "underline"})
    h.wait_js(JS_STYLE_UNDERLINE, 10, what="translations switched to dl-s-underline")


@case("quiet_defaults_explicit_selection", "增强功能关闭时无页面控件；显式右键选中文字仍可用")
def quiet_defaults_explicit_selection(h: Session) -> None:
    h.settings({feature: {"enabled": False} for feature in ("floatBall", "selection", "hover", "input", "comics")})
    h.open("article.html")
    h.page.locator("#p-plain").click(click_count=3)
    h.page.wait_for_timeout(350)
    check(h.js("() => document.querySelectorAll('dl-ui,dl-t').length") == 0, "disabled features created page UI or translations")
    state = h.state()
    check(not state['ui']['floatBall'] and not state['ui']['selectionIcon'], "quiet features are visible")
    result = h.msg({"type": "translate-selection", "text": "Explicitly selected original text."})
    check(result.get('response', {}).get('ok'), "explicit selection command was disabled")
    h.wait_state(lambda s: ((s['ui'].get('selectionCard') or {}).get('text') or '').startswith(MOCK_PREFIX), 10,
                 "explicit selection translates while passive selection stays off")


@case("input_triple_space_textarea", "textarea 输入英文后连按三次空格，内容变成【译】…")
def input_triple_space_textarea(h: Session) -> None:
    h.open("article.html")
    h.page.click("#ta")
    h.page.locator("#ta").press_sequentially("Please check the deadline for the lab report.", delay=10)
    for _ in range(3):
        h.page.keyboard.press("Space")
    h.wait_js(
        """() => document.querySelector('#ta').value.trim().startsWith('【译】')""",
        10, what="textarea content to start with 【译】",
    )


@case("input_password_untouched", "密码框连按三次空格不翻译（内容只多出空格）")
def input_password_untouched(h: Session) -> None:
    h.open("article.html")
    original = "correct horse battery"
    h.page.click("#pw")
    h.page.locator("#pw").press_sequentially(original, delay=10)
    for _ in range(3):
        h.page.keyboard.press("Space")
    time.sleep(2)
    value = h.js("() => document.querySelector('#pw').value")
    check("【译】" not in value, f"password field was translated: {value!r}")
    check(value.rstrip() == original, f"password field content changed: {value!r}")


@case("selection_icon_and_card", "划词：按选区坐标点击按钮，不读closed shadow；卡片显示mock译文")
def selection_icon_and_card(h: Session) -> None:
    h.open("article.html")
    h.page.locator("#p-plain").click(click_count=3)
    selected = h.js("() => window.getSelection().toString()")
    check("Good translation tools" in selected, f"selection not made: {selected[:60]!r}")
    h.wait_state(lambda s: ((s.get("ui") or {}).get("selectionIcon")) is True, 10,
                 "ui.selectionIcon === true")
    # The closed-shadow host is intentionally zero-sized. The button itself sits beside
    # the last selection rect, so click its actual viewport coordinates without opening shadow DOM.
    pick = h.js("""() => {
      const rects = getSelection().getRangeAt(0).getClientRects();
      const r = rects[rects.length - 1];
      return { x: Math.min(innerWidth - 36, Math.max(4, r.right + 4)) + 14,
               y: Math.min(innerHeight - 36, Math.max(4, r.bottom + 6)) + 14 };
    }""")
    h.page.mouse.click(pick["x"], pick["y"])
    st = h.wait_state(
        lambda s: (((s.get("ui") or {}).get("selectionCard") or {}).get("text") or "").startswith(MOCK_PREFIX),
        10, "selection card has translated text",
    )
    card = (st.get("ui") or {}).get("selectionCard") or {}
    check(card.get("visible"), "selection card is not visible")
    text = card.get("text") or ""
    check(text.startswith(MOCK_PREFIX), f"selection card text does not start with {MOCK_PREFIX}: {text[:60]!r}")
    source = card.get("source") or ""
    check("Good translation tools" in source, f"selection card source is not the original text: {source[:60]!r}")


@case("hover_shift", "悬停翻译：按住 Shift 悬停段落，页面上 #p-plain 下出现以【译】开头的 dl-t")
def hover_shift(h: Session) -> None:
    h.open("article.html")
    box = h.page.locator("#p-plain").bounding_box()
    check(box is not None, "fixture paragraph has no box")
    h.page.mouse.move(5, 5)
    h.page.mouse.move(box["x"] + 30, box["y"] + 10, steps=5)
    h.page.keyboard.down("Shift")
    try:
        h.page.mouse.move(box["x"] + 40, box["y"] + 12, steps=5)
        h.wait_js(
            """() => [...document.querySelectorAll('#p-plain dl-t[data-dl-state="done"]')].some((t) => t.textContent.trim().startsWith('【译】'))""",
            10, what="hover translation dl-t (done) under #p-plain",
        )
    finally:
        h.page.keyboard.up("Shift")


@case("v2_sync_hover", "v2 同步设置更新；对象键重排保留悬停译文，真实设置变化生效")
def v2_sync_hover(h: Session) -> None:
    hover_shift(h)
    before = h.page.locator('#p-plain dl-t').inner_text()
    h.sw_eval("""async () => {
      const reorder = v => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).reverse().map(k => [k,reorder(v[k])])) : v;
      const got = await chrome.storage.sync.get('settings.core');
      await chrome.storage.sync.set({'settings.core':reorder(got['settings.core'])});
    }""")
    h.page.wait_for_timeout(300)
    check(h.page.locator('#p-plain dl-t').inner_text() == before, 'key reordering cleared the hover unit')
    h.sw_eval("""async () => {
      const got = await chrome.storage.sync.get('settings.core');
      await chrome.storage.sync.set({'settings.core': {...got['settings.core'], style:'highlight', displayMode:'translation-only',hover:{enabled:false,modifier:'Shift'}}});
    }""")
    h.wait_js("() => document.querySelector('#p-plain.dl-only dl-t.dl-s-highlight')", 10, what='sync-only mode and style applied')
    h.wait_state(lambda s: not s['ui']['hoverActive'], 5, 'sync-only hover disabled')
    h.sw_eval("""async () => {
      const got = await chrome.storage.sync.get('settings.core');
      await chrome.storage.sync.set({'settings.core': {...got['settings.core'],targetLang:'ja'}});
    }""")
    h.wait_js("() => !document.querySelector('#p-plain dl-t')", 10, what='target change invalidated old hover translation')


@case("structure_mixed_and_flex", "结构：混合内容的 run 单元 data-dl-* 挂在 dl-t 上而非父 li；flex 宿主内多一层 dl-w")
def structure_mixed_and_flex(h: Session) -> None:
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(["#li-mixed", "#li-nested", "#flex-host"])
    parent_marked = h.js("() => document.querySelector('#li-mixed').hasAttribute('data-dl-id')")
    check(not parent_marked, "parent li of a mixed-content run carries data-dl-id; it belongs on the dl-t")
    run_marked = h.js(
        """() => [...document.querySelectorAll('#li-mixed dl-t')]
            .filter((t) => !t.closest('#li-nested'))
            .some((t) => t.hasAttribute('data-dl-id') && t.getAttribute('data-dl-state') === 'done')"""
    )
    check(run_marked, "mixed-content run dl-t lacks data-dl-id / data-dl-state=done")
    check(h.js("() => !!document.querySelector('#flex-host dl-w dl-t[data-dl-state=\"done\"]')"),
          "flex container translation is not wrapped in dl-w")


@case("ui_settings", "设置页保存、显式模型选择、密钥输入遮蔽")
def ui_settings(h: Session) -> None:
    page = h.ctx.new_page()
    page.goto(f"chrome-extension://{h.ext_id}/ui/options.html")
    page.locator('#status').filter(has_text='修改后').wait_for(timeout=10000)
    page.select_option('#targetLang', 'ja')
    page.locator('nav a[href="#glossary"]').click()
    page.locator('#glossary').fill('kernel → 内核')
    page.locator('#save-glossary').click()
    page.locator('#status').filter(has_text='已保存').wait_for(timeout=10000)
    s = h.sw_eval("async () => (await chrome.storage.local.get('settings')).settings")
    check(s['targetLang'] == 'ja' and s['glossary'][0]['dst'] == '内核', 'options did not persist settings')
    page.locator('nav a[href="#ai"]').click()
    page.select_option('#profile', 'openai')
    page.locator('#model').fill('example/model')
    page.locator('#save').click()
    page.locator('#status').filter(has_text='已保存').wait_for(timeout=10000)
    s = h.sw_eval("async () => (await chrome.storage.local.get('settings')).settings")
    check(s['provider']['profiles'][0]['fallbackModels'] == [], 'explicit model selection unexpectedly added fallback models')
    check(page.locator('#apiKey').get_attribute('type') == 'password', 'API key input not concealed')
    page.close()


@case("paragraph_edit", "动态追加行内span、修改原文与恢复，不产生嵌套译文")
def paragraph_edit(h: Session) -> None:
    h.open('article.html')
    h.command('toggle-page')
    h.wait_units(['#p-plain'])
    h.js("""() => { const s=document.createElement('span'); s.textContent=' Another newly appended sentence about working translation.'; document.querySelector('#p-plain').append(s); }""")
    h.wait_js("() => document.querySelector('#p-plain dl-t[data-dl-state=done]')?.textContent.includes('newly appended sentence')", 10, what='appended inline text translated')
    check(h.js("() => document.querySelectorAll('#p-plain dl-t').length") == 1, 'append created nested duplicate translation')
    h.js("() => document.querySelector('#p-plain').firstChild.data='The paragraph was replaced with a different original sentence.'")
    h.wait_js("() => document.querySelector('#p-plain dl-t[data-dl-state=done]')?.textContent.includes('different original sentence')", 10, what='changed original text translated')
    h.command('toggle-page')
    check(h.js("() => document.querySelector('#p-plain').textContent.includes('newly appended sentence')"), 'restore lost dynamically appended original')


@case("never_wake", "从不→总是唤醒，重新从不后恢复DOM且移除UI")
def never_wake(h: Session) -> None:
    h.settings({'siteRules': {'never': ['127.0.0.1']}})
    h.open('article.html')
    # Settings load asynchronously after start(); poll instead of sampling the first answer.
    h.wait_state(lambda st: st and st.get('dormant'), 10, 'never site dormant')
    check(h.js("() => document.querySelectorAll('dl-ui').length") == 0, 'dormant site contains extension UI')
    h.settings({'siteRules': {'never': [], 'always': ['127.0.0.1']}})
    h.wait_units(['#p-plain'])
    check(not h.state()['dormant'], 'never-to-always did not wake')
    h.settings({'siteRules': {'never': ['127.0.0.1'], 'always': []}})
    h.wait_state(lambda s: s['dormant'], 10, 'site dormant again')
    check(h.js("() => document.querySelectorAll('dl-t,dl-o,dl-ui').length") == 0, 'sleep left translated DOM or overlay')


@case("site_path_rules", "路径自动/从不、SPA往返、功能关闭与手动恢复")
def site_path_rules(h: Session) -> None:
    from site_rules_cases import extension_case
    extension_case(h)


@case("input_edit_race", "输入框翻译不能覆盖请求期间新输入的文字")
def input_edit_race(h: Session) -> None:
    h.open('article.html')
    h.page.locator('#ta').fill('A sentence awaiting input translation.')
    h.page.locator('#ta').focus()
    h.command('translate-input')
    h.page.locator('#ta').fill('New user text typed during translation.')
    h.page.wait_for_timeout(400)
    check(h.page.locator('#ta').input_value() == 'New user text typed during translation.', 'translation overwrote concurrent user editing')


@case("clone_safety", "译文克隆去onclick/javascript，恢复保留原文链接属性")
def clone_safety(h: Session) -> None:
    h.open('article.html')
    h.js("""() => { const p=document.createElement('p'); p.id='unsafe-links'; p.append('This original paragraph has a '); const a=document.createElement('a'); a.textContent='clickable original link'; a.setAttribute('href','javascript:void(0)'); a.setAttribute('onclick','window.originalAction=true'); p.append(a); document.body.prepend(p); }""")
    h.command('toggle-page')
    h.wait_units(['#unsafe-links'])
    check(h.js("""() => { const a=document.querySelector('#unsafe-links dl-t a'); return a && !a.hasAttribute('onclick') && !a.hasAttribute('href'); }"""), 'translated clone retained executable inline attributes')
    h.command('toggle-page')
    check(h.js("() => document.querySelector('#unsafe-links a').hasAttribute('onclick')"), 'restore changed original link attributes')


@case("native_attributes_restore", "实际翻译后严格恢复网页既有data-dl-state/dl-only，保留未触碰data-dl-id")
def native_attributes_restore(h: Session) -> None:
    h.open('article.html')
    h.js("""() => {
      for (const id of ['p-plain', 'p-zh']) {
        const p=document.getElementById(id); p.setAttribute('data-dl-state','ready');
        p.setAttribute('class','site-class dl-only trailing-class');
      }
      // The existing data-dl-id marker makes this separate source unit dormant in walker.
      // Keep it as preservation coverage; the other paragraph MUST actually translate.
      const p=document.getElementById('p-intro');
      p.setAttribute('data-dl-id','site'); p.setAttribute('data-dl-state','ready');
      p.setAttribute('class','site-class dl-only trailing-class');
    }""")
    before=h.js("() => document.body.outerHTML")
    h.command('toggle-page')
    h.wait_units(['#p-plain'])
    check(h.js("() => !!document.querySelector('#p-plain dl-t[data-dl-state=done]')"), 'state/class regression did not translate the actual paragraph')
    h.command('toggle-translation-only')
    h.wait_js("() => !!document.querySelector('#p-plain dl-o')",10,what='original wrapper')
    h.command('toggle-page')
    after=h.js("() => document.body.outerHTML")
    check(after==before,'restore changed pre-existing page attributes: '+first_diff(before,after))


@case("toast_expiry_cleanup", "无焦点输入提示到期detach，设从不时立即移除提示和UI")
def toast_expiry_cleanup(h: Session) -> None:
    h.open('article.html')
    h.wait_state(lambda s:(s.get('ui') or {}).get('floatBall'),5,'floating ball ready')
    baseline=h.js("() => document.querySelectorAll('dl-ui').length")
    h.command('translate-input')
    h.wait_js("count => document.querySelectorAll('dl-ui').length === count + 1",5,arg=baseline,what='toast host added')
    h.page.wait_for_timeout(2800)
    h.wait_js("count => document.querySelectorAll('dl-ui').length === count",5,arg=baseline,what='toast host removed after expiry')
    h.command('translate-input')
    h.wait_js("count => document.querySelectorAll('dl-ui').length === count + 1",5,arg=baseline,what='second toast host added')
    h.settings({'siteRules': {'never': ['127.0.0.1']}})
    h.wait_state(lambda s:s['dormant'],5,'site dormant')
    check(h.js("() => document.querySelectorAll('dl-ui').length") == 0,'never site retained toast or other UI hosts')


JS_STAGE_PROBE = """(sel) => { const t = document.querySelector(sel + ' dl-t'); return t ? { stage: t.getAttribute('data-dl-stage'),
  state: t.getAttribute('data-dl-state'), text: t.textContent.trim(), probe: t.getAttribute('data-probe'), cls: t.className } : null; }"""

SLOW_MOCK = {"provider": {"active": "mock", "profiles": [{"id": "mock", "kind": "mock", "name": "mock", "model": "mock-slow"}]}}
ERROR_MOCK = {"provider": {"active": "mock", "profiles": [{"id": "mock", "kind": "mock", "name": "mock", "model": "mock-error"}]}}
DOUBLE = {"translation": {"mode": "mt+llm", "mt": {"engine": "mock"}}}


@case("double_draft_then_final", "mt+llm：机翻草稿先出（data-dl-stage=draft，【机翻】），慢模型结果原位替换同一 dl-t；恢复后 DOM 逐字节一致")
def double_draft_then_final(h: Session) -> str:
    h.settings({**DOUBLE, **SLOW_MOCK})
    h.open("article.html")
    time.sleep(1)
    h.screenshot("double_before")  # Playwright's screenshot leaves empty style attributes on form fields; take the baseline after one
    before = h.js("() => document.body.outerHTML")
    t0 = time.time()
    h.command("toggle-page")
    h.wait_js("""() => { const t = document.querySelector('#p-plain dl-t'); return !!t && t.getAttribute('data-dl-stage') === 'draft'; }""",
              10, what="machine draft in #p-plain")
    draft_ms = int((time.time() - t0) * 1000)
    first = h.js(JS_STAGE_PROBE, "#p-plain")
    check(first["text"].startswith(MT_PREFIX), f"draft is not the machine translation: {first['text'][:40]!r}")
    check(first["state"] == "done", f"draft state is {first['state']!r}")
    st = h.wait_state(lambda s: s["pending"] == 0 and s["refining"] > 0, 5, "every unit shows its draft while the slow model works")
    shot = h.screenshot("double_draft")
    h.js("() => document.querySelector('#p-plain dl-t').setAttribute('data-probe', 'same-element')")
    h.wait_js("""() => document.querySelector('#p-plain dl-t')?.getAttribute('data-dl-stage') === 'final'""", 15, what="LLM final replaces the draft")
    last = h.js(JS_STAGE_PROBE, "#p-plain")
    check(last["text"].startswith(MOCK_PREFIX), f"final is not the LLM text: {last['text'][:40]!r}")
    check(last["probe"] == "same-element", "the draft element was replaced instead of updated in place")
    check(last["cls"] == first["cls"], f"class list changed between draft and final: {first['cls']!r} -> {last['cls']!r}")
    h.wait_state(lambda s: s["refining"] == 0 and s["pending"] == 0, 15, "refinement settled")
    check(h.js("() => document.querySelectorAll('dl-t[data-dl-stage=\"draft\"]').length") == 0, "a draft is left behind")
    h.command("toggle-page")
    h.wait_js(JS_NO_TRACE, 10, what="extension markup removed after restore")
    after = h.js("() => document.body.outerHTML")
    check(after == before, "restore did not give back identical DOM: " + first_diff(before, after))
    return f"draft after {draft_ms} ms (screenshot {shot})"


@case("double_translation_only_in_place", "仅译文模式下草稿→终稿同样原位替换，原文保持隐藏")
def double_translation_only_in_place(h: Session) -> None:
    h.settings({"displayMode": "translation-only", **DOUBLE, **SLOW_MOCK})
    h.open("article.html")
    h.command("toggle-page")
    h.wait_js("""() => document.querySelector('#p-plain dl-t')?.getAttribute('data-dl-stage') === 'draft'""", 10, what="draft")
    check(h.js("() => !!document.querySelector('#p-plain dl-o.dl-hide') && document.querySelector('#p-plain dl-t').classList.contains('dl-solo')"),
          "translation-only layout is missing during the draft")
    h.wait_js("""() => document.querySelector('#p-plain dl-t')?.getAttribute('data-dl-stage') === 'final'""", 15, what="final")
    check(h.js("() => document.querySelectorAll('#p-plain dl-o').length") == 1, "original wrapper was duplicated or lost")
    check(h.js("() => document.querySelector('#p-plain dl-t').textContent.trim()").startswith(MOCK_PREFIX), "final text missing")


@case('double_cancel_before_final', '草稿可读时恢复原文，迟到的 LLM 结果不得重新插入 DOM')
def double_cancel_before_final(h: Session) -> None:
    h.settings({**DOUBLE, **SLOW_MOCK})
    h.open('article.html')
    before = h.js('() => document.body.outerHTML')
    h.command('toggle-page')
    h.wait_js("() => document.querySelector('#p-plain dl-t')?.getAttribute('data-dl-stage') === 'draft'", 10, what='draft before cancellation')
    h.command('toggle-page')
    h.wait_js(JS_NO_TRACE, 10, what='restore after draft')
    h.page.wait_for_timeout(2500)
    check(h.js('() => document.body.outerHTML') == before, 'late refinement changed the restored DOM')


@case("no_llm_still_translates", "新安装（没有任何模型配置）：默认模式 mt+llm 退化为机器翻译，页面直接出译文，无错误标记")
def no_llm_still_translates(h: Session) -> None:
    h.settings({**DOUBLE, "provider": {"active": "", "chain": []}})
    h.open("article.html")
    h.command("toggle-page")
    h.wait_units(ARTICLE_UNITS)
    texts = h.js("() => [...document.querySelectorAll('dl-t')].map((t) => t.textContent.trim())")
    bad = [t[:40] for t in texts if not t.startswith(MT_PREFIX)]
    check(texts and not bad, f"machine translation expected everywhere, got {bad[:3]}")
    check(h.js(JS_ERROR_STATE) == 0, "units in error state")
    check(h.js("() => document.querySelectorAll('dl-t[data-dl-stage=\"final\"]').length") == len(texts), "machine-only results must be final")
    h.command("toggle-page")
    h.wait_js(JS_NO_TRACE, 10, what="clean restore")


@case("llm_failure_keeps_draft", "大模型失败时保留机翻草稿：没有错误标记、没有重试控件")
def llm_failure_keeps_draft(h: Session) -> None:
    # The failing model would be retried with a cooldown for minutes; the refinement budget ends that wait.
    h.settings({"translation": {"mode": "mt+llm", "refineTimeoutMs": 3000, "mt": {"engine": "mock"}}, **ERROR_MOCK})
    h.open("article.html")
    h.command("toggle-page")
    h.wait_state(lambda s: s["units"] > 5 and s["pending"] == 0 and s["refining"] == 0, 20, "settled with machine results only")
    check(h.js(JS_ERROR_STATE) == 0, "an error marker appeared although the draft was good")
    check(h.js("() => document.querySelectorAll('dl-r').length") == 0, "retry control shown")
    first = h.js(JS_STAGE_PROBE, "#p-plain")
    check(first["text"].startswith(MT_PREFIX) and first["stage"] == "final", f"draft not kept: {first}")


@case("selection_machine_first", "划词卡片默认机翻；translate-text 带 mode=llm 即「精修」返回大模型译文")
def selection_machine_first(h: Session) -> None:
    h.settings(DOUBLE)
    h.open("article.html")
    h.page.locator("#p-plain").click(click_count=3)
    h.wait_state(lambda s: ((s.get("ui") or {}).get("selectionIcon")) is True, 10, "selection icon")
    pick = h.js("""() => { const rects = getSelection().getRangeAt(0).getClientRects(); const r = rects[rects.length - 1];
      return { x: Math.min(innerWidth - 36, Math.max(4, r.right + 4)) + 14, y: Math.min(innerHeight - 36, Math.max(4, r.bottom + 6)) + 14 }; }""")
    h.page.mouse.click(pick["x"], pick["y"])
    st = h.wait_state(lambda s: (((s.get("ui") or {}).get("selectionCard") or {}).get("text") or "").startswith(MT_PREFIX), 10,
                      "card shows the machine translation")
    check(((st["ui"]["selectionCard"]) or {}).get("visible"), "card hidden")
    shot = h.screenshot("selection_machine_first")
    page = h.ctx.new_page()
    page.goto(f"chrome-extension://{h.ext_id}/ui/options.html")
    send = """async (extra) => chrome.runtime.sendMessage({ type: 'translate-text', text: 'Good translation tools', to: 'zh-CN', purpose: 'selection', ...extra })"""
    refined = page.evaluate(send, {"mode": "llm"})
    check(refined.get("ok") and refined.get("by") == "llm" and refined["text"].startswith(MOCK_PREFIX), f"refine request: {refined}")
    quick = page.evaluate(send, {})
    page.close()
    check(quick.get("by") == "mt" and quick["text"].startswith(MT_PREFIX), f"default selection translation: {quick}")


@case("hover_uses_machine_translation", "悬停翻译默认走机翻（秒出），不等 2 秒的慢模型")
def hover_uses_machine_translation(h: Session) -> None:
    h.settings({**DOUBLE, **SLOW_MOCK})
    h.open("article.html")
    box = h.page.locator("#p-plain").bounding_box()
    h.page.mouse.move(5, 5)
    h.page.mouse.move(box["x"] + 30, box["y"] + 10, steps=5)
    h.page.keyboard.down("Shift")
    try:
        h.page.mouse.move(box["x"] + 40, box["y"] + 12, steps=5)
        h.wait_js("""() => [...document.querySelectorAll('#p-plain dl-t[data-dl-state="done"]')].some((t) => t.textContent.trim().startsWith('【机翻】'))""",
                  1.8, what="machine hover translation well before the 2 s slow model")
    finally:
        h.page.keyboard.up("Shift")


# ---------------------------------------------------------------- runner

def run_case(p: Playwright, name: str, fn, ext_dir: Path, base: str) -> dict:
    h = Session(p, ext_dir, base, name)
    started = time.time()
    status, detail = "PASS", ""
    try:
        h.start()
        ret = fn(h)
        if isinstance(ret, str):
            detail = ret
    except Skip as e:
        status, detail = "SKIP", str(e)
    except Info as e:
        status, detail = "INFO", str(e)
    except AssertionError as e:
        status, detail = "FAIL", str(e)
        shot = h.screenshot(name)
        if shot:
            detail += f"\n      screenshot: {shot}"
    except Exception as e:  # noqa: BLE001 - report any infrastructure failure as a failed case
        status, detail = "FAIL", f"{type(e).__name__}: {e}"
        tb = traceback.format_exc().strip().splitlines()[-4:]
        detail += "\n      " + "\n      ".join(tb)
        shot = h.screenshot(name)
        if shot:
            detail += f"\n      screenshot: {shot}"
    finally:
        h.close()
    dur = time.time() - started
    first, *rest = (detail or "").splitlines() or [""]
    print(f"{status:<5} {name:<30} {dur:6.1f}s  {first}")
    for line in rest:
        print(line)
    return {"name": name, "status": status, "seconds": round(dur, 1), "detail": detail}


def main(argv: list[str] | None = None) -> int:
    global ARTIFACTS
    ap = argparse.ArgumentParser(description="DualLens E2E runner")
    ap.add_argument("--smoke", action="store_true", help="only the extension launch check")
    ap.add_argument("--only", action="append", default=[], help="substring filter on case names (repeatable)")
    ap.add_argument("--list", action="store_true", help="list cases and exit")
    ap.add_argument("--extension-dir", type=Path, default=EXT_SRC, help="read-only extension source directory to copy")
    ap.add_argument("--mock-only", action="store_true", help="exclude real-provider integration; no account or model service needed")
    ap.add_argument("--artifacts-dir", type=Path, help="isolated result directory, preferably outside the checkout")
    args = ap.parse_args(argv)
    if args.artifacts_dir:
        ARTIFACTS = args.artifacts_dir.expanduser().resolve()

    if args.list:
        for name, _, desc in CASES:
            print(f"{name:<30} {desc}")
        return 0

    selected = CASES
    if args.smoke:
        selected = [c for c in CASES if c[0] == "smoke_launch"]
    elif args.only:
        selected = [c for c in CASES if any(o in c[0] for o in args.only)]
    if not selected:
        print("no matching cases")
        return 2

    E2E_ROOT.mkdir(parents=True, exist_ok=True)
    run_dir = E2E_ROOT / f"run-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    run_dir.mkdir(parents=True)
    try:
        ext_dir, missing = stage_extension(run_dir, args.extension_dir)
        if missing:
            raise ValueError("missing or empty manifest references: " + ", ".join(missing))
    except Exception as e:
        detail = str(e)
        print("INCOMPLETE extension: " + detail)
        save_results([{"name": "extension-completeness", "status": "FAIL", "seconds": 0, "detail": detail}])
        remove_runtime_dir(run_dir)
        return 1

    httpd, base = start_fixtures()
    print(f"fixtures on {base}; extension staged at {ext_dir}")
    results: list[dict] = []
    try:
        with sync_playwright() as p:
            for name, fn, _desc in selected:
                results.append(run_case(p, name, fn, ext_dir, base))
    finally:
        httpd.shutdown()
        remove_runtime_dir(run_dir)

    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("PASS", "FAIL", "SKIP", "INFO")}
    print()
    print(f"SUMMARY total={len(results)} PASS={counts['PASS']} FAIL={counts['FAIL']} "
          f"SKIP={counts['SKIP']} INFO={counts['INFO']}")
    if counts["FAIL"]:
        print("FAILED: " + ", ".join(r["name"] for r in results if r["status"] == "FAIL"))
    try:
        save_results(results)
    except OSError:
        pass
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
