# Validation

## v0.5 userscript slimming and route detection (2026-10-18, working tree)

The startup artifact is 312039 bytes; the separately pinned settings resource is 117302 bytes.
The 360000-byte build limit is unchanged and a real-build regression enforces the 330000-byte target.
Offline checks passed 411 Node tests, 86 gateway tests, and 25 release tests (one Windows symlink skip).
Project validation, release generation and dist rebuild/checksum comparison passed.
Browser summaries: canonical 33 PASS / 0 FAIL / 1 INFO; userscript 11 PASS; settings 7 PASS;
frames/open-shadow 4 PASS; layout 12 PASS. All browser runs use mock providers and isolated Chromium
with Playwright 1.48, not physical Android or actual Tampermonkey installs.

Resource cases check lazy loading, cached reuse, save/reopen, native secret dialogs, and Chinese reinstall
guidance on missing/tampered/unavailable resources without a network fallback. SHA-256 fallback tests
cover UTF-8 and padding boundaries without Web Crypto. Route tests cover both Navigation API events,
deduplication, shared subscribers, legacy events, visible-only polling and lifecycle cleanup.
The settings runner now returns its options tab to the foreground after the popup case; this avoids
a repeatable background screenshot timeout without changing functional assertions.

An extra non-secure HTTP fixture exposed an existing startup error: shared/hash.js requires
crypto.subtle.digest, which is unavailable in that page world. That shared hash path is unchanged;
full HTTP-page support is not certified by the new resource hash fallback. Actual Tampermonkey
resource caching, isolated-world execution and the physical device matrix remain manual acceptance.

## v0.4 fourth layout pass (2026-10-16, working tree)

Based on leader commit `fca8ae9`; no commit, version, gateway configuration or QA-owned tooling change.
The leader independently deployed v0.4 and reported a 0.93-second draft / 4.6-second auto final;
those timings are leader evidence, not this worktree's new provider acceptance.

Changes: visible aria-hidden text follows visual visibility; author/channel/citation metadata stays
original; the LLM prompt (version 5) retains product/person names. A repeated-capitalized-word
atom heuristic was tried and removed: it kept ordinary words (Japan, Language) untranslated. A real Attention PDF local/mock probe found Unicode star
markers and the old 45-percent cutoff excluding authors; all eight authors now classify as identity,
while paper title and abstract remain text. Tests cover both merged email groups and title negatives.

SPA scanning/result work uses bounded ordinary tasks rather than idle-only scheduling; language
detection has a 50-ms deadline. YouTube navigation-ready events reprime visible blocks and terms.
Global MT waiters prioritize visible work over prefetch; already started requests finish normally,
including paragraphs displaced by earlier bilingual additions. A parse failure in one HTTP 200 batch no longer cools the whole engine;
network/rate failures retain backoff. Page errors get at most two delayed retries, neutral small
retry markers, and retain original source. These mechanisms do not guarantee public network latency.

Class/style mutations refit existing translations and scan newly visible content without discarding
all translated children. Local prose clipping may be released up to eight ancestors, bounded by
page-level containers, retaining native subsequent style changes for restore. A live Amazon expanded
description probe measured 280 px becoming about 1190 px with subsequent content in normal flow;
the former severe overlap was absent in that screenshot. Title line-height and thumbnail text backing
have browser regressions. Deterministic numeric module ids and reserved shorter packer bindings keep
all mobile features and the 360000-byte working budget; current runtime bundle is 357529 bytes.

Public diagnostics/artifacts stay outside the repository in `fix/round4/` and `acceptance/fix-r4-complete/`.
All new live probes use anonymous free MT or offline mock; no campus, paid, local LLM or production
profile is used. Final matrix/scroll results are recorded separately after the frozen-source run.
Android viewport and GM emulation do not establish physical Edge/Tampermonkey support.

Frozen-source fourth-pass checks passed 391 Node tests, 86 gateway tests, 22 release tests (one
Windows symlink skip), 39 QA-tool tests, 32 canonical browser functional cases plus one INFO,
12 layout cases, eight userscript cases, six PDF cases and six settings-browser cases. Project,
release generation and packaged-project checks passed; the version stays 0.3.1.

