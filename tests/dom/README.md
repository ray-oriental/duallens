# DOM and settings validation

- npm test includes six offline settings/secret-export tests in this directory.
- tests/dom/run_browser.py is a compatibility entry point to the canonical runner. With no arguments it selects seven mock lifecycle regressions; arguments are forwarded to tests/e2e/run_e2e.py.
- It no longer combines historical worktrees. Use tests/e2e/run_e2e.py --mock-only for the complete public browser suite.

See [browser setup](../e2e/README.md). Tests use synthetic loopback fixtures and temporary profiles, not your real browser or account.
