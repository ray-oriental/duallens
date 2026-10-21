# Security and privacy

Report vulnerabilities privately through this repository's GitHub Security Advisories / Report a vulnerability page. Never include API keys, cookies, private source text or browser profiles in public issues.

DualLens has no account backend, telemetry or remote configuration. Translation requests go directly to user-selected services. The background enforces device-local destination confirmation before translation requests; loopback models and mock providers are exempt. Official keyed machine-translation engines never fall back to free unofficial endpoints. Settings-page connection tests send only synthetic text after a deliberate user action.

API keys are stored unencrypted in device-local browser or userscript-manager storage. They are never synced or included in plaintext exports. Encrypted backups can contain keys and require a passphrase of at least eight characters. Protect the operating-system account and browser profile.

Model output becomes text nodes or validated safe clones, never executable markup. Restore must preserve original webpage state. Access to pages is temporary through activeTab unless the user grants optional host access for a persistent feature. Cross-origin frame agents rely on the top frame's confirmed destinations.

PDF rendering and image OCR run locally. All extension code and WebAssembly are packaged; OCR language data is pinned and verified by size and SHA-256. The separately distributed userscript uses manager-cached, integrity-checked resources. Translation caches are device-local and disabled for incognito requests.

CI uses mock providers and synthetic fixtures without accounts, paid models or deployment credentials. See [Privacy](docs/PRIVACY.md) for storage, retention and external request details.
