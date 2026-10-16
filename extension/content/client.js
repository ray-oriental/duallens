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
    const entry = { cancel: () => {}, started: false, visible: req.priority === 0, holds: false };
    const answered = new Set(); // ids with any result, draft included
    this.reqs.set(id, entry);
    // A visible request holds back lower-priority ones until it is answered; a draft counts as an answer,
    // so nearby text gets its machine translation while the LLM is still refining the visible text.
    entry.release = () => { if (entry.holds) { entry.holds = false; this.visible--; } };
    const finish = () => {
      if (!this.reqs.delete(id)) return;
      entry.release();
      onDone?.(); this.drain();
    };
    entry.start = () => {
      if (!this.reqs.has(id) || entry.started) return;
      entry.started = true;
      if (entry.visible) { entry.holds = true; this.visible++; }
      const handle = this.service.translateBatch(req, (results) => {
        if (!this.reqs.has(id)) return;
        // A draft (machine translation) leaves the id open: its terminal result is still to come.
        const fresh = results.filter((r) => r.stage === 'draft' ? remaining.has(r.id) : remaining.delete(r.id));
        if (fresh.length) onResults?.(fresh);
        for (const r of fresh) answered.add(r.id);
        if (!remaining.size) finish();
        else if (entry.holds && answered.size >= req.items.length) { entry.release(); this.drain(); }
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
    h.release();
    h.cancel(); this.drain();
  }
  cancelAll() {
    const entries = [...this.reqs.values()]; this.reqs.clear(); this.visible = 0;
    for (const entry of entries) { entry.holds = false; entry.cancel(); }
  }
  outstanding() { return this.reqs.size; }
  dispose() { this.cancelAll(); this.service.dispose?.(); }
}