The complete requested ten-site/four-device MT-only matrix in `acceptance/fix-r4-complete/` reports
`total=40 PASS=6 FAIL=34 UNREACHABLE=0 UNSUPPORTED=0 ERROR=0`. All 38 observed first translations
were within three seconds; YouTube desktop/light/dark measured 0.452/0.461 seconds and NHK
0.737/0.306 seconds. Raw coverage still counts newly protected authors and dates as missing;
the raw FAIL verdicts are retained. There are 20 rows with geometry candidates, 22 with coverage
below 95%, and 17 with structural restore failures. No extension residue was reported, but native
node/attribute differences are not all explained by the controls; exact real-site restore is not
established universally. Naver tablet retains real missing paragraph candidates.

Independent sequential timing diagnostics registered YouTube units in about 12 ms and requested MT
in 131–138 ms; first results arrived in 0.345/1.241 seconds. An earlier same-round trace registered
in 14 ms and requested in 143 ms but returned at 3.03 seconds with HTTP 400/429 observations;
network latency is not guaranteed. arXiv traces contained a 114-byte rejected MS request and one
Google 429; maximum request size was 1207 bytes, not an oversized request. The old 80-error burst
was not reproduced, and final arXiv rows reported no visible errors; its historical cause is not
proven by these traces.

The strict novel scroll probe performed ten one-screen moves per device, tracking only newly
entering original reader Text nodes. Desktop completed all ten cohorts (first <=0.854 s, all
<=1.232 s). Phone had nine new cohorts, all complete (first <=0.948 s, all <=2.374 s); screen two
contains previously counted prose. Tablet had six new cohorts, all complete, but screen five first
took 1.741 s and the slowest full cohort took 2.482 s. Tablet screen two is previously counted
prose and screens 8–10 are after the chapter. Those zero-new-text screens are N/A, not timing
passes. Footer pending controls remain separate from reader coverage. The <=1.5-second scroll
target is therefore not fully met. Pure long-vowel divider lines are excluded from probe counts;
the runtime still sometimes duplicates those separators.

All 80 main matrix images, 20 additional ordinary mobile/tablet viewport images and 30 scroll
images were inspected and hashed in `fix/round4/reviewed-images.json`. Same-page ordinary viewport
screenshots show the GitHub phone title wrapped correctly before and after the QA CDP screenshot
function, while that function's image crops it horizontally. The isolated width probe preserves
all three images plus measured viewport/body/title widths. QA-owned code was not changed; raw
matrix pictures and verdicts stay untouched. Ordinary screenshots also show the remaining actual
Amazon navigation growth, cramped Pixiv cover-card heading, collapsed YouTube phone title and
large blog headline. The first ordinary artwork-phone capture timed out waiting for fonts; a
separate successful retry is retained. Fullscreen desktop artwork `#1` has no eligible DOM prose,
so its empty cohort does not establish OCR or translation coverage. PDF 56/82-ms historical long
tasks and physical device acceptance remain unverified in this pass.

## v0.4 third layout pass (2026-10-16, committed as fca8ae9)

Based on `95febe1`, including the committed second pass and QA acceptance tooling; this historical
third pass was committed by the leader as `fca8ae9`. No gateway, provider configuration, production browser profile or version change.
Automatic page/PDF hybrid refinement now selects prose/title/list/cell units with at least six words
or twelve CJK characters. Controls, navigation, metadata, attributes and local glossary matches stay
MT/dictionary finals. Malformed non-JSON output fails that chain model immediately; connection tests
require both items of a real translation probe. Offline tests exercise a thinking-text response and
failover without contacting a model. Deployment of the leader's v0.4 gateway remains separate.

Capitalized UI words no longer match the lowercase href-identifier shortcut. GitHub file tables and
semantic file trees, usernames, Sphinx signatures and other requested identifiers retain source text.
Boundary identifiers (including nested HN domains) stay beside the original headline and outside the
translation request. HN metadata uses one compact sentence, preserves protected usernames through
the normal safe placeholder serializer, and translates whole relative-time phrases. Viewport priming
also runs at scroll zero; idle scanning yields after an eight-millisecond slice and prioritizes source
text before attribute enumeration. Pixiv reader priming and normal traversal share logical roots.

