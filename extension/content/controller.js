// Page translation controller: owns the unit table and ties walker, serializer, injector, client
// and watchers together. One instance per page.

import { siteRuleFor } from '../shared/settings.js';
import { PRIORITY, ERR } from '../shared/protocol.js';
import { parseMarkup } from '../shared/markup.js';
import { looksLikeTarget, normalizeLang, sameLanguage } from '../shared/lang.js';
import { collectRuns, iterateRuns, runsOf, blockContainerOf } from './walker.js';
import { serializeRun, isTranslatable, buildFragment, textFragment } from './serialize.js';
import * as inj from './injector.js';
import { TranslateClient } from './client.js';
import { IdleSlices } from './idle.js';
import { LazyObserver, MutationWatcher, RouteWatcher } from './observer.js';
import { joinSelectors, debounce } from './util.js';

const MAX_REQUEST_ITEMS = 50;
const CHURN_LIMIT = 12; // re-translations of one host within a minute before we leave it alone

export class PageTranslator {
  // getSettings(): current merged settings. onChange(): something user-visible changed.
  constructor({ getSettings, onChange, platform }) {
    this.platform = platform;
    this.slices = new IdleSlices();
    this.getSettings = getSettings;
    this.onChange = onChange || (() => {});
    this.units = new Map(); // id -> unit
    this.registry = new WeakMap(); // first node -> unit (dedupe across rescans)
    this.byHost = new Map(); // host -> Set<unit>
    this.churn = new WeakMap(); // host -> { n, t0 }
    this.client = new TranslateClient(platform);
    this.lazy = new LazyObserver((u, pr, top) => this.#enqueue(u, pr, top));
    this.watch = new MutationWatcher((batch) => this.#onMutations(batch));
    this.route = new RouteWatcher(() => this.#onRoute());
    this.active = false;
    this.queue = [];
    this.flushTimer = 0;
    this.seq = 0;
    this.emit = debounce(() => this.onChange(), 60);
    this.onRouteDebounced = debounce(() => { if (this.active) this.retranslate(); }, 400);

    inj.setWriteGuard((fn) => this.watch.guard(fn));
    this.retryHandler = (e) => {
      const r = e.target && e.target.closest ? e.target.closest('dl-r') : null;
      if (!r) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      const t = r.closest('dl-t');
      if (t) this.retry(t.getAttribute('data-dl-id'));
    };
    document.addEventListener('click', this.retryHandler, true);
    document.addEventListener('keydown', this.retryHandler, true);
  }

  // ---- settings-derived values -------------------------------------------------------------

  get s() {
    return this.getSettings();
  }

  get siteCustom() {
    return siteRuleFor(this.s, location.hostname).custom;
  }

  get style() {
    return this.siteCustom?.style || this.s.style;
  }

  #exclude() {
    return joinSelectors(this.siteCustom?.exclude);
  }

  #roots() {
    const include = joinSelectors(this.siteCustom?.include);
    if (include) {
      const all = [...document.querySelectorAll(include)];
      return all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
    }
    return document.body ? [document.body] : [];
  }

  #context() {
    return { title: document.title, host: location.hostname, url: location.href };
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  isActive() {
    return this.active;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.lazy.setMargin(this.s.lazy.rootMarginPx);
    this.watch.start();
    this.route.start();
    for (const root of this.#roots()) this.#scan(root);
    this.emit();
  }

  // Restores the original page completely and stops watching.
  stop() {
    this.active = false;
    this.slices.cancel();
    clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    this.queue.length = 0;
    this.client.cancelAll();
    this.onRouteDebounced.cancel();
    this.watch.stop();
    this.route.stop();
    this.lazy.disconnect();
    inj.write(() => {
      for (const u of this.units.values()) { u.dead = true; inj.restore(u); }
    });
    this.units.clear();
    this.byHost.clear();
    this.registry = new WeakMap();
    this.emit();
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  retranslate() {
    const was = this.active;
    this.stop();
    if (was) this.start();
  }

  setMargin(px) {
    if (this.active) this.lazy.setMargin(px);
  }

  destroy() {
    this.stop();
    this.client.dispose();
    document.removeEventListener('click', this.retryHandler, true);
    document.removeEventListener('keydown', this.retryHandler, true);
  }

  // ---- display settings --------------------------------------------------------------------

  setDisplayMode(mode) {
    inj.write(() => {
      for (const u of this.units.values()) inj.setMode(u, mode);
    });
  }

  setStyle(style) {
    inj.write(() => {
      for (const u of this.units.values()) inj.setStyle(u, style);
    });
  }

  getState() {
    let pending = 0;
    let failed = 0;
    let done = 0;
    let total = 0;
    for (const u of this.units.values()) {
      if (u.state === 'skip') continue;
      total++;
      if (u.state === 'queued' || u.state === 'pending') pending++;
      else if (u.state === 'error') failed++;
      else if (u.state === 'done') done++;
    }
    return { translated: this.active, mode: this.s.displayMode, units: total, pending, failed, done };
  }

  // ---- units -------------------------------------------------------------------------------

  #known = (host, first) => this.registry.has(first);

  #scan(root, shallow = false) {
    const include = joinSelectors(this.siteCustom?.include);
    // inside an include-limited site, an arbitrary added node only counts when it lies in scope
    if (include && !shallow && !root.closest(include) && root !== document.body) {
      for (const m of root.querySelectorAll(include)) this.#scanOne(m, false);
      return;
    }
    this.#scanOne(root, shallow);
  }

  #scanOne(root, shallow) {
    const opts = { minChars: this.s.minChars, exclude: this.#exclude(), known: this.#known, shallow };
    if (this.platform.coarse) {
      this.slices.run(iterateRuns(root, opts), (run) => {
        if (run && this.active && run.host.isConnected && !this.#known(run.host, run.first)) this.#addUnit(run);
      });
    } else {
      for (const run of collectRuns(root, opts)) this.#addUnit(run);
    }
  }

  #addUnit(run, { watch = true } = {}) {
    const unit = {
      id: String(++this.seq),
      host: run.host,
      first: run.first,
      last: run.last,
      whole: run.whole,
      state: 'idle', // idle | queued | pending | done | error | skip
      lang: this.s.targetLang,
      plain: '',
      src: '',
      els: null,
      translated: null,
      priority: PRIORITY.NEAR,
      top: 0,
      tEl: null,
      oEl: null,
      wEl: null,
      hover: false,
      peek: false,
    };
    this.units.set(unit.id, unit);
    this.registry.set(unit.first, unit);
    let set = this.byHost.get(unit.host);
    if (!set) this.byHost.set(unit.host, (set = new Set()));
    set.add(unit);
    if (watch) this.lazy.watch(unit);
    return unit;
  }

  #drop(unit) {
    this.lazy.unwatch(unit);
    this.units.delete(unit.id);
    this.registry.delete(unit.first);
    const set = this.byHost.get(unit.host);
    if (set) {
      set.delete(unit);
      if (!set.size) this.byHost.delete(unit.host);
    }
    unit.dead = true;
    inj.restore(unit);
  }

  // ---- translation pipeline ----------------------------------------------------------------

  #enqueue(unit, priority, top, immediate = false) {
    if (unit.state !== 'idle' || unit.dead) return;
    if (!this.active && !unit.hover) return;
    unit.state = 'queued';
    unit.priority = priority;
    unit.top = top;
    this.queue.push(unit);
    if (immediate) {
      clearTimeout(this.flushTimer);
      this.flushTimer = 0;
      this.#flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.#flush(), this.s.lazy.batchDelayMs);
    }
  }

