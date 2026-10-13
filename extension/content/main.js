// Content entry point: wires the page translator and the interaction modules together and
// answers messages from the background and the popup.

import {
  siteRuleFor,
} from '../shared/settings.js';
import * as P from '../shared/protocol.js';
import { normalizeLang } from '../shared/lang.js';
import { performanceSettings, settingsEqual } from '../platform/settings-store.js';
import { PageTranslator } from './controller.js';
import { SelectionUI } from './selection.js';
import { InputBox } from './inputbox.js';
import { HoverTranslate } from './hover.js';
import { FloatBall } from './floatball.js';
import { ComicTranslator } from './comics/controller.js';
import { toast, clearToast } from './overlay.js';


const HOST = location.hostname;


class App {
  constructor(settings, platform) {
    this.platform = platform;
    this.store = platform.settingsStore;
    this.settings = settings;
    this.dormant = false;
    this.getSettings = () => this.settings;
    this.comics = new ComicTranslator({ platform, getSettings: this.getSettings });

    this.translator = new PageTranslator({
      platform,
      getSettings: this.getSettings,
      onChange: () => this.ball?.update(),
    });
    this.selection = new SelectionUI({ platform, getSettings: this.getSettings });
    this.input = new InputBox({ platform, getSettings: this.getSettings });
    this.hover = new HoverTranslate({ platform, getSettings: this.getSettings, controller: this.translator });
    this.ball = new FloatBall({
      platform,
      getSettings: this.getSettings,
      ctx: {
        toggle: () => this.translator.toggle(),
        getState: () => this.translator.getState(),
        siteMode: () => siteRuleFor(this.settings, HOST).mode,
        setSiteMode: (mode) => this.#setSiteMode(mode),
        saveSettings: (patch) => this.store.save(patch),
        translateInput: () => this.input.translateFocused(true),
        translateComics: () => this.comics.start(),
        restoreComics: () => this.comics.restore(),
        openOptions: () => platform.openSettings(),
      },
    });
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  start() {
    this.dormant = siteRuleFor(this.settings, HOST).mode === 'never';
    this.removeMessage = this.platform.onMessage?.((msg, reply) => this.#onMessage(msg, reply));
    let revision = 0;
    this.removeSettings = this.store.onChange(() => {
      // v2 onChange is an invalidation signal, not a settings snapshot. Ignore stale loads.
      const token = ++revision;
      this.store.load().then((next) => {
        if (token === revision) this.#applySettings(performanceSettings(next, this.platform.coarse));
      }).catch(() => {});
    });
    for (const name of Object.values(P.COMMANDS)) this.platform.registerCommand(name, {
      'toggle-page': '翻译 / 恢复当前页面', 'toggle-translation-only': '切换双语 / 仅译文',
      'translate-input': '翻译当前输入框', 'toggle-hover': '开关悬停 / 长按翻译',
    }[name] || name, () => this.#command(name));
    this.platform.registerCommand('translate-comics', '翻译此页漫画', () => this.#command('translate-comics'));
    this.platform.registerCommand('restore-comics', '恢复漫画原文', () => this.#command('restore-comics'));
    if (!this.dormant) this.#wake(true);
  }

  // Attach every interaction module. `initial` runs the auto-translate decision as well.
  #wake(initial) {
    this.dormant = false;
    this.selection.enable();
    this.input.enable();
    this.hover.enable();
    if (this.settings.floatBall.enabled) this.ball.enable();
    if (initial) this.#autoStart();
  }

  // "Never translate here": restore the page and remove every trace of the UI.
  #sleep() {
    this.dormant = true;
    this.translator.stop();
    this.comics.restore();
    this.selection.disable();
    this.input.disable();
    this.hover.disable();
    this.ball.disable();
    clearToast();
  }

  async #autoStart() {
    const s = this.settings;
    if (siteRuleFor(s, HOST).mode === 'always') {
      this.translator.start();
      return;
    }
    if (!s.autoTranslateLangs.length) return;
    const lang = await this.#pageLanguage();
    if (!lang || this.dormant || this.translator.isActive()) return;
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
    const mode = siteRuleFor(next, HOST).mode;
    if (mode === 'never') {
      if (!this.dormant) this.#sleep();
      return;
    }
    if (this.dormant) {
      this.#wake(true);
      return;
    }
    if (mode === 'always' && siteRuleFor(prev, HOST).mode !== 'always') this.translator.start();
    const t = this.translator;
    if (prev.displayMode !== next.displayMode) t.setDisplayMode(next.displayMode);
    const customChanged = !settingsEqual(prev.siteRules.custom, next.siteRules.custom);
    if (prev.style !== next.style || customChanged) t.setStyle(t.style);
    if (
      prev.targetLang !== next.targetLang ||
      prev.sourceLang !== next.sourceLang ||
      prev.minChars !== next.minChars ||
      customChanged ||
      !settingsEqual(prev.provider, next.provider) ||
      !settingsEqual(prev.prompt, next.prompt) ||
      !settingsEqual(prev.glossary, next.glossary)
    ) {
      t.retranslate();
    }
    if (prev.lazy.rootMarginPx !== next.lazy.rootMarginPx) t.setMargin(next.lazy.rootMarginPx);
    if (next.floatBall.enabled) {
      if (!this.ball.on) this.ball.enable();
      else this.ball.refresh();
    } else {
      this.ball.disable();
    }
  }

  async #setSiteMode(mode) {
    const host = HOST.toLowerCase();
    const cur = await this.store.load();
    const strip = (list) => list.filter((p) => String(p).trim().toLowerCase() !== host);
    const always = strip(cur.siteRules.always);
    const never = strip(cur.siteRules.never);
    if (mode === 'always') always.push(host);
    if (mode === 'never') never.push(host);
    await this.store.save({ siteRules: { always, never } });
    const left = siteRuleFor({ siteRules: { always, never, custom: [] } }, host).mode;
    if (mode === null && left) toast(`本站仍被通配规则命中（${left === 'never' ? '从不' : '总是'}翻译），请到设置页修改`, 'error', 4500);
  }

  // ---- messages ----------------------------------------------------------------------------

  state() {
    const sel = this.selection.state();
    return {
      ...this.translator.getState(),
      dormant: this.dormant,
      comics: this.comics.state(),
      ui: {
        selectionIcon: sel.selectionIcon,
        selectionCard: sel.selectionCard,
        floatBall: this.ball.visible(),
        hoverActive: !this.dormant && this.hover.isActive(),
      },
    };
  }

  #onMessage(msg, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case P.MSG_GET_STATE:
        sendResponse(this.state());
        return false;
      case P.MSG_COMMAND:
        this.#command(msg.name);
        sendResponse({ ok: !this.dormant, dormant: this.dormant });
        return false;
      case P.MSG_TRANSLATE_SELECTION:
        if (!this.dormant) this.selection.openCard(msg.text, this.#selectionRect());
        sendResponse({ ok: !this.dormant });
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
    if (this.dormant) return;
    const s = this.settings;
    switch (name) {
      case 'translate-comics':
        this.comics.start();
        break;
      case 'restore-comics':
        this.comics.restore();
        break;
      case P.COMMANDS.TOGGLE_PAGE:
        if (this.comics.panels.size && !this.translator.isActive()) { this.comics.restore(); break; }
        this.comics.restore();
        this.translator.toggle();
        break;
      case P.COMMANDS.TOGGLE_TRANSLATION_ONLY:
        this.store.save({ displayMode: s.displayMode === 'translation-only' ? 'bilingual' : 'translation-only' });
        break;
      case P.COMMANDS.TRANSLATE_INPUT:
        if (s.input.enabled) this.input.translateFocused();
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