Prose clipping changes stop before page-level containers; targeted flexible-prose regressions can
shrink without horizontal overflow. This does not establish layout acceptance on all sites below.
Partial source ranges have explicit association wrappers and restore exact original Text
node identity, content, parent and order in the browser regression, including surrounding whitespace.
Wiki edit tools remain compact inline UI. Every translated output path uses the computed foreground
color; the dark fixture checks actual contrast >=4.5 against its background, including low-contrast
source text. Real sites with images/gradients and native opacity still require screenshot review.
PDF restore removes an empty body class introduced by the reader's translation state.

The QR encoder was already outside the userscript import graph at this baseline. The graph regression
also excludes PDF.js, the PDF viewer and the desktop sidebar/platform. Mobile OCR/comic functionality
and shared text/subtitle tabs remain. Dependency-free token-preserving packing and shared live-export
getters reduce the bundle to **359771 bytes**, leaving 40229 bytes below the unchanged 400000-byte
ceiling. The current build enforces the stricter 360000-byte target; extension loading stays zero-build.

Public evidence for this pass is stored only under `~/.cache/duallens-e2e/v04/fix/round3/` and
`~/.cache/duallens-e2e/v04/acceptance/`. Runs use anonymous free MT with `--llm none`; no campus,
paid, subscription or local LLM inference is used. Android sizes are isolated Chromium/GM emulation,
not physical Android or Tampermonkey acceptance. Raw QA FAIL results are retained without adjusting
the QA-owned denominator or restoration rules. Final results and screenshot-review notes follow in
the external delivery report; earlier interrupted runs are diagnostics, not a combined acceptance run.

Offline checks on the final runtime: 387 Node tests, 86 gateway tests, 22 release tests (one Windows
symlink skip), 39 QA-tool tests, project validation; canonical extension
`SUMMARY total=33 PASS=32 FAIL=0 SKIP=0 INFO=1` (synthetic Alt+A INFO), layout
`SUMMARY total=11 PASS=11 FAIL=0 SKIP=0 INFO=0`, userscript
`SUMMARY userscript total=8 PASS=8 FAIL=0 SKIP=0`, PDF `PDF E2E: 6 PASS, 0 FAIL, 0 SKIP`,
settings `SUMMARY settings-browser total=6 PASS=6 FAIL=0 mock-only viewport=375x812`.
The final layout regression also verifies radio labels in a whitespace-free form remain eligible:
edge-identifier recognition cannot treat an aggregate form/container as a camelCase identifier.
HN inline comment heads use the same metadata path. When their only remaining source is a date and
protected/aria-hidden fragments, unchanged local output is skipped rather than duplicated or claimed
as an unchanged MT response. The regression covers both eligible navigation and aria-hidden navigation.

Three additional real PDF first-page probes (Attention, ResNet and the public lecture PDF) recorded
first finals of 601.8 / 681.5 / 187.2 ms, unchanged source layers, no residual reader attributes, and
no observed >50 ms long task. The only reported slow sheet step was 18 ms. The old 56/82 ms events
were not reproduced; this sample does not establish a universal bound or identify pdf.js as their cause.
No new scheduling rewrite is claimed for these samples.

Final public run `acceptance/fix-r3-delivered` (the exact requested fifteen-site/all-device command):
**60 total, 11 PASS, 48 FAIL, 1 UNREACHABLE**. Overlapping failure categories: coverage 30 rows,
layout 28, restore 21, first translation above three seconds 1. YouTube desktop recorded **3.472 s**;
the timing requirement is not met. Supplementary NHK: 2 FAIL, first translation 0.761/0.313 s,
coverage 100%, four overflow candidates each. Its native overseas-access modal clips lower content
after bilingual additions. Supplementary real PDF: 8 total, 2 PASS, 6 FAIL. All eight have no reader
residue; six preserve both original text layer and canvas pixels, two dark rows do not. A separate
Attention/page-11 dark probe did not reproduce the source-layer/pixel difference; this is not proof
that the original FAIL was false. The QA PDF error collector includes offscreen wait elements and
does not filter visibility; four PDF FAIL rows contain only empty pending markers. Contrast candidates
include real red-on-white labels below 4.5, plus a white-on-green definition whose canvas background
is absent from the CSS-only background calculation. Raw results remain unchanged.

