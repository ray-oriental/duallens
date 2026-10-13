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
