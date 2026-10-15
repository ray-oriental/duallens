# Validation

## v0.4 second layout pass (2026-10-16, working tree)

Based on leader commit `47c2060`; this pass is uncommitted. Headlines, article links and long
source text remain bilingual. Short controls try inline output before measured failure can permit
replacement. Clipping styles have shared ownership and exact restoration, including preservation
of site-authored style changes. Legacy horizontal WebKit boxes switch to ordinary block flow for
prose; native control clipping remains intact so hidden issue edit-history text cannot cover authors.
Sibling headings share policy, prose links in note containers remain one sentence, and HN metadata
translates points/by/hide/comments/ago/discuss fragments without copying authors or scores.

Public identifiers are filtered locally, including GitHub paths, authors, branches, topics, milestones,
licenses and language names, question tags, subreddit names and API calls such as `map()`.
A 70-entry Simplified Chinese UI glossary answers common English labels locally, including Go to file,
More items, Labels, New issue, Contributor and opened. Other Chinese variants and configurations
with a user glossary retain the existing provider path. No runtime dependency or gateway change.
CSS and token-preserving JavaScript whitespace reductions keep the generated userscript at
399971 bytes, strictly below 400000; only 29 bytes remain to the limit. Further integration should
budget bundle size before adding runtime code. Extension loading remains zero-build.

Offline checks: 377 Node tests; 86 gateway tests; 22 release tests (one Windows symlink skip);
three navigation-read tests; project/import/manifest/syntax and release checks;
canonical MV3 `SUMMARY total=33 PASS=32 FAIL=0 SKIP=0 INFO=1`; layout
`SUMMARY total=10 PASS=10 FAIL=0 SKIP=0 INFO=0`; userscript
`SUMMARY userscript total=8 PASS=8 FAIL=0 SKIP=0`; PDF `PDF E2E: 6 PASS, 0 FAIL, 0 SKIP`.
The canonical INFO remains synthetic Alt+A. Added browser regressions cover constrained short
controls versus headlines, horizontal legacy boxes without line-clamp, native metadata clipping,
identifier protection, local UI words, word-fragment metadata, and exact restore after site style edits.
An initial final-run visible_controls assertion raced independently completed translation batches;
the test now waits for every inspected unit and icon attribute before checking layout. Its focused
rerun and subsequent complete layout run passed; runtime behavior was not changed for that failure.
A bounded refinement probe exposed a body-mutation rescan escaping a custom include selector;
the body special case is removed. The new scoped_dynamic_body regression verifies that outside
mutations remain unselected, inside additions still translate, and restore retains page additions.

Authorized public checks use anonymous free MT only, headed isolated Chromium for desktop and
375x812 Android-UA GM transport simulation for phone. No website login, CAPTCHA interaction,
campus request, subscription model or paid model call. BBC consent was dismissed only inside
disposable test contexts. Final phone confirmations use an explicit persistent profile under the
generated E2E cache run; initial diagnostic nonpersistent contexts used Playwright's auto-cleaned
system temporary profile. Screenshots, probes,
raw logs, reviewed screenshot hashes and final per-page data remain outside the repository in
`~/.cache/duallens-e2e/v04/fix/round2/` (`final-results.json`). All 22 after screenshots were inspected.

The final records combine the complete 22-case run with targeted HN/GitHub/issue confirmations
and all 11 phone cases refreshed using the explicit cache profile:
`FINAL PUBLIC SUMMARY total=22 PASS=18 FAIL=4`. Content-first timing below counts a readable
content translation or main-content heading, excludes navigation/buttons, and allows a locally
translated content heading. Raw first-UI timing is retained separately. Coverage freezes visible
top-document source nodes, excludes the requested identifiers and unchanged MT proper names,
and verifies grouped MV3 source ranges. It is not pixel/OCR coverage or coverage of iframe ads.
The native control metadata and dictionary confirmations did not change the other page layouts.

A separate one-source-line Pixiv probe configured only `ollama/qwen3:4b` via the existing loopback
gateway in a 375px MV3 context (not the GM userscript or a physical phone). JSON mode on/off
connection tests returned success (181 / 4235 ms), but both page results settled as MT with zero
confirmed LLM finals: first reader result 1063 / 828 ms, one unit, zero pending, same translation
node retained, clean restore. The local gateway models endpoint and Ollama tags
listed Qwen; a minimal direct local chat returned 200. These checks do not establish successful
in-page refinement. The initial scope guard aborted a broader text-count span; the corrected
probe preflights one wrapped actual source line before enabling translation. No paid/campus
fallback is configured. See `refine-json-mode.json`, `refine-result.json` and `refine.log`; leader should diagnose the
remaining refinement path separately. The full 22-case timings below remain MT measurements.

Desktop / phone content-first milliseconds and coverage:

- Wikipedia Machine translation: 782 / 1032 ms; 100% / 100%. Full source sentences and bilingual
  note/link flow; the literal href-identifier rule also preserves linked nouns such as language.
- GitHub microsoft/vscode: 1968 / 312 ms; 96.67% (29/30) / 100%. One frozen Releases node was
  replaced by GitHub hydration and conservatively counted uncovered; names/files/topics/license stay original.
- Hacker News: 797 / 1047 ms; 100% / 100%. Bilingual titles, compact menu and word-fragment metadata.
- GitHub issue 295783: 656 / 1078 ms; 100% / 100%. Actual issue rather than a redirected PR;
  source/author names and On Deck remain; edit-history clipping prevents the prior phone overlap.
