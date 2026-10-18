// Watchers that feed the controller: viewport (lazy translation), DOM mutations and SPA routes
// (SPEC §5.4-5.5).

import { isOurs } from './util.js';
import { frameRect } from './frames.js';

// Observe hosts, but schedule by each unit's range, including ranges inside a tall reader block.
export class LazyObserver {
  constructor(onVisible) {
    this.onVisible = onVisible;
    this.margin = 600;
    this.targets = new Map(); // host -> Set<unit>
    this.io = null;
    this.frame=0;
    this.documents=new Set();
    this.scroll=()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;for(const host of this.targets.keys())this.#release(host);});};
  }

  #make() {
    window.addEventListener('scroll',this.scroll,{passive:true,capture:true});
    window.addEventListener('resize',this.scroll);
    this.io = new IntersectionObserver((entries) => this.#onEntries(entries), {
      rootMargin: `${this.margin}px 0px ${this.margin}px 0px`,
    });
    for (const host of this.targets.keys()) this.io.observe(host);
  }

  addDocument(doc) {
    if(this.documents.has(doc))return;
    this.documents.add(doc);
    (doc.defaultView || doc).addEventListener('scroll',this.scroll,{passive:true,capture:true});
  }

  removeDocument(doc) {
    this.documents.delete(doc);
    (doc.defaultView || doc).removeEventListener('scroll',this.scroll,true);
  }

  setMargin(px) {
    const v = Number.isFinite(px) && px >= 0 ? px : 600;
    if (this.io && v === this.margin) return;
    this.margin = v;
    this.io?.disconnect();
    this.#make();
  }

  watch(unit) {
    const r = this.#rect(unit);
    if (r.bottom > r.top && r.right > r.left && r.bottom > 0 && r.top < (window.innerHeight || 800)&&!(r.right<=0||r.left>=innerWidth)) {
      this.onVisible(unit, 0, r.top); return;
    }
    if (!this.io) this.#make();
    let set = this.targets.get(unit.host);
    if (!set) {
      set = new Set();
      this.targets.set(unit.host, set);
      this.io.observe(unit.host);
    }
    set.add(unit);
  }

  unwatch(unit) {
    const set = this.targets.get(unit.host);
    if (!set) return;
    set.delete(unit);
    if (!set.size) {
      this.targets.delete(unit.host);
      this.io?.unobserve(unit.host);
    }
  }

  #onEntries(entries) {
    for(const e of entries)if(e.isIntersecting)this.#release(e.target);
  }

  #rect(unit) {
    const doc=unit.host.ownerDocument;
    const mapped=r=>frameRect(r,doc);
    if (unit.attribute) return mapped((unit.host.closest('select') || unit.host).getBoundingClientRect());
    if(unit.first?.isConnected && unit.last?.isConnected) {
      const range=doc.createRange();range.setStartBefore(unit.first);range.setEndAfter(unit.last);
      const rect=range.getBoundingClientRect();if(rect.height || rect.width)return mapped(rect);
    }
    return mapped(unit.host.getBoundingClientRect());
  }

  #release(host) {
    const set=this.targets.get(host);if(!set)return;
    const vh = window.innerHeight || 800;
    const bounds=frameRect(host.getBoundingClientRect(),host.ownerDocument);if(bounds.bottom<=-this.margin || bounds.top>=vh+this.margin)return;
    for(const u of [...set]) {
      const r=this.#rect(u);if(r.bottom<=r.top||r.right<=r.left||r.bottom<=-this.margin || r.top>=vh+this.margin||r.right<=0||r.left>=innerWidth)continue;
      // 0 = on screen, 1 = within a screen's distance, 2 = further prefetch
      const priority = r.bottom > 0 && r.top < vh ? 0 : r.bottom > -vh && r.top < 2 * vh ? 1 : 2;
      this.unwatch(u);this.onVisible(u, priority, r.top);
    }
  }

  disconnect() {
    for(const doc of this.documents)this.removeDocument(doc);
    window.removeEventListener('scroll',this.scroll,true);window.removeEventListener('resize',this.scroll);
    cancelAnimationFrame(this.frame);this.frame=0;
    this.io?.disconnect();
    this.io = null;
    this.targets.clear();
  }
}

// Debounced MutationObserver. `guard(fn)` runs our own DOM writes and discards the records they
// produce, which is how the watcher ignores everything the injector does.
export class MutationWatcher {
  constructor(onBatch, delayMs = 300) {
    this.onBatch = onBatch;
    this.delayMs = delayMs;
    this.mo = null;
    this.timer = 0;
    this.added = new Set();
    this.dirty = new Set();
    this.layout = new Set();
    this.roots = new Set();
  }

