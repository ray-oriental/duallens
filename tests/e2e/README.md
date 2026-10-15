# Browser E2E

The canonical Playwright runner serves synthetic HTML fixtures on loopback and loads an isolated read-only copy of the unpacked extension. It does not modify your real browser profile.

## Environment

CI uses Node.js 24, Python 3.12 and Playwright 1.48.0 with its matching bundled Chromium. Keep the virtual environment and browser cache outside a synchronized repository.

PowerShell example:

```powershell
python -m venv "$env:USERPROFILE\.venvs\duallens-e2e"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -m pip install -r requirements-dev.txt
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -m playwright install chromium
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B tests/e2e/run_e2e.py --mock-only
```

On Linux, use your Python 3.12 virtual environment, install requirements-dev.txt, then python -m playwright install --with-deps chromium. The normal Playwright cache is used; PLAYWRIGHT_BROWSERS_PATH may point to another matching installation.

## Commands

Run all three entry points from the repository root with the same Playwright Python/browser installation:

```powershell
$testPython = "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe"
# Optional: reuse an existing, matching Playwright 1.48 Chromium cache read-only.
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& $testPython -B -u tests/e2e/run_e2e.py --mock-only
node scripts/build_userscript.mjs
& $testPython -B -u tests/e2e/run_userscript_e2e.py
& $testPython -B -u tests/dom/run_settings_browser.py
```

`PLAYWRIGHT_BROWSERS_PATH` points to the parent of `chromium-1140`, not to the executable or the numbered directory itself. Omit it when using the normal Playwright cache. None of these commands starts a model server or uses credentials. Building a release with `python -B scripts/build_release.py` also creates `dist/duallens.user.js`.

```sh
python -B tests/e2e/run_e2e.py --list
python -B tests/e2e/run_e2e.py --smoke
python -B tests/e2e/run_e2e.py --mock-only
python -B tests/e2e/run_e2e.py --only lazy --only dynamic
# Explicit optional integration: makes a real local Ollama translation request
python -B tests/e2e/run_e2e.py --only gateway_article --require-gateway
# Verify an unpacked release asset instead of the source extension
python -B tests/e2e/run_e2e.py --extension-dir /path/to/unpacked-extension --mock-only
```

Without --mock-only, the optional gateway_article case can use a real local model if the gateway is available. CI always passes --mock-only. --require-gateway makes an unavailable integration fail instead of skip; it cannot be combined with --mock-only.

## Evidence and safety

Every test gets a temporary profile under ~/.cache/duallens-e2e. The source extension is copied to a generated run-* directory and checked before Chromium launches. Missing/empty references, unsafe paths or unreadable manifest fail with exit 1; no placeholder files are generated.

Generated run-* and profile-* directories are removed after strict parent/name checks. artifacts/last-run.json and failure screenshots remain outside the repository. A custom --artifacts-dir may be used for isolated CI evidence.

PASS/FAIL/SKIP/INFO are distinct. Only gateway_article can optionally SKIP; --mock-only excludes it entirely. The synthetic Alt+A probe is INFO because synthetic key events do not trigger browser extension commands. Actual translation command behavior is tested through the service worker. Nonempty failures exit 1; an empty filter exits 2.

## Coverage

Paragraph translation, link/code retention, exclusions and hidden/password elements, exact DOM restore, translation-only visibility, viewport lazy loading, dynamic append/SPA, style changes, input shortcut and editing race, selection and hover, mixed/flex structure, settings privacy/manual subscription selection, never/always wake/sleep, safe clones, original data attributes/classes and toast cleanup. Successes use structured results; only failures capture screenshots.

The browser uses headless=False plus --headless=new to load extensions. Headless shell does not provide the same extension behavior.

## Userscript runner

`run_userscript_e2e.py` runs the unchanged generated userscript without an extension. A test-only GM transport/storage/menu stub and closed-shadow instrumentation exercise desktop translation, DOM-identical restore, translation-only, selection, shared settings and dynamic/SPA changes. Secret-transport and OpenRouter-preset cases accept native prompts through Playwright dialog handlers, check set/cancel/clear/reopen and encrypted backups, and assert there are no secret input fields or key values in page storage/DOM/window properties. An additional case loads the unchanged bundle into a real Chromium isolated world after the host page overrides its prompt and installs document input listeners; neither hook may receive the key.

