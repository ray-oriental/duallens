// Content-side request bookkeeping; the transport belongs to the platform.
export class TranslateClient {
  constructor(platform) {
    this.service = platform.translator();
    this.seq = 0;
    this.reqs = new Map();
    this.visible = 0;
  }
  request(req, { onResults, onDone }) {
    const id = String(++this.seq);
    const remaining = new Set(req.items.map((i) => i.id));
    const entry = { cancel: () => {}, started: false, visible: req.priority === 0 };
    this.reqs.set(id, entry);
    const finish = () => {
      if (!this.reqs.delete(id)) return;
      if (entry.started && entry.visible) this.visible--;
      onDone?.(); this.drain();
    };
    entry.start = () => {
      if (!this.reqs.has(id) || entry.started) return;
      entry.started = true;
      if (entry.visible) this.visible++;
      const handle = this.service.translateBatch(req, (results) => {
        if (!this.reqs.has(id)) return;
        const fresh = results.filter((r) => remaining.delete(r.id));
        if (fresh.length) onResults?.(fresh);
        if (!remaining.size) finish();
      });
      entry.cancel = () => handle.cancel();
      handle.done?.then(finish, finish);
    };
    if (entry.visible || req.priority === undefined) entry.start();
    else queueMicrotask(() => this.drain());
    return id;
  }
  drain() {
    if (this.visible) return;
    for (const entry of this.reqs.values()) {
      if (this.visible) break;
      if (!entry.started) entry.start();
    }
  }
  cancel(id) {
    const h = this.reqs.get(id);
    if (!this.reqs.delete(id)) return;
    if (h.started && h.visible) this.visible--;
    h.cancel(); this.drain();
  }
  cancelAll() {
    const entries = [...this.reqs.values()]; this.reqs.clear(); this.visible = 0;
    for (const entry of entries) entry.cancel();
  }
  outstanding() { return this.reqs.size; }
  dispose() { this.cancelAll(); this.service.dispose?.(); }
}
