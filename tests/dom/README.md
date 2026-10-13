# DOM and settings validation

- npm test includes offline settings/secret-export tests in this directory.
- tests/dom/run_browser.py is a compatibility entry point to the canonical runner. With no arguments it selects seven mock lifecycle regressions; arguments are forwarded to tests/e2e/run_e2e.py.
- It no longer combines historical worktrees. Use tests/e2e/run_e2e.py --mock-only for the complete public browser suite.

See [browser setup](../e2e/README.md). Tests use synthetic loopback fixtures and temporary profiles, not your real browser or account.

`run_settings_browser.py` adds five settings-v2 checks using the canonical E2E staging/session:
fresh-install wizard with no automatic network, mocked OpenRouter discovery and connection test,
encrypted backup/import plus key-free plaintext, popup service switching, and the shared form with
injected storage/http on a loopback page where extension APIs are forbidden. It verifies local-only
secrets, 44px controls and no horizontal overflow at 375x812, and writes light/dark screenshots to
`%USERPROFILE%\.cache\duallens-e2e\providers-settings\`.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/dom/run_settings_browser.py
```

Provider HTTP requests are intercepted with a small original fixture; no real service or account is used.
