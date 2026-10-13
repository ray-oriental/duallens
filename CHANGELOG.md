# Changelog

## [Unreleased]

- Connect desktop extension and Tampermonkey userscript to the shared v2 settings store; separate public sync settings and local secrets.
- Migrate transitional GM settings once and inject secret resolution into userscript providers and translator; support cross-profile fallback.
- Reuse the shared settings wizard inside the page panel, with private bullet-only key editing, no stored-key backfill, cache clear and teardown.
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
