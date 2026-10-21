import { t as l10n } from '../shared/i18n.js';
// Content entry point: wires the page translator and the interaction modules together and
// answers messages from the background and the popup.

import {
  siteRuleFor,
  settingsForSite, setSitePageRule,
} from '../shared/settings.js';
import { RouteWatcher } from './observer.js';
import * as P from '../shared/protocol.js';
import { normalizeLang } from '../shared/lang.js';
import { performanceSettings, settingsEqual } from '../platform/settings-store.js';
import { PageTranslator } from './controller.js';
import { SelectionUI } from './selection.js';
import { InputBox } from './inputbox.js';
import { HoverTranslate } from './hover.js';
import { FloatBall } from './floatball.js';
import { ComicTranslator } from './comics/controller.js';
import { VideoSubtitles } from './subtitles/controller.js';
import { subtitleOptions } from './subtitles/track.js';
import { clearToast } from './overlay.js';
import { withSendConfirmation } from './confirmation.js';
import { loadDeviceState } from '../shared/device-state.js';


class App {
  constructor(settings, platform) {
    this.platform = platform;
    this.store = platform.settingsStore;
    this.settings = settings;
    this.dormant = false;
    this.getSettings = () => {
      if (this.ruleSettings !== this.settings || this.ruleUrl !== location.href) {
        this.ruleSettings = this.settings; this.ruleUrl = location.href;
        this.effectiveSettings = settingsForSite(this.settings, location.href);
      }
      return this.effectiveSettings;
    };
    this.platform = platform = withSendConfirmation(platform, this.getSettings);
    platform.onDestinationConfirmed = () => this.#pushFrames();
    this.comics = new ComicTranslator({ platform, getSettings: this.getSettings });
    this.subtitles = new VideoSubtitles({ platform, getSettings: this.getSettings });

    this.translator = new PageTranslator({
      platform,
      getSettings: this.getSettings,
      onChange: () => this.ball?.update(),
      onActiveChange: () => this.#pushFrames(),
    });
    this.selection = new SelectionUI({ platform, getSettings: this.getSettings });
    this.input = new InputBox({ platform, getSettings: this.getSettings });
    this.hover = new HoverTranslate({ platform, getSettings: this.getSettings, controller: this.translator });
    this.ball = new FloatBall({
      platform,
      getSettings: this.getSettings,
      ctx: {
        toggle: () => this.#command(P.COMMANDS.TOGGLE_PAGE),
        getState: () => ({...this.translator.getState(),translated:this.translator.isActive() || this.comics.panels.size>0 || this.subtitles.enabled}),
        siteMode: () => siteRuleFor(this.settings, location.href).mode,
        setSiteMode: (mode) => this.#setSiteMode(mode),
        saveSettings: (patch) => this.store.save(patch),
        translateInput: () => this.input.translateFocused(true),
        translateComics: () => this.#command('translate-comics'),
        restoreComics: () => this.#command('restore-comics'),
        openOptions: () => platform.openSettings(),
      },
    });
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  start() {
    this.rulesRoute = new RouteWatcher(() => {
      if (siteRuleFor(this.settings, location.href).mode === 'never') this.#sleep();
      this.#wake(true);
    });
    this.rulesRoute.start();
    this.removeMessage = this.platform.onMessage?.((msg, reply) => this.#onMessage(msg, reply));
    let revision = 0;
    this.removeSettings = this.store.onChange(() => {
      // v2 onChange is an invalidation signal, not a settings snapshot. Ignore stale loads.
      const token = ++revision;
      this.store.load().then((next) => {
        if (token === revision) {this.#applySettings(performanceSettings(next, this.platform.coarse));this.#pushFrames();}
      }).catch(() => {});
    });
    for (const name of Object.values(P.COMMANDS)) this.platform.registerCommand(name, {
      'toggle-page': l10n('m56'), 'toggle-translation-only': l10n('m57'),
      'translate-input': l10n('m4o'), 'toggle-hover': l10n('m58'),
    }[name] || name, () => this.#command(name));
    this.platform.registerCommand('translate-comics', l10n('m59'), () => this.#command('translate-comics'));
    this.platform.registerCommand('restore-comics', l10n('m5a'), () => this.#command('restore-comics'));
    this.platform.registerCommand('open-sidepanel', l10n('m5b'), () => this.platform.openTextTranslation());
    this.platform.registerCommand('toggle-subtitles', l10n('m5c'), () => this.#command('toggle-subtitles'));
    this.#wake(true);
    this.#pushFrames();
  }

  async #frameState() {
    const signal=this.translator.activation?.signal;
    if(this.translator.isActive() && !await this.platform.confirmSend({purpose:'page'},signal) && !signal?.aborted)this.translator.stop();
    const {acked} = await loadDeviceState(this.platform.localArea);
    return {active:this.translator.isActive(),settings:this.settings,confirmedDestinations:acked,
      context:{host:location.hostname,url:location.href,title:document.title}};
  }

  #pushFrames() {
    if(!this.platform.pushFrameState || this.pushing)return;
    this.pushing=true;
    queueMicrotask(async()=>{this.pushing=false;const version=this.frameRevision=(this.frameRevision||0)+1;
      const state=await this.#frameState();if(version===this.frameRevision)void this.platform.pushFrameState(state);});
  }

  // Attach every interaction module. `initial` runs the auto-translate decision as well.
  #wake(initial) {
    this.dormant = siteRuleFor(this.settings, location.href).mode === 'never';
    const effective = this.getSettings();
    for (const key of ['selection', 'input', 'hover']) this[key][effective[key].enabled ? 'enable' : 'disable']();
    if (effective.floatBall.enabled) { this.ball.enable(); this.ball.refresh(); }
    else this.ball.disable();
    if (subtitleOptions(this.settings).enabled) this.subtitles.enable();
    if (initial) this.#autoStart();
  }

  // "Never" blocks automatic page work; explicit translation remains available.
  #sleep() {
    this.dormant = true;
    this.translator.stop();
    this.ball.disable();
    clearToast();
  }

  async #autoStart() {
    const s = this.settings;
    const url = location.href, mode = siteRuleFor(s, url).mode;
    if (mode === 'never') return;
    if (mode === 'always') {
      if (!this.translator.isActive()) this.translator.start();
      return;
    }
    if (!s.autoTranslateLangs.length) return;
    const lang = await this.#pageLanguage();
    if (!lang || location.href !== url || this.settings !== s || this.dormant || this.translator.isActive()) return;
    const hit = this.settings.autoTranslateLangs.some((l) => normalizeLang(l) === lang);
    const isTarget = lang === normalizeLang(this.settings.targetLang);
    if (hit && !isTarget) this.translator.start();
  }

  async #pageLanguage() {
    const sample = (document.body ? document.body.innerText : '').slice(0, 2000);
    const det = await this.platform.detectLanguage(sample);
    const top = det && det.reliable && det.lang;
    if (top) return normalizeLang(top);
    const attr = document.documentElement.lang;
    return attr ? normalizeLang(attr) : '';
  }

  // ---- settings ----------------------------------------------------------------------------

  #applySettings(next) {
    if(next.comics?.enabled===false) this.comics.restore();
    const prev = this.settings;
    this.settings = next;
    const mode = siteRuleFor(next, location.href).mode;
    if (mode === 'never' && !this.dormant) this.#sleep();
    this.#wake(false);
    this.subtitles.update(prev, next);
    if (mode !== siteRuleFor(prev, location.href).mode) this.#autoStart();
    const t = this.translator;
    if (prev.displayMode !== next.displayMode) t.setDisplayMode(next.displayMode);
    const customChanged = !settingsEqual(prev.siteRules.custom, next.siteRules.custom);
    if (prev.style !== next.style || customChanged) t.setStyle(t.style);
    if (
      prev.targetLang !== next.targetLang ||
      prev.sourceLang !== next.sourceLang ||
      prev.minChars !== next.minChars ||
      prev.translateShortText !== next.translateShortText ||
      customChanged ||
      !settingsEqual(prev.translation, next.translation) ||
      !settingsEqual(prev.provider, next.provider) ||
      !settingsEqual(prev.prompt, next.prompt) ||
      !settingsEqual(prev.glossary, next.glossary)
    ) {
      t.retranslate();
    }
    if (prev.lazy.rootMarginPx !== next.lazy.rootMarginPx) t.setMargin(next.lazy.rootMarginPx);
  }

  async #setSiteMode(mode) {
    await this.store.save({ siteRules: setSitePageRule(await this.store.load(), location.hostname, mode) });
  }

  // ---- messages ----------------------------------------------------------------------------

  state() {
    const sel = this.selection.state();
    return {
      ...this.translator.getState(),
      dormant: this.dormant,
      comics: this.comics.state(),
      subtitles: this.subtitles.state(),
      ui: {
        selectionIcon: sel.selectionIcon,
        selectionCard: sel.selectionCard,
        floatBall: this.ball.visible(),
        hoverActive: this.hover.isActive(),
      },
    };
  }

  pageMessage(msg) {
    return new Promise(resolve => { if (!this.#onMessage(msg, resolve)) resolve(null); });
  }

  #onMessage(msg, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case 'frame-top-state':
        this.#frameState().then(sendResponse);
        return true;
      case P.MSG_GET_STATE:
        sendResponse(this.state());
        return false;
      case P.MSG_COMMAND:
        this.#command(msg.name);
        sendResponse({ ok: true, dormant: this.dormant });
        return false;
      case P.MSG_TRANSLATE_SELECTION:
        this.selection.openCard(msg.text, this.#selectionRect());
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  }

  #selectionRect() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const rects = sel.getRangeAt(0).getClientRects();
    const r = rects.length ? rects[rects.length - 1] : null;
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
  }

  #command(name) {
    const s = this.getSettings();
    switch (name) {
      case 'toggle-subtitles':
        this.store.save({ subtitles: { enabled: !subtitleOptions(s).enabled } });
        break;
      case 'restore-subtitles':
        this.subtitles.disable();
        this.store.save({ subtitles: { enabled: false } });
        break;
      case 'open-sidepanel':
        this.platform.openTextTranslation();
        break;
      case 'translate-comics':
        this.comics.start();
        break;
      case 'restore-comics':
        this.comics.restore();
        break;
      case P.COMMANDS.TOGGLE_PAGE:
        if (this.subtitles.enabled) {
          this.subtitles.disable();
          this.store.save({ subtitles: { enabled: false } });
          if (!this.translator.isActive()) break;
        }
        if (this.comics.panels.size && !this.translator.isActive()) { this.comics.restore(); break; }
        this.comics.restore();
        this.translator.toggle();
        break;
      case P.COMMANDS.TOGGLE_TRANSLATION_ONLY:
        this.store.save({ displayMode: s.displayMode === 'translation-only' ? 'bilingual' : 'translation-only' });
        break;
      case P.COMMANDS.TRANSLATE_INPUT:
        this.input.translateFocused();
        break;
      case P.COMMANDS.TOGGLE_HOVER:
        this.store.save({ hover: { enabled: !s.hover.enabled } });
        break;
      default:
        break;
    }
  }
}

// One app per platform instance; repeated extension-loader injection reuses module state.
let ready = null;
export function start(platform) {
  if (ready) return ready;
  if (!platform.valid?.() && platform.valid) return Promise.resolve(null);
  ready = (async () => {
    await platform.ready;
    const app = new App(performanceSettings(await platform.settingsStore.load(), platform.coarse), platform);
    app.start();
    return app;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}
