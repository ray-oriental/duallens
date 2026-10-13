# Security and privacy

Report suspected vulnerabilities privately using this repository's GitHub Security Advisories / Report a vulnerability page. Do not include API keys, cookies, OAuth files, private webpage text or a full browser profile in an issue or PR.

## Data flow

The extension sends extracted text to the provider selected in settings. The gateway forwards to an explicitly enabled local service or official subscription CLI. The selected remote provider may receive webpage text. There is no telemetry, account backend or remote configuration service in DualLens.

User-entered API keys remain in chrome.storage.local and are excluded from settings exports. They are not encrypted storage; protect your browser profile. The gateway does not copy CLI or campus credentials and logs only request metadata.

## Boundaries

- The gateway binds only to 127.0.0.1, validates Host, and defaults to a single allowed DualLens extension Origin.
- It accepts bounded, non-streaming plain-text requests. Non-loopback upstream URLs are refused.
- Translation output is inserted as text and validated original-element clones, never innerHTML.
- Optional subscription CLIs use empty temporary working directories, no project instructions and disabled tools. Only enable them for accounts you are authorized to use.
- No local backend or subscription is selected automatically on a fresh extension installation.
- CI uses mock providers and synthetic fixtures; no deployment credentials are required.

The extension necessarily requests webpage access to translate arbitrary pages. First-release support is limited to top frames. Cloned inline images may repeat original resource requests. Do not upload private failure screenshots or runtime files to public issues.
