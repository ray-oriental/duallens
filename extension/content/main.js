// Content entry point: wires the page translator and the interaction modules together and
// answers messages from the background and the popup.

import {
  loadSettings,
  saveSettings,
  mergeSettings,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  siteRuleFor,
} from '../shared/settings.js';
import * as P from '../shared/protocol.js';
import { normalizeLang } from '../shared/lang.js';
import { PageTranslator } from './controller.js';
import { SelectionUI } from './selection.js';
import { InputBox } from './inputbox.js';
import { HoverTranslate } from './hover.js';
import { FloatBall } from './floatball.js';
import { toast, clearToast } from './overlay.js';
import { contextValid, detectLanguage } from './util.js';

const HOST = location.hostname;
const MSG_OPEN_OPTIONS = P.MSG_OPEN_OPTIONS || 'open-options';

class App {
  constructor(settings) {
    this.settings = settings;
    this.dormant = false;
    this.getSettings = () => this.settings;

    this.translator = new PageTranslator({
      getSettings: this.getSettings,
      onChange: () => this.ball?.update(),
    });
    this.selection = new SelectionUI({ getSettings: this.getSettings });
    this.input = new InputBox({ getSettings: this.getSettings });
    this.hover = new HoverTranslate({ getSettings: this.getSettings, controller: this.translator });
    this.ball = new FloatBall({
      getSettings: this.getSettings,
      ctx: {
        toggle: () => this.translator.toggle(),
        getState: () => this.translator.getState(),
        siteMode: () => siteRuleFor(this.settings, HOST).mode,
        setSiteMode: (mode) => this.#setSiteMode(mode),
        saveSettings: (patch) => saveSettings(patch),
        openOptions: () => chrome.runtime.sendMessage({ type: MSG_OPEN_OPTIONS }).catch(() => {}),
      },
    });
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  start() {
    this.dormant = siteRuleFor(this.settings, HOST).mode === 'never';
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => this.#onMessage(msg, sendResponse));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      this.#applySettings(mergeSettings(DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {}));
    });
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
    const det = await detectLanguage(sample);
    const top = det && det.isReliable && det.languages && det.languages[0];
    if (top) return normalizeLang(top.language);
    const attr = document.documentElement.lang;
    return attr ? normalizeLang(attr) : '';
  }

  // ---- settings ----------------------------------------------------------------------------

  #applySettings(next) {
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
    const customChanged = JSON.stringify(prev.siteRules.custom) !== JSON.stringify(next.siteRules.custom);
    if (prev.style !== next.style || customChanged) t.setStyle(t.style);
    if (
      prev.targetLang !== next.targetLang ||
      prev.sourceLang !== next.sourceLang ||
      prev.minChars !== next.minChars ||
      customChanged ||
      JSON.stringify(prev.provider) !== JSON.stringify(next.provider) ||
      JSON.stringify(prev.prompt) !== JSON.stringify(next.prompt) ||
      JSON.stringify(prev.glossary) !== JSON.stringify(next.glossary)
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
    const cur = await loadSettings();
    const strip = (list) => list.filter((p) => String(p).trim().toLowerCase() !== host);
    const always = strip(cur.siteRules.always);
    const never = strip(cur.siteRules.never);
    if (mode === 'always') always.push(host);
    if (mode === 'never') never.push(host);
    await saveSettings({ siteRules: { always, never } });
    const left = siteRuleFor({ siteRules: { always, never, custom: [] } }, host).mode;
    if (mode === null && left) toast(`本站仍被通配规则命中（${left === 'never' ? '从不' : '总是'}翻译），请到设置页修改`, 'error', 4500);
  }

  // ---- messages ----------------------------------------------------------------------------

  state() {
    const sel = this.selection.state();
    return {
      ...this.translator.getState(),
      dormant: this.dormant,
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
      case P.COMMANDS.TOGGLE_PAGE:
        this.translator.toggle();
        break;
      case P.COMMANDS.TOGGLE_TRANSLATION_ONLY:
        saveSettings({ displayMode: s.displayMode === 'translation-only' ? 'bilingual' : 'translation-only' });
        break;
      case P.COMMANDS.TRANSLATE_INPUT:
        if (s.input.enabled) this.input.translateFocused();
        break;
      case P.COMMANDS.TOGGLE_HOVER:
        saveSettings({ hover: { enabled: !s.hover.enabled } });
        break;
      default:
        break;
    }
  }
}

async function boot() {
  if (!contextValid()) return null;
  const app = new App(await loadSettings());
  app.start();
  return app;
}

export const ready = boot();
