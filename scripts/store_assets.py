"""Generate Edge store artwork from the real unpacked DualLens extension.

The browser scenes use the same isolated Playwright harness as the public E2E
suite and the deterministic mock provider. No credentials or network requests
are needed. The promo tile is the only deliberately designed scene.
"""
from __future__ import annotations

import argparse
import base64
import sys
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "store"
FIXTURE = "store-article.html"


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


def _promo(page, path: Path) -> None:
    icon = base64.b64encode((ROOT / "extension" / "icons" / "128.png").read_bytes()).decode("ascii")
    page.set_content(f"""<!doctype html><meta charset='utf-8'><style>
      *{{box-sizing:border-box}} body{{margin:0;background:#101a2d;color:#edf4ff;font:16px system-ui,sans-serif}}
      main{{height:280px;padding:28px 30px;background:linear-gradient(135deg,#172c4b,#0d1729)}}
      header{{display:flex;align-items:center;gap:14px}} img{{width:44px;height:44px;border-radius:11px}}
      h1{{font-size:27px;margin:0}} p{{color:#b9c9df;margin:17px 0 20px;line-height:1.45}}
      .tag{{display:inline-block;padding:8px 12px;border:1px solid #466da5;border-radius:999px;color:#9fc9ff}}
      </style><main><header><img src='data:image/png;base64,{icon}' alt='DualLens icon'><h1>DualLens</h1></header>
      <p>Read any webpage with original text and a clear second-line translation.<br>Bring your own model service and keep control of your settings.</p>
      <span class='tag'>Bilingual reading · Translation-only mode</span></main>""")
    _screenshot(page, path, 440, 280)


def generate(output_dir: Path = OUT) -> list[Path]:
    """Create all store images and return their paths in display order."""
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    harness = _load_harness()
    fixture_server = None
    session = None
    run_dir = None
    paths: list[Path] = []
    try:
        with sync_playwright() as playwright:
            fixture_server, base = harness.start_fixtures()
            run_dir = harness.E2E_ROOT / f"run-store-assets-{uuid.uuid4().hex[:8]}"
            run_dir.mkdir(parents=True, exist_ok=True)
            ext_dir, missing = harness.stage_extension(run_dir)
            harness.check(not missing, f"extension has missing references: {missing}")
            session = harness.Session(playwright, ext_dir, base, "store-assets")
            session.start()  # writes provider.active=mock through the SW

            session.open(FIXTURE)
            session.command("toggle-page")
            _wait_translated(harness, session)
            path = output_dir / "01-bilingual.png"
            _screenshot(session.page, path)
            paths.append(path)

            session.command("toggle-translation-only")
            session.wait_js("() => document.querySelector('.dl-only') && document.querySelector('.dl-solo')",
                            10, what="translation-only mode")
            path = output_dir / "02-translation-only.png"
            _screenshot(session.page, path)
            paths.append(path)

            session.command("toggle-page")
            session.page.locator("#lead").click(click_count=3)
            session.wait_state(lambda state: (state.get("ui") or {}).get("selectionIcon") is True,
                               10, "selection icon")
            pick = session.js("""() => {
                const r = getSelection().getRangeAt(0).getClientRects();
                const last = r[r.length - 1];
                return {x: Math.min(innerWidth - 36, Math.max(4, last.right + 4)) + 14,
                        y: Math.min(innerHeight - 36, Math.max(4, last.bottom + 6)) + 14};
            }""")
            session.page.mouse.click(pick["x"], pick["y"])
            session.wait_state(lambda state: ((state.get("ui") or {}).get("selectionCard") or {})
                               .get("text", "").startswith(harness.MOCK_PREFIX),
                               10, "selection card translation")
            path = output_dir / "03-selection-card.png"
            _screenshot(session.page, path)
            paths.append(path)

            options = session.ctx.new_page()
            options.goto(f"chrome-extension://{session.ext_id}/ui/options.html", wait_until="load")
            options.locator("#status").wait_for(timeout=10000)
            options.select_option("#providerPreset", "openrouter")
            options.locator("#add-profile").click()
            options.locator("#profile").wait_for(timeout=10000)
            options.wait_for_timeout(400)
            options.locator("#apiKey").fill("")
            path = output_dir / "04-settings.png"
            _screenshot(options, path)
            paths.append(path)
            options.close()

            session.open(FIXTURE)
            session.command("toggle-page")
            _wait_translated(harness, session)
            path = output_dir / "05-mobile.png"
            _screenshot(session.page, path, 375, 812)
            paths.append(path)

            promo_page = session.ctx.new_page()
            _promo(promo_page, output_dir / "00-promo.png")
            paths.insert(0, output_dir / "00-promo.png")
            promo_page.close()
    finally:
        if session is not None:
            session.close()
        if run_dir is not None and run_dir.exists():
            harness.remove_runtime_dir(run_dir)
        if fixture_server is not None:
            fixture_server.shutdown()
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=OUT)
    args = parser.parse_args(argv)
    paths = generate(args.output_dir)
    print(f"Generated {len(paths)} real-interface store assets in {args.output_dir.resolve()}")
    for path in paths:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