Manual review covered all 60 translated viewport images and all 60 full captures, six native-control
viewports, and 28 NHK/PDF viewport/full/detail images. SHA-256 and individual notes are in external
`delivered-reviewed-images.json` and `supplemental-reviewed-images.json`; full captures expose later
offscreen English/Japanese and pending units that first-viewport coverage cannot measure. Remaining
real defects include severe expanded-description overlap on Amazon desktop, untranslated mobile
Amazon description, tight Naver title line height, GitHub issue phone title clipping, unwanted author
translations (arXiv HTML/PDF, Pixiv, blog byline), and weak thumbnail-overlay text contrast on YouTube
phone. The phone blog byline can replace the original name. Pixiv phone novel body remains largely
Japanese/pending in the full capture. The arXiv dark run has 80 failed units; transport cause is not
established. Neither raw PASS nor this review constitutes full-page or physical-device acceptance.

Some coverage FAILs include required exceptions: Python Sphinx API signature fragments, GitHub branch
and semantic tree file names, HN dates and aria-hidden navigation, arXiv identifiers/timestamps. The
QA-owned denominator was not changed. Wikipedia desktop's first whitespace-order difference is
identical in the no-translation control (index 208); this does not demonstrate an unwrap regression.
Other live-site attribute changes remain unresolved rather than broadly excused; Naver desktop has
one residual class candidate. BBC consent overlays and desktop Pixiv's fullscreen image-only viewer
prevent clean content acceptance; the latter is not a crash or an OCR test. The Naver phone load
failed with ERR_CONNECTION_CLOSED. Details for every non-PASS row, raw matrices, and review notes
are in external `fix/round3/complete-report.md`. These results do **not** satisfy release acceptance.

## v0.4 second layout pass (2026-10-16, committed baseline)

Based on leader commit `47c2060`; committed as `b3893a0`. Headlines, article links and long
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

## v0.4 real-site acceptance tooling (QA)

`tests/e2e/run_acceptance.py` records a reproducible public-site × desktop/light/dark/phone/tablet matrix with first translation, fixed-viewport fill, actual LLM-final time, independent visible-text coverage, missing selectors/snippets, geometry findings with screenshots, visible translation errors, and structural restore (strict body equality retained as a reference). Use `--repo` to test a colleague's checkout through an isolated staged extension and freshly built userscript. No production code or model key is changed. Detailed algorithm, caveats and commands are in [the acceptance runner instructions](../tests/e2e/README.md#v04-public-site-acceptance-matrix).

Default MT runs use free unofficial Microsoft/Google services and require explicit real-provider authorization. Optional gateway runs use 18799 and an in-memory free-only `auto` policy: existing allowlisted Hermes `:free` and Ollama candidates plus enabled SJTU, capped at 15 attempts by a persistent test ledger. Claude/Codex/remote are disabled; user configuration is never written. This policy is offline-tested; the second-round three-site selfcheck does not call a gateway. The runner is separate from mock CI. Raw matrices/screenshots stay in `~/.cache/duallens-e2e/v04/acceptance/`; published/release files must not absorb runtime profiles or logs.

Thresholds are first visible translation ≤3 seconds and ≥95% coverage, with no newly detected layout issue/visible error and exact restore. A timeout-retained MT result is not an LLM final. Coverage is structural presence, not a semantic quality score. PDF rows use reader text blocks and are tagged separately; mobile PDF is unsupported by the platform contract. Dark-media emulation cannot force a site-selected light theme. A site access wall remains UNREACHABLE; it is never bypassed or passed.

Desktop Chromium plus an equivalent GM stub is the automation boundary. Physical Android Edge/Tampermonkey, Android Chrome bookmarklets, two actual Windows devices and real Chrome/Edge installations still require separate manual acceptance. Dynamic site changes can fail strict restore; first-difference and no-translation-control evidence must be reviewed before attributing them to the extension.

The 2026-10-16 QA baseline on source revision `e85e8cb` completed 100 cases: 8 PASS, 61 FAIL, 23 UNREACHABLE, 8 UNSUPPORTED, 0 harness ERROR. All 60 observed first translations were within 3 seconds; absence of a first translation is still a failure, not a timing pass. The run does not meet the broad acceptance target. Raw results, per-case findings and screenshots are in the machine-local `~/.cache/duallens-e2e/v04/acceptance/v04-qa-final-run/`; none are release inputs.