- BBC News home: 719 / 1094 ms; 100% / 100%. Both headline languages; zero pending spinners.
- BBC article c6zjx7jexz1do: 375 / 1016 ms; 100% / 100%. Paul Adams retained and role translated.
  BBC advertising/subscription overlays can still cover screen edges; iframe text is outside this metric.
- MDN Array.prototype.map: 672 / 1750 ms; 100% / 100%. API names retained; long API heading wraps at 375px.
- Pixiv novel 29352462: 781 / 1312 ms; 100% / 100%. Reader starts at the first text-count line;
  original Japanese and Chinese paragraphs are visible on both sizes.
- Pixiv artwork 150822243: 359 / 1140 ms; 100% / 100%. Title/description bilingual, no new phone
  overflow. Text painted into the artwork is not translated by this DOM probe.
- Superuser question 477314: timing/coverage N/A on both; headed Chromium still received 403.
  Translating the security page is explicitly not counted as question acceptance.
- Reddit post 14trtla: timing/coverage N/A on both. The normal site presented a humanity challenge;
  old.reddit.com redirected to a login wall. No post-body acceptance was possible without login.

All available page cases finished with zero pending/error markers, no new horizontal document
overflow and no restore markers. The literal link-identifier rule may preserve ordinary words on
encyclopedia pages; leader should review that tradeoff. MT semantics remain imperfect, and the
existing floating controls or site ads can obscure a few edge pixels. Real-site long tasks include
website work and still exceed 50 ms in some captures; no attribution or elimination claim is made.
The earlier real PDF 56/82 ms observations were not addressed in this pass. Physical Windows
Chrome/Edge pairs, Android Edge/Tampermonkey sandbox isolation and actual tablet operation remain
leader/user acceptance work. The QA-owned acceptance matrix section is unchanged.

## v0.4 coverage and layout fix (2026-10-15, baseline 47c2060)

This worktree adds independent visible controls/attributes, a pure block/inline/replacement policy,
Unicode-aware short-text preferences, mode/engine invalidation and local PDF byline preservation.
Pixiv Android uses `p > span > span > span.text-count`; the inline wrappers must be scanned as
containers, otherwise a translation may appear only after a long shared paragraph. The regression
now covers those wrappers, ordinary div readers, dense table navigation, sentence context around
linked author/date metadata, constrained failure/retry, CSS Color 4 conversion and exact restore.

Offline results: 375 Node tests, 86 gateway tests, 22 release tests (one Windows symlink skip).
Canonical extension summary: `SUMMARY total=33 PASS=32 FAIL=0 SKIP=0 INFO=1`; layout:
`SUMMARY total=8 PASS=8 FAIL=0 SKIP=0 INFO=0`; userscript:
`SUMMARY userscript total=8 PASS=8 FAIL=0 SKIP=0`; PDF: `PDF E2E: 6 PASS, 0 FAIL, 0 SKIP`.
The extension INFO is the existing synthetic Alt+A limitation. The userscript is 395562 bytes,
below the 400000-byte contract. No runtime dependency, gateway change, commit or publication is included.

Separate authorized public-page probes visited Wikipedia, GitHub, Hacker News, Stack Overflow,
BBC News, MDN, Pixiv novel and artwork pages, on a desktop MV3 extension and a 375x812 Android-UA
GM transport simulation. The complete 16-case probe reported `PUBLIC SUMMARY total=16 PASS=7 FAIL=9`.
Subsequent checks of the final HN/novel/MDN/artwork fixes reported
`PUBLIC SUMMARY total=8 PASS=6 FAIL=2`. HN measured 98.58% / 781 ms desktop and 98.63% / 1031 ms
phone; Pixiv novel measured 96.15% / 328 ms and 100% / 922 ms; a public non-sensitive artwork
(`https://www.pixiv.net/artworks/150822243`) measured 100% / 750 ms and 100% / 1000 ms.
Those percentages describe rendered DOM translations in the frozen visible source cohort, with
source-range verification for grouped extension units. They do not measure text painted inside images.

The hard acceptance target is **not fully achieved**. GitHub and MDN retain names/identifiers such
as vscode, HTML, CSS, JavaScript and Array.prototype.map(); requests can finish successfully without
creating a Chinese duplicate. The strict metric does not count those as rendered translations.
MDN's last check measured 84.85% desktop / 90% phone. Stack Overflow returned 403/security challenges;
no question-page acceptance was obtained. BBC phone displayed a cross-origin consent frame that this
top-frame-only translator does not translate. No login or consent submission was performed.

All MT requests used free anonymous endpoints. Local refinement used only the explicitly selected
`ollama/qwen3:4b` at the existing loopback gateway; no campus, Claude, Codex or paid model was called.
The final independent reader-range probe rendered 15 MT units but confirmed zero LLM refinements;
its first reader result took 3859 ms. The <=3-second target therefore remains unproven universally.
The older engine live runner also reported FAIL; its per-span matching cannot establish coverage
when natural paragraphs are grouped. These failures are retained, not counted as offline passes.

Before/after screenshots were inspected locally; HN menus stay compact and the mobile novel now
shows translations beside the relevant source lines. Runtime JSON, probes and screenshots stay in
`~/.cache/duallens-e2e/v04/fix/`, outside release inputs. Real-page long tasks include website work;
they cannot isolate extension cost. The PDF mock run observed no long tasks, but the earlier real
56/82 ms observations were not independently eliminated. Pure-colour contrast calculation is tested
at >=4.5; gradients, background images and ancestor opacity/filter still require pixel-level review.
Two physical Windows installations, Android Edge/Tampermonkey isolation and actual tablet operation
remain leader/user acceptance work. The QA-owned acceptance matrix section is unchanged.

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
