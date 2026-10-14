// Watchers that feed the controller: viewport (lazy translation), DOM mutations and SPA routes
// (SPEC §5.4-5.5).

import { isOurs } from './util.js';

// Observe hosts, but schedule by each unit's range, including ranges inside a tall reader block.
export class LazyObserver {
  constructor(onVisible) {
    this.onVisible = onVisible;
    this.margin = 600;
    this.targets = new Map(); // host -> Set<unit>
    this.io = null;
    this.frame=0;
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

  setMargin(px) {
    const v = Number.isFinite(px) && px >= 0 ? px : 600;
    if (this.io && v === this.margin) return;
    this.margin = v;
    this.io?.disconnect();
    this.#make();
  }

  watch(unit) {
    const r = this.#rect(unit);
    if (r.bottom > 0 && r.top < (window.innerHeight || 800)) {
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
    if(unit.first?.isConnected && unit.last?.isConnected) {
      const range=document.createRange();range.setStartBefore(unit.first);range.setEndAfter(unit.last);
      const rect=range.getBoundingClientRect();if(rect.height || rect.width)return rect;
    }
    return unit.host.getBoundingClientRect();
  }

  #release(host) {
    const set=this.targets.get(host);if(!set)return;
    const vh = window.innerHeight || 800;
    const bounds=host.getBoundingClientRect();if(bounds.bottom<=-this.margin || bounds.top>=vh+this.margin)return;
    for(const u of [...set]) {
      const r=this.#rect(u);if(r.bottom<=-this.margin || r.top>=vh+this.margin)continue;
      // 0 = on screen, 1 = within a screen's distance, 2 = further prefetch
      const priority = r.bottom > 0 && r.top < vh ? 0 : r.bottom > -vh && r.top < 2 * vh ? 1 : 2;
      this.unwatch(u);this.onVisible(u, priority, r.top);
    }
  }

  disconnect() {
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
  }

  start() {
    if (this.mo) return;
    this.mo = new MutationObserver((records) => this.#collect(records));
    this.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  stop() {
    this.mo?.disconnect();
    this.mo = null;
    clearTimeout(this.timer);
    this.timer = 0;
    this.added.clear();
    this.dirty.clear();
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
      const el = t.nodeType === 1 ? t : t.parentElement;
      if (!el || el.closest('dl-t,dl-ui')) continue;
      if (r.type === 'characterData') {
        this.dirty.add(el);
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
    const batch = { added: [...this.added], dirty: [...this.dirty] };
    this.added.clear();
    this.dirty.clear();
    this.onBatch(batch);
  }
}

// Isolated-world history hooks need the Navigation API and polling to cover page routes.
export class RouteWatcher {
  constructor(onChange) {
    this.onChange = onChange;
    this.href = '';
    this.poll = 0;
    this.restore = [];
    this.check = () => {
      if (location.href === this.href) return;
      this.href = location.href;
      this.onChange();
    };
  }

  start() {
    if (this.poll) return;
    this.href = location.href;
    const nav = window.navigation;
    if (nav && nav.addEventListener) {
      nav.addEventListener('currententrychange', this.check);
      this.restore.push(() => nav.removeEventListener('currententrychange', this.check));
    }
    window.addEventListener('popstate', this.check);
    window.addEventListener('hashchange', this.check);
    this.restore.push(() => {
      window.removeEventListener('popstate', this.check);
      window.removeEventListener('hashchange', this.check);
    });
    for (const name of ['pushState', 'replaceState']) {
      const orig = history[name];
      try {
        const check = this.check;
        history[name] = function (...args) {
          const r = orig.apply(this, args);
          queueMicrotask(check);
          return r;
        };
        this.restore.push(() => {
          history[name] = orig;
        });
      } catch {
        /* history is not writable here: the other signals still work */
      }
    }
    this.poll = setInterval(this.check, 1000);
  }

  stop() {
    clearInterval(this.poll);
    this.poll = 0;
    for (const r of this.restore.splice(0)) r();
  }
}
