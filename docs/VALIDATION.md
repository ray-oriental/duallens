# Validation

## v0.1.0 release preparation

On Windows, the public provider opt-in regressions and offline logic passed 131 Node tests and 18 gateway tests. The isolated public mock-only Chromium run had 24 PASS, 0 FAIL, 0 SKIP and 1 INFO across 25 cases. No account, local model server or remote model request was used.

The INFO probe records that synthetic Alt+A does not trigger browser extension commands; functional command behavior is tested through service-worker messages. These results cover synthetic fixtures, not broad real-site compatibility or model quality.

## Public CI

The CI workflow runs Node, Python, release safety and packaging checks on Windows and Ubuntu and runs the isolated mock-only browser suite on Ubuntu. It uses no campus credentials, subscription, paid API or local model server. Current CI results are authoritative for each public commit.

Browser artifacts stay outside the checkout and contain test status plus optional failure diagnostics. Do not publish private-page screenshots. See [E2E instructions](../tests/e2e/README.md).

## Release checks

- Manifest version matches the tag and archive names.
- Referenced extension files are present, nonempty and inside the extension.
- Unit tests, release safety/reproducibility tests and project validation pass.
- Generated ZIPs contain only allowlisted files and license, with SHA256SUMS.
- The public Git history starts from a reviewed, sanitized source snapshot.
- A release is published only after CI is green and packaged extension behavior is verified.

Publishing a GitHub release does not install into a browser or publish to an extension store. Real-provider integration is optional, requires explicit authorization and is reported separately from mock validation.