  async #flush() {
    this.flushTimer = 0;
    const batch = this.queue.splice(0).filter((u) => u.state === 'queued' && !u.dead);
    if (!batch.length) return;
    const s = this.s;
    const exclude = this.#exclude();

    // read phase: no DOM writes until every unit has been measured
    const ready = [];
    for (const u of batch) {
      if (this.platform.coarse) await this.slices.yield();
      if (u.dead || this.units.get(u.id) !== u) continue;
      if (!inj.intact(u)) {
        this.#drop(u);
        continue;
      }
      const r = serializeRun(u.first, u.last, { exclude });
      u.plain = r.plain;
      u.src = r.text;
      u.els = r.els;
      if (!isTranslatable(r.plain, s.minChars)) {
        this.#skip(u);
        continue;
      }
      u.flexHost = /flex|grid/.test(getComputedStyle(u.host).display);
      ready.push(u);
    }

    const skipFlags = await Promise.all(ready.map((u) => this.#alreadyTarget(u.plain, s)));
    const send = [];
    ready.forEach((u, i) => {
      if (u.dead || this.units.get(u.id) !== u || u.state !== 'queued') return;
      if (skipFlags[i]) this.#skip(u);
      else send.push(u);
    });
    if (send.length) {
      inj.write(() => {
        for (const u of send) {
          u.state = 'pending';
          inj.markPending(u);
        }
      });
      this.#dispatch(send);
    }
    this.emit();
  }

  #skip(unit) {
    unit.state = 'skip';
    this.lazy.unwatch(unit);
  }

