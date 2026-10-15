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

Run all three entry points from the repository root with the same Playwright Python/browser installation:

```powershell
$testPython = "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe"
# Optional: reuse an existing, matching Playwright 1.48 Chromium cache read-only.
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& $testPython -B -u tests/e2e/run_e2e.py --mock-only
node scripts/build_userscript.mjs
& $testPython -B -u tests/e2e/run_userscript_e2e.py
& $testPython -B -u tests/dom/run_settings_browser.py
```

`PLAYWRIGHT_BROWSERS_PATH` points to the parent of `chromium-1140`, not to the executable or the numbered directory itself. Omit it when using the normal Playwright cache. None of these commands starts a model server or uses credentials. Building a release with `python -B scripts/build_release.py` also creates `dist/duallens.user.js`.

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

## Userscript runner

`run_userscript_e2e.py` runs the unchanged generated userscript without an extension. A test-only GM transport/storage/menu stub and closed-shadow instrumentation exercise desktop translation, DOM-identical restore, translation-only, selection, shared settings and dynamic/SPA changes. Secret-transport and OpenRouter-preset cases accept native prompts through Playwright dialog handlers, check set/cancel/clear/reopen and encrypted backups, and assert there are no secret input fields or key values in page storage/DOM/window properties. An additional case loads the unchanged bundle into a real Chromium isolated world after the host page overrides its prompt and installs document input listeners; neither hook may receive the key.

Touch cases run at 375×812 and 800×1280 with a coarse pointer. They verify a cancellable 500ms hold, selection controls below the selection, floating-ball drag, focused-input translation, full-screen narrow settings and full long-page scroll/translation metrics. Reported long-task measurements are synthetic measurements, not guarantees for every website/device. The runner never makes a real model call and exits 1 on failure, 2 on an empty filter.

```sh
node scripts/build_userscript.mjs
python -B -u tests/e2e/run_userscript_e2e.py
python -B -u tests/e2e/run_userscript_e2e.py --only openrouter_profile
python -B -u tests/e2e/run_userscript_e2e.py --only mobile_375 --only tablet_800
```

Profiles are removed after the same bounded cleanup checks as the extension suite. Results and failure screenshots remain under `~/.cache/duallens-e2e/artifacts/userscript/`. GM instrumentation exists only in the runner, never in the release bundle. See [real-device acceptance](MOBILE_ACCEPTANCE.md) for Android Edge/Tampermonkey.

## Authorized v0.3.1 real-page runner

`run_v031_live.py --only novel` is separate from offline checks and requires explicit authorization for the existing local gateway and model calls. It uses a fresh profile, direct Chromium connections (`--no-proxy-server`), and bounded navigation/read retries. It never logs in. Reads may retry after document replacement; translation commands/clicks are never replayed blindly.

The novel probe measures Chinese translation in the current viewport, requires first translation within 3 seconds and viewport fill within 30 seconds, and checks translation-only, scroll discovery, floating-ball restore and original reader DOM. An untranslated line cannot borrow a later line's translation. Screenshots, safe numeric transport metrics and results stay under `~/.cache/duallens-e2e/v031/`.

The explicitly renewed streaming round uses `sjtu-budget-novel-stream.json`, distinct from the earlier round's ledger. Cumulative SJTU attempts are capped at 30; a run defaults to at most six (`--sjtu-limit` can lower or allocate the remaining authorized budget). The allowance is reserved before launch, so a crash cannot silently reset it. Do not delete/reset this ledger to obtain more calls. New rounds require new authorization. The old unsupported-stream local rejection exception applies only to that exact verified local error; normal failures/aborted requests count conservatively. `--max-items 1..20` changes only the temporary test profile and defaults to 20, matching the normal profile capacity; Japanese-to-Chinese first output starts with two items, with the remainder retaining profile capacity. Only the explicitly allowed SJTU, free Solar and local Qwen models may be used.

`python -B -m unittest discover -s tests/e2e -p test_live_runner.py` in the Playwright venv runs the read retry boundary tests without a browser or model. `run_layout_e2e.py` additionally exercises actual document navigation and a tall shared novel host using controlled offline fixtures.

## Authorized v0.4 engine measurements

`run_v04_engine_live.py` measures the requested public Wikipedia/Pixiv pages without login. Default `--llm none` uses only real free unofficial MT. `--llm ollama` explicitly uses the existing local `ollama/qwen3:4b` gateway profile with no other models; its default refinement budget is 20 seconds, or pass `--refine-timeout-ms 90000` for the normal setting. Clear `HTTP_PROXY` / `HTTPS_PROXY` for these direct-connection runs. Runtime profiles and screenshots stay under `~/.cache/duallens-e2e/`; no real-provider test belongs in mock CI.

