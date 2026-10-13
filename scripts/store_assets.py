"""Generate deterministic, local-only Edge store artwork with mock UI fixtures."""
from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "store"

CSS = """
body{margin:0;background:#0e1726;color:#e7eefb;font:20px Arial,sans-serif}main{width:1120px;margin:55px auto;padding:36px;background:#17243a;border:1px solid #304566;border-radius:22px;box-shadow:0 18px 60px #0006}h1{font-size:42px;margin:0 0 24px;color:#8ec5ff}h2{font-size:28px;color:#b9d9ff}.bar{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #395273;padding-bottom:20px}.pill{padding:10px 16px;border-radius:99px;background:#173f61;color:#92d3ff}.row{display:flex;gap:24px;align-items:flex-start;margin:22px 0;padding:20px;background:#101b2d;border-radius:14px}.original{color:#b7c5d9;flex:1}.translated{color:#fff;flex:1;border-left:3px solid #5eb7ff;padding-left:20px}.card{background:#eaf4ff;color:#11243b;border-radius:16px;padding:24px;width:520px;box-shadow:0 12px 35px #0007}.field{background:#0d1829;border:1px solid #49617f;border-radius:10px;padding:16px;margin:12px 0;color:#c9d8ec}.button{display:inline-block;background:#2684ff;padding:13px 20px;border-radius:10px;color:white;margin-top:10px}.only .original{display:none}.only .translated{border:0;padding:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.muted{color:#9bb0ca;font-size:17px}
"""

SCENES = {
    "01-bilingual": ("翻译前后对照 / Bilingual comparison", "<div class='row'><div class='original'>The browser extension keeps the original layout while translating visible paragraphs.</div><div class='translated'>浏览器扩展保留原始布局，同时翻译可见段落。</div></div><div class='row'><div class='original'>Choose your own model service in Settings.</div><div class='translated'>在设置中选择你自己的模型服务。</div></div>"),
    "02-translation-only": ("仅译文 / Translation only", "<div class='only'><div class='row'><div class='original'>Original webpage text</div><div class='translated'>只显示译文，阅读更专注。</div></div></div><p class='muted'>One click restores the original page.</p>"),
    "03-selection-card": ("划词卡片 / Selection card", "<div class='card'><h2>Selection translation</h2><p>网页阅读中选中一段文字，即时查看译文。</p><p><b>Privacy first</b><br>Text is sent only to your selected service.</p><span class='button'>Translate selection</span></div>"),
    "04-settings": ("设置页 / Settings", "<div class='grid'><section><h2>Model service</h2><div class='field'>Provider: Mock (offline)</div><div class='field'>Base URL: your OpenAI-compatible endpoint</div><div class='field'>API key: stored locally in this browser</div></section><section><h2>Translation</h2><div class='field'>Target language: 中文</div><div class='field'>Mode: Bilingual</div><div class='field'>Telemetry: Off</div><span class='button'>Save settings</span></section></div>"),
}


def render(page, title: str, body: str, path: Path, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.set_content(f"<style>{CSS}</style><main><div class='bar'><h1>DualLens</h1><span class='pill'>Mock backend · local fixture</span></div><h2>{title}</h2>{body}</main>")
    page.screenshot(path=str(path), full_page=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=OUT)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        for name, (title, body) in SCENES.items():
            render(page, title, body, out / f"{name}.png", 1280, 800)
        render(page, "DualLens · privacy-first web translation", "<p>Side-by-side reading for any webpage.</p><p class='muted'>Bring your own model service · no telemetry · local controls</p><span class='button'>Translate webpage</span>", out / "00-promo.png", 440, 280)
        browser.close()
    print(f"Generated {len(SCENES) + 1} store assets in {out}")
    for path in sorted(out.glob("*.png")):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
