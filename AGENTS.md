# DualLens contributor instructions

## Scope and source

DualLens is an independent Chrome/Edge MV3 web translation extension. This repository contains original source, icons, tests and public documentation. Never copy third-party extension code, proprietary rules, prompts, models or brand assets into the project. Reference packages and private analysis are not release inputs.

The extension includes webpage and PDF translation, subtitles, local image OCR and frame translation. The Android userscript is distributed separately. Describe support only to the extent verified; EPUB and Firefox/Safari are not implemented.

## Layout

- extension/: zero-build native JavaScript modules, CSS, UI and original icons.
- scripts/: project validation and deterministic release packaging.
- tests/: offline Node/Python tests, local fixtures and isolated Playwright E2E.
- docs/SPEC.md: interface contract; change it when changing interfaces.

## Collaboration

GitHub main is the collaboration baseline. Use feature branches and PRs. Give each parallel writer an explicit file boundary; do not revert another contributor's work. Review the final diff and relevant checks. Follow CONTRIBUTING.md.

Keep credentials, external publishing and final security acceptance with the task owner. Do not use paid or remote models merely to run tests; mock-only E2E requires no account or local model server.

## Privacy and runtime

Never commit keys, OAuth state, cookies, private reports, browser profiles, databases, models, logs or local service configuration. Use a virtual environment and browser cache outside a synchronized checkout.

Model output must not reach innerHTML or executable markup. Preserve original webpage state on restore. API keys stay in device-local storage; plaintext configuration exports omit secrets.

## Validation

Run npm test, scripts/check_project.py and scripts/build_release.py. Use the canonical mock-only E2E runner for browser changes. Real-provider integration tests need explicit authorization and must be reported separately from offline checks.