The runner freezes the original visible source cohort before insertion. `stage:'final'` alone is not proof of LLM success: engine metadata separately counts actual `llm` results, and timeout-retained MT is reported as unavailable/partial refinement. Functional coverage/restore and the 1000ms speed target are separate fields. The `phone` variant uses Android UA, mobile layout and coarse touch emulation; it remains desktop Chromium, not actual Android/Tampermonkey. Reports include filters/budget in their names to preserve separate runs. A failed real-page probe remains FAIL; it is not silently skipped. See [current validation limits](../../docs/VALIDATION.md).

```powershell
& $testPython -B -u tests/e2e/run_v04_engine_live.py --llm none
& $testPython -B -u tests/e2e/run_v04_engine_live.py --llm ollama --only novel --viewport desktop --refine-timeout-ms 90000
```

## Settings browser runner

`tests/dom/run_settings_browser.py` stages an isolated extension using the canonical session helper and runs five checks: no-network fresh wizard, mocked OpenRouter discovery/test/save, encrypted/public backup, popup switching, and an injected shared form with Chrome APIs forbidden. It uses a 375×812 viewport and writes light/dark screenshots to `~/.cache/duallens-e2e/providers-settings/`. Run it directly; it accepts no case filters. This is separate from both the full extension suite and the userscript suite.

## v0.4 public-site acceptance matrix

`run_acceptance.py` is an explicitly authorized **real free MT** integration, separate from mock CI. No key is required. It reads `acceptance_sites.json`, stages the selected checkout's extension with the canonical helper, and builds that checkout's userscript into external test cache (never its `dist/`). It never logs in, bypasses a challenge, clicks consent, opens comments, or loads a real browser profile. A blocked/deleted/login-only URL stays `UNREACHABLE`; the list includes eBay as the additional Amazon fallback. Site availability is evidence, not a passing compatibility test.

```powershell
$testPython = "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& $testPython -B -m unittest discover -s tests/e2e -p test_acceptance.py
& $testPython -B -u tests/e2e/run_acceptance.py --llm none --device all
& $testPython -B -u tests/e2e/run_acceptance.py --only wiki --device desktop
# Re-run another colleague's checkout without changing it:
& $testPython -B -u tests/e2e/run_acceptance.py --repo C:\Users\ray_oriental\.cache\duallens-worktrees\v04-int --only wiki --device desktop
# Ten sequential desktop pages; auto is restricted to local Ollama in memory:
& $testPython -B -u tests/e2e/run_acceptance.py --device desktop --llm gateway --only wiki --only mdn --only python --only github --only github-issue --only hn --only hn-comments --only arxiv --only blog --only novel
```

Options: repeated `--only ID`, `--device desktop|phone|tablet|all`, `--llm none|gateway` (default `none`), `--repo PATH`, `--out EMPTY_DIR`, and optional observation deadline `--timeout 3..180`. Default deadlines are 25 seconds for MT and 95 seconds for gateway. A partial result can finish observation after at least five seconds and two seconds with no pending/draft nodes; missing fill/final marks remain null. Desktop is 1280×800 extension plus a second fresh-page dark-media check (MT only). Phone 375×812 and tablet 800×1280 use the unchanged userscript, Android UA and coarse touch, with GM-equivalent private in-memory storage/menu and anonymous host HTTP (no webpage CORS/cookies). Transport completion uses GM's permitted onload path; GM timeout=0 is handled as a 30-second host safety deadline, not a nonblocking socket. This is desktop Chromium emulation, **not physical Android or Tampermonkey security acceptance**. Dark-media preference does not override websites explicitly set to a light theme.

Interrupted runs can use `--resume EXISTING_RUN_DIR` with the same filters/device/LLM mode. Finished rows are retained, not retried; the extension tree and userscript SHA-256 must match. Remaining rows use the current harness (recorded in resume metadata). To supersede selected rows after fixing a harness issue, run those cases in a fresh directory, then use `python -B tests/e2e/merge_acceptance.py --run ORIGINAL_DIR --run RERUN_DIR --out NEW_EMPTY_DIR`. Later inputs explicitly win per `(page,device)`; inputs must have matching extension/userscript hashes and LLM policy. Each merged row retains its original `evidence_dir` and source run id; original reports and screenshots remain untouched.

Each run writes `matrix.md`, incremental `matrix.json`, per-page/device JSON, viewport PNG, full-page PNG capped at four screens, and per-finding clips to `~/.cache/duallens-e2e/v04/acceptance/<UTC-run-id>/`. `--out` overrides that directory but must be outside the checkout and empty; previous evidence is never overwritten. Profiles and staged code are bounded temporary directories under `~/.cache/duallens-e2e/` and removed on exit. Screenshots use native Chromium `Page.captureScreenshot` with document-coordinate clips and no DOM/style writes. This avoids Playwright's default caret hiding (which can leave empty inline styles), font waits on blocked pages, and viewport clipping of later PDF pages. Public-page artifacts are local evidence, not release inputs.

### Coverage and timing algorithm

