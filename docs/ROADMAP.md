# Roadmap

## v0.1.0 — implemented

Top-frame webpage bilingual/translation-only/restore, paragraph and inline formatting, viewport lazy translation, dynamic content and SPA handling, hover/selection/input interactions, 15 styles, popup/options, glossary/prompt/site preferences, cache and per-model fallback. Direct compatible endpoints, offline mock and optional loopback gateway.

## Planned P1

- Android Chrome bookmarklet and local configuration generator (best effort; page-context key exposure and CSP risks must be explained).

- EPUB bilingual reading.

## Planned P2

- Further OCR/image/comic workflows (visual models, complex layouts) and document translation.
- Cross-frame translation.
- Broader site compatibility and language/UI coverage.

The roadmap is a development direction, not a claim that these features are present or a promised delivery date. Use GitHub issues to propose a bounded feature with an acceptance example.

## v0.2.0 — implemented

- Shared platform interface and content entry for MV3 desktop and the bundled Tampermonkey userscript.
- Settings v2: split nonsecret Chrome sync settings with whole-store local fallback; device-local secrets; idempotent v1/GM migration.
- Shared settings form and presets, explicit first-use wizard, OpenRouter free-model discovery and cross-profile fallback chains.
- Passphrase-encrypted configuration transfer and key-free plaintext export; userscript native sandbox dialogs for keys/passphrases, with no secret input fields or stored-key backfill.
- Android Edge/Tampermonkey input controls, 500ms cancellable long-press, below-selection touch targets, floating-ball drag/menu and full-viewport settings on narrow screens.
- Runtime mobile batch/concurrency/margin caps, idle slices and GM-only persistent cache (2 MB); no host-page storage for keys/cache.
- User-script release asset with SHA256SUMS and Edge store packaging/material preparation.
- First-phase local comic OCR with side-column bilingual text and explicit restore; no image upload or visual-model translation.

## v0.3.0 — implemented

- Desktop local PDF.js text-layer bilingual reading with lazy rendering/translation, local file selection, themes and restore. Scanned PDF OCR and mobile native PDF reading are not implemented.
- YouTube bilingual captions using existing tracks, current-position scheduling, seek/SPA cleanup and restored native captions. No speech recognition or other video services.
- Desktop free-text side panel (Alt+S); userscript text/subtitle tabs, explicit service/model choice, copy and system speech.
- Popup width repair, optional desktop QR export and copyable encrypted mobile transfer under the unchanged 400000-byte startup limit.

Real Android Edge/Tampermonkey and both physical Windows browser installations require device acceptance. Offline Chromium/GM stubs are not a claim of completed real-device validation. Store submission/review and a real OpenRouter request are separate authorized release actions. Android Chrome bookmarklet is not implemented.
