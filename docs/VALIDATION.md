# Validation

## v0.4 engine worktree (2026-10-15, not a release)

Offline checks passed 334 Node tests and 40 gateway tests. Release tests passed 22 cases with one Windows symlink skip. The final canonical mock extension run reports `total=33 PASS=32 FAIL=0 SKIP=0 INFO=1`, including MT draft→final updates in the same element, exact restore, cancellation after a draft, quiet LLM failure, and quick selection/hover. The INFO remains the synthetic Alt+A limitation.

The userscript GM-stub suite passed all eight desktop/phone/tablet cases, including keyless MT and refinement. The two revised machine-first cases also explicitly clicked the selection refinement button and verified MT-first input translation. Settings browser checks passed `total=6 PASS=6 FAIL=0` (mock providers, local-only MT keys, encrypted backup and 375px layout). These do not validate actual Android Tampermonkey isolation or a second physical Windows machine. The generated userscript is 381711 bytes, below 400000; extension source remains zero-build with no new runtime dependency.

Authorized direct public-page measurements used isolated profiles, cache disabled and lazy margin 0 to measure the original viewport cohort. They are separate from mock checks and do not prove latency at the saved default 600px margin. Initial viewport-only tests (1280×800 / 375×812, desktop UA) measured first translation / filled viewport: Wikipedia 797/969 ms and 328/328 ms; Pixiv novel 438/532 ms and 281/422 ms. A cold standalone Microsoft probe took 3857 ms, and a subsequent dual-engine Pixiv desktop sample took 750/1875 ms: the universal ≤1 second target is **not met**.

Local `ollama/qwen3:4b` was the only real refinement model tested; no campus, subscription or paid model was used. With a 20-second budget, Wikipedia and the viewport-only Pixiv phone sample retained MT; Pixiv desktop refined 3/7 source lines (first LLM result 3391 ms). A normal 90-second-budget Pixiv desktop sample settled in 3672 ms, first LLM result 1313 ms, with 5/7 LLM results and 2/7 retained MT. Full LLM refinement was not achieved. Page-wide layout-shift measurements include website activity and later MT insertions, so they cannot establish zero refinement shift.

A corrected Android-UA/coarse-pointer 375×812 probe translated Wikipedia in 750 ms. Pixiv mobile exposed a pre-existing reader-root gap: `span.text-count` exists under mobile wrappers but `shared/site-adapters.js` only recognizes `p:has(> span.text-count)`; the controller finds zero units. The bounded mobile real-page command therefore **fails** and needs a site-adapter/walker owner fix. Desktop viewport-only screenshots must not be presented as Android acceptance.

Public-page timing JSON and screenshots live only in `~/.cache/duallens-e2e/v04/dev-engine/`; settings artifacts are in `~/.cache/duallens-e2e/providers-settings/`. No profiles, credentials, originals or screenshots are release inputs. Contract coordination still requires `content/main.js` to invalidate existing page translations on changes to `translation`, and PDF consumers to opt into `draft:true` and accept repeated ids.

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

## v0.4 real-site acceptance tooling (QA)

`tests/e2e/run_acceptance.py` records a reproducible public-site × desktop/light/dark/phone/tablet matrix with first translation, fixed-viewport fill, actual LLM-final time, independent visible-text coverage, missing selectors/snippets, geometry findings with screenshots, visible translation errors, and strict body restore. Use `--repo` to test a colleague's checkout through an isolated staged extension and freshly built userscript. No production code or model key is changed. Detailed algorithm, caveats and commands are in [the acceptance runner instructions](../tests/e2e/README.md#v04-public-site-acceptance-matrix).

Default MT runs use free unofficial Microsoft/Google services and require explicit real-provider authorization. Optional gateway runs use 18799 and an in-memory Ollama-only `auto` policy, with zero SJTU/Claude/Codex calls and no writes to user configuration. This deliberately narrower policy does not establish remote auto-routing correctness. The runner is separate from mock CI. Raw matrices/screenshots stay in `~/.cache/duallens-e2e/v04/acceptance/`; published/release files must not absorb runtime profiles or logs.

Thresholds are first visible translation ≤3 seconds and ≥95% coverage, with no newly detected layout issue/visible error and exact restore. A timeout-retained MT result is not an LLM final. Coverage is structural presence, not a semantic quality score. PDF rows use reader text blocks and are tagged separately; mobile PDF is unsupported by the platform contract. Dark-media emulation cannot force a site-selected light theme. A site access wall remains UNREACHABLE; it is never bypassed or passed.

Desktop Chromium plus an equivalent GM stub is the automation boundary. Physical Android Edge/Tampermonkey, Android Chrome bookmarklets, two actual Windows devices and real Chrome/Edge installations still require separate manual acceptance. Dynamic site changes can fail strict restore; first-difference and no-translation-control evidence must be reviewed before attributing them to the extension.

The 2026-10-16 QA baseline on source revision `e85e8cb` completed 100 cases: 8 PASS, 61 FAIL, 23 UNREACHABLE, 8 UNSUPPORTED, 0 harness ERROR. All 60 observed first translations were within 3 seconds; absence of a first translation is still a failure, not a timing pass. The run does not meet the broad acceptance target. Raw results, per-case findings and screenshots are in the machine-local `~/.cache/duallens-e2e/v04/acceptance/v04-qa-final-run/`; none are release inputs.

Important interpretation limits: the structural coverage heuristic can undercount aggregated BR-separated/ancestor-host translations and is not a semantic quality score. Whole-body restore includes website-owned reactive changes and PDF reader toolbar/status changes. A separate no-translation screenshot control left Wikipedia unchanged twice, while GitHub updated its pane-width attributes on its first control pass. PDF contrast flags over painted canvas/whiteout backgrounds need visual review. Initial-viewport results do not certify expanded menus, lower-page comments/footers, closed shadow roots, iframes or physical devices. The two Wikipedia repeats did not establish numerical identity apart from timing.

The separate 10-page local-only gateway trial completed with 3 functional PASS and 7 FAIL, no visible retry/pending controls at the final checks, and zero SJTU calls. It recorded only partial refinement (eight visible source nodes on one issue page), with no complete LLM viewport-final time. This earlier trial uses coverage version 1; the final MT baseline uses version 2, so their coverage percentages must not be directly compared. The temporary 18799 listener was confirmed closed. Remote auto routing and fully successful LLM refinement remain unverified.