`acceptance_probe.js` is independent of the production walker and `minChars`. Immediately before translation it freezes **each originally visible eligible Text node** as one item, plus each visible input/textarea placeholder and input button value as additional items. It uses per-text Range rectangles, viewport intersection, ancestor visibility/opacity/clipping and an element-from-point occlusion check. Exclusions are code/pre/kbd/samp/var, formulas/SVG/canvas, scripts/styles, embedded frames/media, URL-only/number-only/no-letter strings, Chinese-looking text (≥70% Han letters without kana/Hangul), and explicit site-exclude selectors supplied to `freeze`. No minimum text length, `translate=no`, `.notranslate`, form, navigation or menu exclusion silently shrinks the hard acceptance denominator. Default fresh test settings have no custom site exclusions. The Chinese heuristic can exclude Han-only Japanese names; this is a documented language ambiguity.

Coverage version 2 additionally recognizes obvious code tokens outside `<code>`: hexadecimal hashes (7–40 characters with a digit), dotfiles, common source/config filenames, `[vN]` version markers, arXiv ids, email addresses and abbreviated numeric counters such as `2.7k`. Natural navigation text (`Go`, `Read more`) still counts. Initial version-1 trial matrices are retained as development evidence; compare acceptance runs only when `coverage_version` matches.

A source node is covered only by its own marked whole-unit translation, or a following run translation before a block/BR/previous-translation boundary; traversal cannot borrow a descendant block or a later paragraph's translation. A result must be `done`, contain Han characters, differ from the source and not be display-hidden. Original node references survive insertion; a detached source stays missing. Attribute items require an actually changed Chinese attribute. Ratio = covered / frozen item count; empty cohorts do not pass. This measures structural translation presence, **not semantic completeness/quality** of each translation. BR-contained multi-line runs can be conservatively undercounted; uncertain associations stay missing.

The observer timestamps from immediately before the command, including command dispatch latency: `t_first` is the first actually visible Chinese translation, `t_fill` the first instant all frozen items are covered, `t_final` the first instant all those items have `stage=final,engine=llm`. MT retained after refinement failure never counts as an LLM final. Missing marks are null/—, never zero. Fixed-cohort coverage still includes original nodes pushed below the viewport by inserted translations. HTTP/navigation time precedes the trigger and is reported separately as reachability.

PDF entries are desktop-only, opened in the staged extension's PDF reader, with separate rows for requested pages (lecture 1/2/11). Their denominator is that reader's text-kind blocks on the requested page; formulas/page numbers remain original pixels. This differs from HTML text-node coverage and is explicitly tagged. First time requires a painted visible `.tb`, not just an internal completion. Mobile PDF rows are `UNSUPPORTED`, matching the current contract. Reader restore compares its entire body strictly; reader status/control changes are retained in the diff, not silently normalized away.

The PDF path polls with direct `page.evaluate` calls, following the canonical PDF suite: `wait_for_function`'s internal string evaluation can be rejected by extension CSP. Original requested-page DOM and canvas pixel SHA-256 are checked separately as `pdf_source_dom_identical` and `pdf_original_pixels_identical`; these supplemental checks never replace the strict body verdict. Four-screen captures start at the current scroll position, so a page-11 row captures page 11 rather than only the document's first pages.

### Layout, restore and verdicts

The probe records newly appearing horizontal overflow (>2 px), >1.6× short-control height, translated Range rectangles outside containers, new translated/source text intersections (>2 px in both axes), formerly aligned flex/grid siblings diverging, PDF overflow flags and dark-media foreground/background contrast <4.5. Existing overflow and ancestor/descendant element-box intersections do not count as new text collisions. Contrast supports RGB and sRGB computed colors and alpha compositing; images/gradients are unknown rather than guessed. Geometry candidates require screenshot review (natural wrapping and intended overlap can be legitimate). Only currently visible findings are inspected. Full-page screenshots do not imply the whole page was translated.

Restore compares cloned `document.body.outerHTML` byte-for-byte before/after, ignoring only `dl-ui` hosts. It also records a no-translation 500ms control comparison and the first diff, so autonomous ad/clock/site mutations can be distinguished from reproducible extension residue. It does not erase site mutations to manufacture PASS. Visible retry/error/pending elements and userscript error/toast/spinner content are recorded. A row passes only with first ≤3s, coverage ≥95%, no layout findings/visible errors and exact restore. `t_fill`/`t_final` are reported even when the 95% threshold passes. `UNREACHABLE`, `UNSUPPORTED` and harness `ERROR` are never PASS; non-PASS exits 1, invalid arguments/setup exits 2.

The gateway CLI cannot restrict backend policy without writing configuration. Therefore `--llm gateway` starts the same checkout's `Gateway`/`make_server` in a child process on **18799 only**, reads existing configuration only in memory, disables remote/SJTU/Hermes/Claude/Codex, and restricts `auto` to a configured small Ollama model (preferring qwen3:4b). It preserves the existing Ollama enabled setting. Its state/log home is temporary cache; no user configuration, token or credential is copied, printed or changed. SJTU calls = **0**. Port conflicts fail closed; an existing process is never reused/stopped. Only this child is terminated on exit. This measures auto with local-only candidates, not remote candidate selection or the production 18790 service.