Touch cases run at 375×812 and 800×1280 with a coarse pointer. They verify a cancellable 500ms hold, selection controls below the selection, floating-ball drag, focused-input translation, full-screen narrow settings and full long-page scroll/translation metrics. Reported long-task measurements are synthetic measurements, not guarantees for every website/device. The runner never makes a real model call and exits 1 on failure, 2 on an empty filter.

```sh
node scripts/build_userscript.mjs
python -B -u tests/e2e/run_userscript_e2e.py
python -B -u tests/e2e/run_userscript_e2e.py --only openrouter_profile
python -B -u tests/e2e/run_userscript_e2e.py --only mobile_375 --only tablet_800
```

Profiles are removed after the same bounded cleanup checks as the extension suite. Results and failure screenshots remain under `~/.cache/duallens-e2e/artifacts/userscript/`. GM instrumentation exists only in the runner, never in the release bundle. See [real-device acceptance](MOBILE_ACCEPTANCE.md) for Android Edge/Tampermonkey.

## Authorized v0.3.1 real-page runner

`run_v031_live.py --only novel` is separate from offline checks and requires explicit authorization for the existing local gateway and model calls. It uses a fresh profile, direct Chromium connections (`--no-proxy-server`), and bounded navigation/read retries. It never logs in. Reads may retry after document replacement; translation commands/clicks are never replayed blindly.

The novel probe measures Chinese translation in the current viewport, requires first translation within 3 seconds and viewport fill within 30 seconds, and checks translation-only, scroll discovery, floating-ball restore and original reader DOM. An untranslated line cannot borrow a later line's translation. Screenshots, safe numeric transport metrics and results stay under `~/.cache/duallens-e2e/v031/`.

The explicitly renewed streaming round uses `sjtu-budget-novel-stream.json`, distinct from the earlier round's ledger. Cumulative SJTU attempts are capped at 30; a run defaults to at most six (`--sjtu-limit` can lower or allocate the remaining authorized budget). The allowance is reserved before launch, so a crash cannot silently reset it. Do not delete/reset this ledger to obtain more calls. New rounds require new authorization. The old unsupported-stream local rejection exception applies only to that exact verified local error; normal failures/aborted requests count conservatively. `--max-items 1..20` changes only the temporary test profile and defaults to 20, matching the normal profile capacity; Japanese-to-Chinese first output starts with two items, with the remainder retaining profile capacity. Only the explicitly allowed SJTU, free Solar and local Qwen models may be used.

`python -B -m unittest discover -s tests/e2e -p test_live_runner.py` in the Playwright venv runs the read retry boundary tests without a browser or model. `run_layout_e2e.py` additionally exercises actual document navigation and a tall shared novel host using controlled offline fixtures.

## Authorized v0.4 engine measurements

`run_v04_engine_live.py` measures the requested public Wikipedia/Pixiv pages without login. Default `--llm none` uses only real free unofficial MT. `--llm ollama` explicitly uses the existing local `ollama/qwen3:4b` gateway profile with no other models; its default refinement budget is 20 seconds, or pass `--refine-timeout-ms 90000` for the normal setting. Clear `HTTP_PROXY` / `HTTPS_PROXY` for these direct-connection runs. Runtime profiles and screenshots stay under `~/.cache/duallens-e2e/`; no real-provider test belongs in mock CI.

The runner freezes the original visible source cohort before insertion. `stage:'final'` alone is not proof of LLM success: engine metadata separately counts actual `llm` results, and timeout-retained MT is reported as unavailable/partial refinement. Functional coverage/restore and the 1000ms speed target are separate fields. The `phone` variant uses Android UA, mobile layout and coarse touch emulation; it remains desktop Chromium, not actual Android/Tampermonkey. Reports include filters/budget in their names to preserve separate runs. A failed real-page probe remains FAIL; it is not silently skipped. See [current validation limits](../../docs/VALIDATION.md).

```powershell
& $testPython -B -u tests/e2e/run_v04_engine_live.py --llm none
& $testPython -B -u tests/e2e/run_v04_engine_live.py --llm ollama --only novel --viewport desktop --refine-timeout-ms 90000
```

## Settings browser runner

`tests/dom/run_settings_browser.py` stages an isolated extension using the canonical session helper and runs five checks: no-network fresh wizard, mocked OpenRouter discovery/test/save, encrypted/public backup, popup switching, and an injected shared form with Chrome APIs forbidden. It uses a 375×812 viewport and writes light/dark screenshots to `~/.cache/duallens-e2e/providers-settings/`. Run it directly; it accepts no case filters. This is separate from both the full extension suite and the userscript suite.
