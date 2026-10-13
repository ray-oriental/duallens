// Content-side request bookkeeping; the transport belongs to the platform.
export class TranslateClient {
  constructor(platform) {
    this.service = platform.translator();
    this.seq = 0;
    this.reqs = new Map();
  }
  request(req, { onResults, onDone }) {
    const id = String(++this.seq);
    const remaining = new Set(req.items.map((i) => i.id));
    const handle = this.service.translateBatch(req, (results) => {
      const fresh = results.filter((r) => remaining.delete(r.id));
      if (fresh.length) onResults?.(fresh);
      if (!remaining.size && this.reqs.delete(id)) onDone?.();
    });
    this.reqs.set(id, handle);
    handle.done?.finally(() => { if (this.reqs.delete(id)) onDone?.(); });
    return id;
  }
  cancel(id) { const h = this.reqs.get(id); this.reqs.delete(id); h?.cancel(); }
  cancelAll() { for (const id of this.reqs.keys()) this.cancel(id); }
  outstanding() { return this.reqs.size; }
  dispose() { this.cancelAll(); this.service.dispose?.(); }
}
