# Changelog

## [Unreleased]

## [1.1.0] - 2026-10-26

- PDF: export a bilingual PDF (side by side or translated pages only, any page range) with progress and cancel; scanned pages can be recognized with on-device OCR and translated; the reader now uses the monochrome design.
- Errors: every failure says what happened and what to do, with retry, open-settings and details actions; transient failures retry quietly; partial failures offer "retry these paragraphs"; repeated errors visibly refresh.
- One vocabulary and one async-feedback pattern across popup, settings, side panel, in-page UI and the userscript panel; side-panel clear, swap and Esc cancel; site-rule rename and delete; validated glossary import; Esc closes input-box overlays.
- Security: in-page features act only on trusted user input; translation requests no longer follow redirects and responses are capped at 4 MiB; expired PDF handoff data is purged.
- Userscript: subtitles, OCR and comic code load on demand from a second pinned resource, `duallens-features.js`; startup drops from 345 KB to about 320 KB.

## [1.0.0] - 2026-10-22

- Redesigned, quiet interface (monochrome, no boxed cards) in English and Simplified Chinese.
- Quiet defaults, device-local destination confirmation, on-demand permissions and bilingual settings.
- Page, selection, input, hover, PDF, subtitle and local image-text translation with configurable AI services.
- Separate extension/store and Android userscript distributions with reproducible offline checks.
- Custom AI services: a root base URL that serves a webpage is completed to `/v1` after a probe; clearer errors for webpages, unparseable replies, auth and 404; every settings action shows a busy state and a timestamped result.

## Earlier versions

Early releases developed paragraph translation and exact restoration, formatting preservation, provider configuration, machine-translation drafts and AI refinement, PDF translation, local OCR, captions, frame support and portable settings. These features now form the current universal browser translation product.
