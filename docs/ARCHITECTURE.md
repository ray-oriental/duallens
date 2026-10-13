# Architecture and provider setup

## Translation pipeline

A classic extension loader constructs `platform/extension.js` and calls `content/main.js: start(platform)`. The userscript entry constructs `platform/userscript.js` and calls the same entry point. Content modules depend on the supplied platform for storage, translation, language detection, commands and settings; they do not read Chrome or GM globals.

The walker finds visible paragraph units and serializes inline formatting as bounded placeholders. IntersectionObserver schedules nearby units; idle slices spread scanning/insertion across frames. MutationObserver and navigation events handle updates. The injector restores only validated original formatting and safely inserts text; model output never reaches executable markup.

On the extension, translation uses runtime ports and the background service worker, with fetch and IndexedDB caching. On the userscript, the same providers, queue, translator and handlers run in the userscript sandbox, with injected anonymous `GM_xmlhttpRequest` transport and a timestamp-evicted memory/GM cache capped at 2 MB. Neither translations nor keys enter the site's localStorage or IndexedDB. Both providers and translator resolve keys through injected `getSecret(id)` at request time; public settings are not hydrated with keys.

The extension remains zero-build. `scripts/build_userscript.mjs` uses only Node standard-library modules to bundle the static module graph and CSS into a scoped IIFE. Unsupported module syntax fails the build. The generated `duallens.user.js` is a release asset covered by SHA256SUMS; bookmarklet delivery remains planned.

The interface contracts are [SPEC.md](SPEC.md) and [PLATFORMS.md](PLATFORMS.md). [ROADMAP.md](ROADMAP.md) separates implemented features from planned work.

## Settings and shared UI

Every platform uses `createSettingsStore({ syncArea, localArea })`. On the extension both areas use the common Chrome adapters from `shared/storage-areas.js`; quota/unavailable fallback belongs to the v2 store, not a second platform wrapper. Nonsecret settings are split across `settings.core`, `settings.glossary` and `settings.sites`. API keys stay in local `secrets`; the local compatibility mirror is key-free. New installations have no selected provider and make no automatic model requests.

The userscript uses a single GM private record for both areas. GM storage is local per script/manager; it is not cloud sync. Transitional GM public settings are migrated once, preserving an existing v2 configuration and newer local secrets. Encrypted configuration export/import is the explicit device-transfer path; plaintext exports omit secrets. Other devices need their own keys unless the user intentionally imports an encrypted backup.

`onChange` invalidates settings rather than sending a snapshot. Content reloads through the store, ignores stale loads, and compares objects independently of property order. This prevents a storage reordering/migration from canceling an in-progress hover translation. Actual changes to language, provider chain, prompts, terms and selectors invalidate old translations; style, display mode and interaction settings update in place where appropriate.

Options and the userscript panel share `ui/forms/index.js: mountSettingsForm`. The panel retains the `mountForm` seam and calls `destroy()` when closed, including a close that races asynchronous mounting. The userscript provides `promptSecret(label)`, using the native prompt binding captured in its isolated DOM sandbox before asynchronous boot. API keys and backup passphrases never have page-DOM input fields; the form shows only key presence and set/clear buttons. Prompt defaults are empty, cancellation preserves drafts, and Save persists changes. Extension options retain ordinary password fields on their own extension origin; the extension platform's prompt method returns null.

QR export is an optional `platform.renderQr(canvas, text)` capability supplied only by extension options. Shared forms fall back to copyable encrypted text, so neither the QR encoder nor desktop PDF/side-panel entry modules enter the userscript startup bundle. The common text/subtitle tabs remain in the mobile bundle; its 400000-byte limit is unchanged. Subtitle preferences belong to the shared nonsecret schema and survive compact/full configuration imports.

Closed shadow roots and bullet rendering do not isolate composed keyboard, input or paste events from a hostile page. The former Proxy input adapter has been removed. An isolated-world regression loads the unchanged bundle after poisoning the host page's prompt and installing document event listeners; native dialog entry must still save the key without reaching those hooks. Actual Tampermonkey sandbox behavior still needs real-device acceptance.

On coarse-pointer devices hover becomes a cancellable 500 ms paragraph hold. Runtime limits cap batches at 12 items, concurrency at 2 and lazy margin at 400 px without changing saved values. Selection controls appear below the selected text; the draggable floating ball also offers translation of the last focused input. Narrow settings panels use the full viewport and safe-area padding. Synthetic Chromium touch checks are distinct from real Android Edge/Tampermonkey acceptance.

## Providers

1. **Direct OpenAI-compatible profile**: configured by the user, supports non-streaming plain-text chat completions. Presets include OpenRouter, DeepSeek, SiliconFlow, Zhipu, Moonshot, OpenAI, Gemini, Groq, SJTU and Ollama/custom endpoints. OpenRouter is the recommended first example: explicit model discovery filters zero input/output pricing and proposes a diverse free-model chain. An unconfigured profile cannot translate.
2. **Mock**: offline deterministic prefix, used for tests and interaction demos.
3. **Optional local gateway**: Python standard library, http://127.0.0.1:18790/v1. Default enabled backend is Ollama; other integrations require explicit config. Direct remote services work on every supported device without this service.

`provider.chain = [{ profileId, model }, …]` can span profiles and endpoints. Cooldown is scoped to profile plus model. 429/502/503/network failures immediately try the next non-cooling candidate; a busy provider merely queues work. Actual fallback identity participates in cache keys. Subscription CLI models remain explicit-only. Free-model fallback cannot bypass an account's daily/minute quotas or guarantee availability.

Optional config is ~/.duallens/gateway.json, merged over defaults. The [example](../gateway/gateway.example.json) contains no credentials. Backend model lists are explicit allowlists. For custom Ollama models, change ollama.models and choose the corresponding ollama/<model> identifier in extension settings.

## Optional integrations

- **SJTU** adapts an already configured DDL Hub relay at 127.0.0.1:18765. It checks /ledger before background calls and reads proxy_token from the existing ~/.ddl-hub/config.json in memory. DDL Hub and credentials are not part of this release. Leave the backend disabled if that service does not exist.
- **Hermes** adapts an existing independent hermes proxy at 127.0.0.1:8645. The model allowlist must remain limited to the free models you intend to use. Authentication belongs to Hermes. No chat-agent configuration or messages are changed.
- **Claude/Codex** are opt-in Windows npm CLI adapters using existing official login state. The gateway does not create accounts, API keys or OAuth state. Model/account limits remain provider-controlled; daily_limit=0 means no additional gateway cap. Translation child processes use stdin and temporary empty directories, have tools disabled, and receive no API-key billing environment variables.

To enable a backend, set its enabled field to true in machine-local config and restart your gateway. Use settings to choose its model explicitly; optional fallback models should be added intentionally. Configuration never belongs in this repository.

## Release identity and state

The manifest contains a public key used only to make the unpacked extension ID stable. The gateway derives its default Origin allowlist from that public key. A complete source/runtime bundle includes extension/ alongside gateway/ so this identity can be read. For the store build, add the store-assigned extension ID to the explicit allowlist on each machine; only exact `chrome-extension://<id>` entries are accepted. No private signing key is distributed.

Gateway usage, metadata and config live under ~/.duallens. Browser settings/cache live in the current browser profile. Development dependencies, test profiles and raw artifacts stay outside the source tree. GitHub contains reproducible source and tagged release assets, not machine state.
