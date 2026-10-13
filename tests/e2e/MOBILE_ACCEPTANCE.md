# Userscript and Android acceptance

The userscript is the Android Edge + Tampermonkey target. Android Chrome bookmarklets
remain P1; these changes do not implement them. Automated Chromium device emulation is
not evidence of a real Android Edge installation, keyboard, browser menu or userscript-manager sandbox.

## Offline automated checks

Use the Python and Playwright browser environment described in README.md. Build the actual artifact first:

```powershell
node scripts/build_userscript.mjs
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/e2e/run_userscript_e2e.py
```

This runs without loading an extension. A GM stub and test-only closed-shadow instrumentation
are injected with `add_init_script`, followed by the unchanged release artifact. Desktop cases cover
translation/restore/only mode, dynamic append/SPA, selection, settings and GM HTTP/secret separation.
375×812 and 800×1280 touch contexts cover actual CDP touch holds and drag, movement cancellation,
selection placement, input-menu action, settings and scrolling all 220 long-fixture paragraphs to the final bottom.
`PerformanceObserver` reports the number of tasks exceeding 50 ms, maximum duration and the fraction
of the observed interval outside long tasks. It cannot count every task below 50 ms or guarantee performance
on arbitrary sites. Profiles and JSON evidence are under `~/.cache/duallens-e2e`, not in source.

Use `run_e2e.py --mock-only` for source-extension acceptance. The source manifest already lists
`platform/*.js`; the historical `run_platform_extension_e2e.py` staging preview is no longer needed.
`run_settings_browser.py` separately validates the v2 wizard, backups and popup. The userscript suite
also creates an OpenRouter preset with a fake key through the shared form and checks GM-only secrets.

## User-run Android Edge + Tampermonkey checklist

1. On both phone and tablet, record Android/Edge/Tampermonkey versions. Install the reviewed
   `duallens.user.js` artifact in Tampermonkey. Confirm it runs only in the top-level document.
2. Start with the mock profile if provisioned by the shared form. Open a public English page;
   tap the floating ball, switch to only mode, then restore. Confirm the original links and layout remain.
3. Hold a plain paragraph for 500 ms. Confirm only that paragraph translates; tap/short hold,
   scroll, and two-finger gestures must not translate. Disable hover/long-press and confirm the hold stops working.
4. Select text. Confirm the translation icon sits below the selection and is easy to tap without
   fighting Edge's native selection handles/menu. Translate and close the card.
5. Drag the ball to both edges and near the top/bottom. Rotate the device, show/hide the address
   bar and keyboard, and reload. Confirm controls remain reachable and clear of cutouts/gesture areas.
6. Focus a textarea, enter text, open the ball menu and choose “翻译当前输入框”. Confirm the
   focused field is translated. Password fields must remain untouched; editing during a request must cancel replacement.
7. Open settings from the ball and Tampermonkey menu. On the phone it should fill the viewport;
   target/address/model/save/test controls must remain usable with the keyboard open. Close/reopen;
   any previously saved key must never be backfilled. Use paste or ordinary ASCII typing in the private
   key editor attached to the shared form; autofill/composition is deliberately discarded. Confirm new input
   shows only bullets, Save clears it, and a connection test after reopening still uses the saved key.
8. Confirm changes survive reload and propagate to another tab. Visit a long public page and scroll
   from top to the actual bottom; confirm new content is translated without repeated insertion or visible stalls.
9. Only after separately authorizing a real provider test, configure your own service and test it.
   Do not put credentials in screenshots, reports, page storage or test fixtures. Verify manager-level
   isolated-world grants and cross-origin GM requests on the installed Tampermonkey version.

Windows Chrome/Edge and the second computer also need real-browser installation checks by leader/user.
The automated extension tests use matching Chromium, synthetic pages and mock providers only.