Important interpretation limits: the structural coverage heuristic can undercount aggregated BR-separated/ancestor-host translations and is not a semantic quality score. Whole-body restore includes website-owned reactive changes and PDF reader toolbar/status changes. A separate no-translation screenshot control left Wikipedia unchanged twice, while GitHub updated its pane-width attributes on its first control pass. PDF contrast flags over painted canvas/whiteout backgrounds need visual review. Initial-viewport results do not certify expanded menus, lower-page comments/footers, closed shadow roots, iframes or physical devices. The two Wikipedia repeats did not establish numerical identity apart from timing.

The separate 10-page local-only gateway trial completed with 3 functional PASS and 7 FAIL, no visible retry/pending controls at the final checks, and zero SJTU calls. It recorded only partial refinement (eight visible source nodes on one issue page), with no complete LLM viewport-final time. This earlier trial uses coverage version 1; the final MT baseline uses version 2, so their coverage percentages must not be directly compared. The temporary 18799 listener was confirmed closed. Remote auto routing and fully successful LLM refinement remain unverified.

### Second-round leader policy (coverage v3, restore v2)

The preceding 100-row baseline and local gateway trial are historical, before this policy. The second-round tool separately lists identifier/link-tail/brand/product/language/person/username exceptions and observed unchanged-MT units as `exclusions` (按例外排除). A stable `data-dl-state="same"` marker wins; older whole-host `done`+id with no translation/retry/nested host is an explicitly labelled `showNothing` inference. Unknown names stay in the denominator. The finite name set/context heuristics and ambiguous language detection remain auditable limits, not claims of semantic understanding.

Web restore now requires zero extension residue, exact preexisting text content/parent paths/document order, and original attributes. Only a change of the same attribute at the same structural path observed in a fresh no-translation control of matching duration may be explained as site behavior. Control captures replay at the same elapsed offset; final URL, requested/actual durations, raw attribute activity/deltas and screenshots are retained. A failed/mismatched control explains nothing. Newly empty class, dl elements/classes/data attributes and text/order changes always fail. Known UI hosts are ignored; preexisting empty class is preserved. `restore_strict` retains literal body comparison as reference. Sequential controls do not deterministically replay ads or hydration.

PDF restore allows reader toolbar/status/button changes, but each requested page must retain identical original text-layer DOM and original canvas pixels, with no extension residue (including new empty class). Pages 1/2/11 remain independently measured rows; this does not inspect every offscreen page of a long document. The second-round bounded selfcheck does not rerun live PDF rendering; updated PDF verdict behavior is checked offline.

`probe_acceptance_sites.py` performs a single truly headed, ordinary-desktop-UA public visit per URL and saves reachability separately from translation acceptance. AP recovered (200); Stack Overflow/eBay stayed 403 and both selected old.reddit posts redirected to login. Super User and Etsy fallback candidates also returned 403; Guardian is reachable. NHK's retired `www3` homepage redirects to official `news.web.nhk`; the site list now uses a verified article there, published 2026-10-15. Its official-domain migration is an explicit departure from the requested old path, not an invented current-day URL. No login, captcha or consent actions were attempted.

The second-round three-site selfcheck used only `v04-qa` (extension revision `2f19ae1`) and the same final probe hash across desktop/light/dark and phone: 9 rows, **5 PASS / 4 FAIL**, no UNREACHABLE/UNSUPPORTED/harness ERROR. All nine first translations appeared within 0.964 seconds; desktop coverage was 97.5–99.1% and all phone coverage was 100%. GitHub desktop and phone demonstrate `restore_strict=false` with structural restore passing after same-attribute control explanation. Three dark rows retain low-contrast findings; phone GitHub retains two flex/grid alignment candidates. Wikipedia dark also fails original text order around its responsive TOC. Wikipedia restore varied across retained trials, so this is not a claim of repeatable restoration stability. The final complete batches, not selected winning rows, are merged in machine-local `~/.cache/duallens-e2e/v04/acceptance/round2-delivery-matrix/` with per-row source evidence paths. No `v04-int` acceptance, real LLM, physical device, tablet or live PDF run was performed in this round.
