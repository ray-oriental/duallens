// Cooperative DOM work. A cancellation generation prevents stale scans/inserts after restore.
export class IdleSlices {
  constructor() { this.generation = 0; this.started = 0; }
  cancel() { this.generation++; }
  schedule(fn) {
    if (globalThis.requestIdleCallback) requestIdleCallback(fn, { timeout: 16 });
    else setTimeout(() => fn({ timeRemaining: () => 8 }), 0);
  }
  run(iterator, consume) {
    const generation = this.generation;
    const tick = (deadline) => {
      if (generation !== this.generation) return;
      const start = performance.now();
      let steps = 0;
      do {
        const next = iterator.next();
        if (next.done) return;
        consume(next.value);
        steps++;
      } while (steps < 256 && performance.now() - start < 8 && (steps < 32 || deadline.timeRemaining() > 1));
      this.schedule(tick);
    };
    this.schedule(tick);
  }
  async yield() {
    if (performance.now() - this.started < 8) return;
    await new Promise((resolve) => this.schedule(resolve));
    this.started = performance.now();
  }
}