  start(doc = document) {
    if(this.roots.has(doc))return;
    this.roots.add(doc);
    if (!this.mo) this.mo = new MutationObserver((records) => this.#collect(records));
    this.mo.observe(doc, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['placeholder','title','label','value','hidden','open','class','style','aria-hidden'] });
  }

  removeDocument(doc) {
    const roots=[...this.roots].filter(d=>d!==doc);
    this.#collect(this.mo?.takeRecords() || []);
    this.mo?.disconnect();this.mo=null;this.roots.clear();
    for(const root of roots)this.start(root);
  }

  stop() {
    this.mo?.disconnect();
    this.mo = null;
    this.roots.clear();
    clearTimeout(this.timer);
    this.timer = 0;
    this.added.clear();
    this.dirty.clear();
    this.layout.clear();
  }

  guard(fn) {
    if (!this.mo) return fn();
    this.#collect(this.mo.takeRecords());
    try {
      return fn();
    } finally {
      this.mo.takeRecords();
    }
  }

  #collect(records) {
    let any = false;
    for (const r of records) {
      const t = r.target;
      const el = t.nodeType === 1 || t.nodeType === 11 ? t : t.parentNode?.nodeType===11 ? t.parentNode : t.parentElement || t.documentElement;
      if (!el || el.closest?.('dl-t,dl-ui')) continue;
      if (r.type === 'characterData' || r.type === 'attributes') {
        (r.type==='attributes'&&/^(class|style)$/.test(r.attributeName)?this.layout:this.dirty).add(el);
        any = true;
        continue;
      }
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) {
          if (!isOurs(n)) {
            this.added.add(n);
            this.dirty.add(el);
            any = true;
          }
        } else if (n.nodeType === 3 && /\S/.test(n.data)) {
          this.dirty.add(el);
          any = true;
        }
      }
      if (r.removedNodes.length) {
        this.dirty.add(el);
        any = true;
      }
    }
    if (any && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = 0;
        this.#emit();
      }, this.delayMs);
    }
  }

  #emit() {
    const batch = { added: [...this.added], dirty: [...this.dirty],layout:[...this.layout] };
    this.added.clear();
    this.dirty.clear();
    this.layout.clear();
    this.onBatch(batch);
  }
}

// Rules and active translation subscribe to one detector in this window/world.
const routeDetectors = new WeakMap();
function routeDetector(win, doc) {
  const callbacks = new Set(), restore = [];
  let poll = 0;
  const check = () => { for (const cb of [...callbacks]) cb(); };
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    restore.push(() => target.removeEventListener(name, fn));
  };
  const nav = win.navigation;
  if (nav && typeof nav.addEventListener === 'function' && typeof nav.removeEventListener === 'function') {
    listen(nav, 'navigatesuccess', check);
    listen(nav, 'currententrychange', check);
  } else {
    // History wrappers cannot see the page world's calls from an isolated world.
    // Only this legacy path needs polling, and only while the page is visible.
    const visibility = () => {
      if (doc.visibilityState === 'hidden') { clearInterval(poll); poll = 0; }
      else { check(); if (!poll) poll = setInterval(check, 1000); }
    };
    listen(doc, 'visibilitychange', visibility);
    visibility();
    restore.push(() => clearInterval(poll));
    for (const name of ['pushState', 'replaceState']) {
      const orig = win.history[name];
      try {
        const wrapped = function (...args) {
          const result = orig.apply(this, args);
          queueMicrotask(check);
          return result;
        };
        win.history[name] = wrapped;
        restore.push(() => { if (win.history[name] === wrapped) win.history[name] = orig; });
      } catch { /* Navigation events and the visible-only fallback still work. */ }
    }
  }
  listen(win, 'popstate', check);
  listen(win, 'hashchange', check);
  return { callbacks, stop() { for (const remove of restore) remove(); } };
}

export class RouteWatcher {
  constructor(onChange) {
    this.onChange = onChange;
    this.href = '';
    this.detector = null;
    this.check = () => {
      if (!this.detector || location.href === this.href) return;
      this.href = location.href;
      this.onChange();
    };
  }

  start() {
    if (this.detector) return;
    this.href = location.href;
    this.win = window;
    if (!routeDetectors.has(window)) {
      routeDetectors.set(window, routeDetector(window, document));
    }
    this.detector = routeDetectors.get(window);
    this.detector.callbacks.add(this.check);
  }

  stop() {
    if (!this.detector) return;
    this.detector.callbacks.delete(this.check);
    if (!this.detector.callbacks.size) {
      this.detector.stop();
      routeDetectors.delete(this.win);
    }
    this.detector = null;
  }
}
