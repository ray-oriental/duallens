# Performance validation

Use canonical mock browser runners for repeatable fixture timing and the single authorized [real-page acceptance runner](../e2e/README.md#authorized-real-page-acceptance) for network measurements. Report first visible translation, final refinement, coverage, main-thread tasks, errors and exact restore separately.

Keep profiles, screenshots and numeric reports under DUALLENS_E2E_OUT outside the checkout. Mock timings do not establish public-network latency or physical Android performance. Real-provider runs require explicit authorization; tests do not start model services.