  async #alreadyTarget(plain, s) {
    if (looksLikeTarget(plain, s.targetLang)) return true;
    if (plain.length < 24) return false;
    const det = await this.platform.detectLanguage(plain.slice(0, 400));
    const top = det && det.reliable && det.lang;
    if (!top) return false;
    const pct = det.percentage ?? 100;
    if (pct >= 70 && sameLanguage(normalizeLang(top), s.targetLang)) return true;
    if (s.sourceLang && s.sourceLang !== 'auto' && pct >= 80 && !sameLanguage(normalizeLang(top), s.sourceLang)) {
      return true;
    }
    return false;
  }

  #dispatch(units) {
    const s = this.s;
    const byPriority = new Map();
    for (const u of units) {
      if (!byPriority.has(u.priority)) byPriority.set(u.priority, []);
      byPriority.get(u.priority).push(u);
    }
    for (const [priority, list] of byPriority) {
      list.sort((a, b) => a.top - b.top);
      for (let i = 0; i < list.length; i += MAX_REQUEST_ITEMS) {
        const chunk = list.slice(i, i + MAX_REQUEST_ITEMS);
        const items = chunk.map((u) => ({ id: u.id, text: u.src }));
        const reqId = this.client.request(
          { items, priority, to: s.targetLang, from: s.sourceLang || 'auto', context: this.#context() },
          { onResults: (results) => this.#onResults(results), onDone: () => this.emit() },
        );
        for (const u of chunk) u.reqId = reqId;
      }
    }
  }

  #onResults(results) {
    const apply = (r) => inj.write(() => {
      const u = this.units.get(r.id);
      if (!u || u.dead || u.state !== 'pending') return;
      if (!inj.intact(u)) { this.#drop(u); return; }
      if (r.error) this.#fail(u, r.error);
      else this.#apply(u, r.text);
    });
    if (this.platform.coarse) this.slices.run(results[Symbol.iterator](), (r) => { apply(r); this.emit(); });
    else { for (const r of results) apply(r); this.emit(); }
  }

  #fail(unit, error) {
    unit.state = 'error';
    unit.error = error;
    inj.markError(unit, error && error.message);
  }

  #apply(unit, text) {
    const parsed = parseMarkup(text, { maxG: unit.els.length, maxX: unit.els.length });
    const fragment = parsed.ok ? buildFragment(parsed.nodes, unit.els) : textFragment(parsed.plain);
    const outPlain = (fragment.textContent || '').replace(/\s+/g, ' ').trim();
    if (!outPlain) {
      this.#fail(unit, { code: ERR.PARSE, message: '译文为空' });
      return;
    }
    unit.translated = text;
    unit.state = 'done';
    if (outPlain.toLowerCase() === unit.plain.replace(/\s+/g, ' ').toLowerCase()) {
      inj.showNothing(unit); // the model returned the source unchanged
      return;
    }
    inj.showTranslation(unit, fragment, {
      mode: this.s.displayMode,
      style: this.style,
      inlineMaxChars: this.s.inlineMaxChars,
    });
  }

  retry(id) {
    const u = this.units.get(id);
    if (!u || u.state !== 'error') return;
    u.state = 'pending';
    u.priority = PRIORITY.VISIBLE;
    inj.markPending(u);
    this.#dispatch([u]);
    this.emit();
  }

  // ---- dynamic content ---------------------------------------------------------------------

  #allowChurn(host) {
    const now = Date.now();
    let c = this.churn.get(host);
    if (!c || now - c.t0 > 60000) c = { n: 0, t0: now };
    c.n++;
    this.churn.set(host, c);
    return c.n <= CHURN_LIMIT;
  }

  #sweepStale() {
    for (const u of [...this.units.values()]) {
      if (!inj.intact(u)) this.#drop(u);
    }
  }

  #onMutations({ added, dirty }) {
    if (!this.active) return;
    const rescan = new Set();
    const handled = new Set();

    for (const el of dirty) {
      if (!el.isConnected) continue;
      const container = blockContainerOf(el);
      if (handled.has(container)) continue;
      handled.add(container);
      const set = this.byHost.get(container);
      if (!set) {
        rescan.add(container);
        continue;
      }
      // These records came from the page (our writes were drained by guard()). Rescan the
      // full container, including siblings inserted beyond the old first..last source range.
      if (this.#allowChurn(container)) {
        for (const u of [...set]) this.#drop(u);
        rescan.add(container);
      }
    }

    this.#sweepStale();
    for (const a of added) {
      if (!a.isConnected) continue;
      const container = blockContainerOf(a);
      if (!handled.has(container)) rescan.add(container);
    }
    for (const root of rescan) {
      if (root.isConnected) this.#scan(root);
    }
    this.emit();
  }

  #reshow(unit) {
    if (unit.translated == null) return;
    unit.state = 'pending';
    inj.write(() => this.#apply(unit, unit.translated));
  }

  #onRoute() {
    if (this.active) this.onRouteDebounced();
  }

  #resweep() {
    if (!this.active) return;
    this.#sweepStale();
    for (const root of this.#roots()) this.#scan(root);
    this.emit();
  }

  // ---- hover -------------------------------------------------------------------------------

  // Finds the unit under an element, building one on demand when the page is not translated.
  #locate(el) {
    let child = null;
    for (let a = el; a && a !== document.documentElement; child = a, a = a.parentElement) {
      const set = this.byHost.get(a);
      if (!set) continue;
      for (const u of set) {
        if (u.whole || !child || this.#covers(u, child)) return u;
      }
    }
    return null;
  }

  #covers(unit, child) {
    if (child === unit.tEl || child === unit.oEl || child === unit.wEl) return true;
    for (const n of inj.nodesOf(unit)) {
      if (n === child) return true;
    }
    return false;
  }

  #create(el) {
    const container = blockContainerOf(el);
    const runs = runsOf(container, { minChars: this.s.minChars, exclude: this.#exclude() });
    if (!runs.length) return null;
    let child = null;
    for (let a = el; a && a !== container; child = a, a = a.parentElement);
    let pick = null;
    for (const run of runs) {
      if (run.whole || !child) {
        pick = run;
        break;
      }
      for (let n = run.first; n; n = n.nextSibling) {
        if (n === child) {
          pick = run;
          break;
        }
        if (n === run.last) break;
      }
      if (pick) break;
    }
    if (!pick) return null;
    return this.#addUnit(pick, { watch: false });
  }

  // Pointer + hover key. mode 'toggle': translate the unit under the pointer, or collapse / peek an
  // already translated one. 'translate': only ever translate. 'collapse': only undo a hover
  // translation. Returns a short action name (or null when there was nothing to do).
  hoverToggle(el, mode = 'toggle') {
    if (!el || !el.closest || el.closest('dl-ui')) return null;
    const t = el.closest('dl-t');
    let u = t ? this.units.get(t.getAttribute('data-dl-id')) : this.#locate(el);
    if (!u && mode !== 'collapse') u = this.#create(el);
    if (!u) return null;
    if (u.state === 'done' || u.state === 'pending' || u.state === 'error') {
      if (mode === 'translate') return null;
      if (u.hover) {
        this.#drop(u);
        this.emit();
        return 'collapsed';
      }
      if (mode === 'collapse') return null;
      inj.setPeek(u, !u.peek);
      return u.peek ? 'peek-on' : 'peek-off';
    }
    if (mode !== 'collapse' && (u.state === 'idle' || u.state === 'skip')) {
      u.state = 'idle';
      u.hover = true;
      this.#enqueue(u, PRIORITY.VISIBLE, 0, true);
      return 'translating';
    }
    return null;
  }
}
