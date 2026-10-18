# Changelog

## [Unreleased]

## [0.5.0] - 2026-10-18

- Translate text inside iframes: same-origin frames (no src, about:blank, srcdoc) become scan roots of the top page in extension and userscript, with style injection, document-replacement rescans and exact restore; cross-origin frames run a UI-less, push-driven agent in the extension. Tiny or invisible frames are skipped. No new permissions.
- Translate open Shadow DOM (nested and dynamic roots, slot content once); closed roots are skipped.
- Site rules match host/path globs (optional scheme/port), most specific wins; per-rule page/selection/hover/input switches; popup "this path only"; SPA route changes re-evaluate rules via the Navigation API.
- Userscript settings panel ships as a pinned, SHA-256-checked @resource loaded on first open (startup bundle 312 KB).
- Fix: userscript hashing on plain-HTTP pages without crypto.subtle (pure-JS SHA-256 fallback).

## [0.4.0] - 2026-10-16

- Dual engine: free machine translation (Microsoft Edge endpoint, Google fallback) shows drafts instantly; the LLM refines prose units in place (`translation.mode` mt / llm / mt+llm default / auto). Works with no model configured.
- Short UI text, navigation and metadata use MT or a built-in UI glossary; only prose goes to the LLM. Non-JSON model output fails over; the provider test runs a real two-item translation.
- Translate all visible text (controls, labels, placeholders, captions, footers, comments, dynamic content) with per-container presentation: block for prose, inline for short labels, measured replace-only for tiny controls; titles always keep the original.
- Protect identifiers (paths, users, branches, topics, licenses) and author/channel/citation names; compact metadata lines; computed translation colour for dark sites; first-screen priority scheduling; re-translate after mode/engine changes.
- Layout-preserving bilingual PDF pages (same-size translated page over the original render, four views, author/affiliation lines kept).
- Gateway: `auto` virtual model across SJTU / free Hermes / Ollama (never subscriptions), queueing instead of instant 503, SJTU token bucket, phased timeouts, richer `/health`; one-click gateway setup defaults to `auto`.
- Real-site acceptance matrix tool (`tests/e2e/run_acceptance.py`); userscript startup budget lowered to 360 KB.

## [0.3.1] - 2026-10-14

- Schedule novel paragraphs by their own source ranges rather than a shared tall host; preserve scroll discovery and avoid whole-story requests.
- Reject approximate Japanese prose echoes before streamed display and recover unfinished omissions with the existing bounded batch-retry budget; prompt cache version 4.
- Make real-page read probes resilient to document navigation and run Pixiv checks without a hard-coded HTTP proxy.

- Stream OpenAI-compatible responses through extension fetch, userscript GM progress and optional gateway SSE; display completed items early and use smaller first-viewport batches.
- Cool down and hide missing models after 404; discover Hermes models from the proxy catalog intersected with the configured free allowlist.
- Split Pixiv novel paragraphs, place comic panels in document flow, and preserve PDF formula runs as placeholders.
- Fix Pixiv image downloads with extension-scoped session Referer rules and anonymous GM headers; disabling comics/removing sites deletes rules.
- Route floating-ball restore through common page/comic/subtitle commands; keep optional CDN metadata across settings edits.
- Preserve validated neighboring translations when an unchanged proper name triggers model fallback in a JSON batch.
- Keep numbered PDF table-of-contents leader rows separate; scope content-omission fallback to the current job instead of cooling a working model globally.
- Bound malformed-cardinality recovery to eight additional half-batch/single-item requests per original batch without guessing item correspondence.
- Forward detected source-language hints, reject unchanged Japanese prose, and clarify that JSON/formatting placeholders contain text to translate; increment the prompt cache version.

## [0.3.0] - 2026-10-13

- Desktop PDF bilingual reading with local PDF.js rendering, selectable text, lazy nearby-paragraph translation, translation-only/restore, local-file selection and themes.
- YouTube bilingual captions from existing subtitle tracks, seek-aware scheduling and exact native-caption restoration; subtitle preferences survive configuration transfer.
- Desktop free-text side panel (Alt+S), with shared text/subtitle tabs in the userscript, explicit model selection, copy and system speech.
- Fix popup width and narrow-window layout.
- Keep QR generation in extension options through an optional platform capability; mobile encrypted export uses copyable text and stays below the unchanged 400 KB userscript startup budget.
- Include subtitle documentation and v0.3 release notes in the public package allowlist.

## [0.2.0] - 2026-10-13

- Generic multi-platform release: settings v2 with synced public settings and device-local secrets, provider presets (OpenRouter free-model discovery first), cross-profile fallback chain, encrypted config export/import.
- Tampermonkey userscript build for Android Edge (and desktop), touch interactions (long-press, selection icon below range, draggable float ball).
- Comic translation phase 1: on-device Tesseract OCR in an offscreen document, side-column bilingual reading-order list; only OCR text reaches the translation service.
- Edge Add-ons package target, listing docs, privacy policy and real-UI store screenshots.

- Replace userscript key/password fields and the Proxy adapter with native sandbox secret prompts, key-presence status and set/clear actions; preserve extension options behavior.
- Validate userscript metadata/version, SHA-256 and rebuilt bytes, optional Edge store package contents, and release-directory asset consistency; remove stale versioned assets before publishing staged builds.

- Connect desktop extension and Tampermonkey userscript to the shared v2 settings store; separate public sync settings and local secrets.
- Migrate transitional GM settings once and inject secret resolution into userscript providers and translator; support cross-profile fallback.
- Reuse the shared settings wizard inside the page panel, with no stored-key backfill, cache clear and teardown.
- Fix hover translations being cleared when Chrome storage reordered provider object keys during migration; reload v2 change notifications correctly.
- Add sync-only settings/hover and mocked OpenRouter userscript privacy regressions; document all three browser runners.
- Document OpenRouter free models, optional desktop gateway, Android Edge/Tampermonkey setup and the remaining Android Chrome/device-acceptance boundaries.

## v0.1.0 — 2026-10-13

Initial open-source web translation release.

- Bilingual, translation-only and restore; lazy/dynamic paragraphs and inline formatting.
- Selection, hover, input shortcuts, 15 styles, glossary, prompts and site preferences.
- JSON batching, cache, model cooldown/fallback and safe text insertion.
- Configurable compatible endpoint, offline mock, standard-library loopback gateway and opt-in model integrations.
- Explicit provider setup for new installs; no automatic use of local accounts.
- Reproducible release ZIPs and SHA256SUMS; Windows/Ubuntu offline CI and isolated mock browser checks.

PDF/EPUB, subtitles, OCR, documents and iframe translation are planned, not included.
