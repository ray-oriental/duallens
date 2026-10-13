import { cueIndexAt } from './json3.js';
import { escapeText, stripMarkup } from '../../shared/markup.js';

export function groupPriority(cues, timeMs, size = 5) {
  if (!cues.length) return [];
  const count = Math.ceil(cues.length / size);
  const current = Math.floor(cueIndexAt(cues, timeMs) / size);
  // Current group, immediately forward, immediately behind, then forward prefetch.
  return [...new Set([current, current + 1, current - 1,
    ...Array.from({ length: count - current }, (_, i) => current + i),
    ...Array.from({ length: current }, (_, i) => current - i - 1)])]
    .filter(i => i >= 0 && i < count).map(i => ({ index: i, priority: i === current ? 0 : Math.abs(i - current) === 1 ? 1 : 2,
      cues: cues.slice(i * size, (i + 1) * size) }));
}

export class SubtitleScheduler {
  constructor({ service, cues, request, onUpdate = () => {} }) {
    this.service = service; this.cues = cues; this.request = request; this.onUpdate = onUpdate;
    this.failed = new Set(); this.time = 0; this.epoch = 0; this.active = null; this.stopped = false;
    this.order = [];
  }
  seek(timeMs) {
    this.time = timeMs;
    this.epoch++;
    this.active?.cancel(); this.active = null;
    this.stopped = false;
    this.pump();
  }
  updateTime(timeMs) { this.time = timeMs; }
  pump() {
    if (this.stopped || this.active) return;
    const group = groupPriority(this.cues, this.time).find(g => g.cues.some(c => c.translation === null && !this.failed.has(c.id)));
    if (!group) return;
    const items = group.cues.filter(c => c.translation === null && !this.failed.has(c.id));
    const epoch = this.epoch;
    this.order.push(group.index); if (this.order.length > 100) this.order.shift();
    const byId = new Map(items.map(c => [c.id, c]));
    let finished = false;
    const finish = () => {
      if (finished || epoch !== this.epoch || this.stopped) return;
      finished = true;
      for (const cue of items) if (cue.translation === null) this.failed.add(cue.id);
      this.active = null;
      this.onUpdate();
      this.pump();
    };
    const active = this.service.translateBatch({ ...this.request, priority: group.priority,
      items: items.map(c => ({ id: c.id, text: escapeText(c.text) })) }, results => {
      if (epoch !== this.epoch || this.stopped) return;
      for (const result of results) {
        const cue = byId.get(result.id);
        if (!cue) continue;
        byId.delete(result.id);
        if (typeof result.text === 'string' && !result.error) cue.translation = stripMarkup(result.text);
        else this.failed.add(cue.id);
      }
      this.onUpdate();
      if (!byId.size) queueMicrotask(finish);
    });
    this.active = active;
    // Results alone complete a public PLATFORMS.md batch. Shipped adapters also
    // expose done so incomplete transport responses can be surfaced as failures.
    active.done?.finally(finish).catch(() => {});
  }
  stop() { this.stopped = true; this.epoch++; this.active?.cancel(); this.active = null; }
}
