# Browser validation

Offline runners use isolated Chromium profiles and mock translation. No account, paid model, installed browser profile or model server is required.

## Environment

Create a virtual environment outside the checkout, install requirements-dev.txt and Playwright Chromium, then use that interpreter for every browser command. Windows PowerShell example:

```powershell
python -m venv "$env:TEMP/duallens-test-venv"
$testPython = "$env:TEMP/duallens-test-venv/Scripts/python.exe"
& $testPython -m pip install -r requirements-dev.txt
& $testPython -m playwright install chromium
$env:DUALLENS_E2E_OUT = "$env:TEMP/duallens-e2e"
& $testPython -B tests/e2e/run_e2e.py --mock-only
```

Linux/macOS: use an external temporary/cache directory and its bin/python. Playwright uses its standard browser cache; to reuse another cache, set PLAYWRIGHT_BROWSERS_PATH to that cache parent before installation and execution. No machine-specific browser location is embedded in the runners.

DUALLENS_E2E_OUT controls runtime profiles, screenshots and reports, defaulting to `<system temporary directory>/duallens-e2e`. Generated run-* and profile-* directories are cleaned after use. Retained artifacts are not release inputs. --artifacts-dir overrides the canonical result directory. Do not publish private screenshots or logs.

## Offline commands

Build first with `python -B scripts/build_release.py`, including the userscript and pinned settings resource. Then run:

```sh
python -B tests/e2e/run_e2e.py --mock-only
python -B tests/e2e/run_userscript_e2e.py
python -B tests/e2e/run_layout_e2e.py --mock-only
python -B tests/e2e/run_frames_e2e.py
python -B tests/e2e/run_input_e2e.py
python -B tests/e2e/run_media_e2e.py
python -B tests/e2e/run_pdf_e2e.py
python -B tests/dom/run_settings_browser.py
```

The canonical runner accepts --smoke, repeatable --only, --list, and read-only --extension-dir. A synthetic keyboard probe may produce INFO; functional command paths use worker messaging. Interaction cases explicitly enable their features. Fresh settings have separate quiet-default checks. Comic OCR additionally requires pinned language data and generated fixtures; see [COMICS.md](../../docs/COMICS.md).

## Authorized real-page acceptance

The sole real-page entry point is run_acceptance.py. It stages source, builds the userscript, measures first/final translation, viewport coverage, geometry, visible errors and structural restore, and retains evidence. It never logs in or bypasses challenges. Default --llm none uses real free unofficial MT and requires explicit authorization.

```sh
python -B tests/e2e/run_acceptance.py --llm none --only wiki --device desktop
python -B tests/e2e/run_acceptance.py --llm https://example.com/v1 --only wiki --device desktop
```

For the second command set DUALLENS_MODEL and, if needed, DUALLENS_API_KEY in the process environment. Never put key values in commands/source/reports. The endpoint must use HTTPS or explicit local HTTP, without credentials/query/fragment. Simulated GM transport allows only free MT hosts and that endpoint, rejects model endpoint redirects, and never starts a service or reads personal configuration.

Use --repo to stage another checkout; --device desktop|phone|tablet|all, repeatable --only, --timeout, --headed, --out or hash-checked --resume. Missing measurements remain distinct from zero. Coverage is structural, not semantic. Restore controls may explain only matching site attribute changes, never text/order changes or extension residue. PDF rows use separate reader text-block metrics. Access walls are UNREACHABLE; native mobile PDF is UNSUPPORTED.

Chromium/GM stubs and device emulation do not certify actual Tampermonkey isolation or physical devices. Complete [MOBILE_ACCEPTANCE.md](MOBILE_ACCEPTANCE.md) and actual desktop Chrome/Edge acceptance separately. Report real-provider results separately from mock summaries.

The real-page acceptance runner defaults to `--ack`: it seeds only the configured translation destinations in device-local consent state before translation. Use `--no-ack` to verify the first-send card and zero translation-service requests instead. Repeat `--device` to add devices, or use `--device all` (the default) for desktop, phone and tablet.

Mobile acceptance captures only the current viewport: Chromium 130 beyond-viewport capture can reset mobile emulation and reflow fixed overlays. The mobile runner uses a fresh context; desktop still uses an isolated extension profile and the popup tab-ensure path. Staged test host grants do not validate native activeTab gestures.

For checkout comparisons, run the same acceptance runner with each `--repo` and a separate `--out`. Optional interaction features are explicitly disabled in both checkouts; resident v0.6 content scripts are detected before attempting on-demand injection. Keep the probe, device, provider and observation deadline unchanged. Compare the retained measurements without rescoring:

```sh
python -B tests/e2e/compare_coverage.py baseline/matrix.json current/matrix.json --out comparison
```

The comparison rejects different probe/deadline/provider metadata and case sets, preserves unobserved values, and lists exact added, removed and shared missing records. Public-page content and free-provider failures can still differ between sequential runs; inspect those records and transport outcomes alongside percentages.

`run_contrast_e2e.py` is an offline mock regression for low-contrast webpage metadata under light and dark OS preferences. It verifies actual inserted colours at 4.5:1 or better and exact original-DOM restore.
