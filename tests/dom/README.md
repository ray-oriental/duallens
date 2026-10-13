# DOM and settings validation

- npm test includes offline settings/secret-export tests in this directory.
- tests/dom/run_browser.py is a compatibility entry point to the canonical runner. With no arguments it selects seven mock lifecycle regressions; arguments are forwarded to tests/e2e/run_e2e.py.
- It no longer combines historical worktrees. Use tests/e2e/run_e2e.py --mock-only for the complete public browser suite.

The three canonical browser entry points are independent:

- `tests/e2e/run_e2e.py --mock-only`: complete isolated MV3 extension interactions, including hover and v2 sync updates; `--only` filters cases.
- `tests/e2e/run_userscript_e2e.py`: generated userscript with GM stubs, shared settings, OpenRouter preset/key privacy, desktop and two touch sizes; `--only` filters cases. Build `dist/duallens.user.js` first with `node scripts/build_userscript.mjs` or the release builder.
- `tests/dom/run_settings_browser.py`: five settings-v2 wizard/backup/popup/injected-form checks, no filtering arguments.

See [browser setup](../e2e/README.md). Tests use synthetic loopback fixtures and temporary profiles, not your real browser or account.

`run_settings_browser.py` adds five settings-v2 checks using the canonical E2E staging/session:
fresh-install wizard with no automatic network, mocked OpenRouter discovery and connection test,
encrypted backup/import plus key-free plaintext, popup service switching, and the shared form with
injected storage/http on a loopback page where extension APIs are forbidden. It verifies local-only
secrets, 44px controls and no horizontal overflow at 375x812, and writes light/dark screenshots to
`%USERPROFILE%\.cache\duallens-e2e\providers-settings\`.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
$testPython = "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe"
& $testPython -B -u tests/e2e/run_e2e.py --mock-only
node scripts/build_userscript.mjs
& $testPython -B -u tests/e2e/run_userscript_e2e.py
& $testPython -B -u tests/dom/run_settings_browser.py
```

Provider HTTP requests are intercepted with a small original fixture; no real service or account is used.

The environment is outside the checkout (`%USERPROFILE%\.venvs\duallens-e2e`, Playwright 1.48). The optional browser-cache environment variable points at the parent of `chromium-1140`; omit it to use Playwright's default cache. All profiles and browser evidence stay in `%USERPROFILE%\.cache\duallens-e2e\`; they are not release inputs. A passing synthetic run does not replace acceptance on the two physical Windows computers or Android Edge/Tampermonkey devices.
