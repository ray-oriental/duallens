# Architecture and provider setup

## Translation pipeline

A classic content loader imports native modules. The walker finds visible paragraph units and serializes inline formatting as bounded placeholders. IntersectionObserver schedules nearby units; MutationObserver and navigation events handle updates. The background service worker batches text, builds Chinese translation prompts, validates JSON arrays, manages model cooldown/fallback and caches results in IndexedDB. The injector restores only validated original formatting and safely inserts text.

The interface contract is in [SPEC.md](SPEC.md). [ROADMAP.md](ROADMAP.md) separates implemented features from planned work.

## Providers

1. **Direct OpenAI-compatible profile**: configured by the user, supports non-streaming plain-text chat completions. An unconfigured profile cannot translate.
2. **Mock**: offline deterministic prefix, used for tests and interaction demos.
3. **Local gateway**: Python standard library, http://127.0.0.1:18790/v1. Default enabled backend is Ollama; other integrations require explicit config.

Optional config is ~/.duallens/gateway.json, merged over defaults. The [example](../gateway/gateway.example.json) contains no credentials. Backend model lists are explicit allowlists. For custom Ollama models, change ollama.models and choose the corresponding ollama/<model> identifier in extension settings.

## Optional integrations

- **SJTU** adapts an already configured DDL Hub relay at 127.0.0.1:18765. It checks /ledger before background calls and reads proxy_token from the existing ~/.ddl-hub/config.json in memory. DDL Hub and credentials are not part of this release. Leave the backend disabled if that service does not exist.
- **Hermes** adapts an existing independent hermes proxy at 127.0.0.1:8645. The model allowlist must remain limited to the free models you intend to use. Authentication belongs to Hermes. No chat-agent configuration or messages are changed.
- **Claude/Codex** are opt-in Windows npm CLI adapters using existing official login state. The gateway does not create accounts, API keys or OAuth state. Model/account limits remain provider-controlled; daily_limit=0 means no additional gateway cap. Translation child processes use stdin and temporary empty directories, have tools disabled, and receive no API-key billing environment variables.

To enable a backend, set its enabled field to true in machine-local config and restart your gateway. Use settings to choose its model explicitly; optional fallback models should be added intentionally. Configuration never belongs in this repository.

## Release identity and state

The manifest contains a public key used only to make the unpacked extension ID stable. The gateway derives its default Origin allowlist from that public key. A complete source/runtime bundle includes extension/ alongside gateway/ so this identity can be read. For the store build, add the store-assigned extension ID to the explicit allowlist on each machine; only exact `chrome-extension://<id>` entries are accepted. No private signing key is distributed.

Gateway usage, metadata and config live under ~/.duallens. Browser settings/cache live in the current browser profile. Development dependencies, test profiles and raw artifacts stay outside the source tree. GitHub contains reproducible source and tagged release assets, not machine state.
