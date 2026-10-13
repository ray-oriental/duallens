# Changelog

## [Unreleased]

## [0.2.0] - 2026-10-13

- Config center: one-click local gateway setup with a recommended chain, phone pairing over Tailscale or USB (opt-in, 256-bit token, Tailscale-only remote listener), encrypted export-to-phone with QR, and docs/SETUP-ALL-DEVICES.md.

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
