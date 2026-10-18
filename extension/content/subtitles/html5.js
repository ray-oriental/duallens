import { subtitleOptions } from './track.js';
import { YouTubeSubtitles } from './youtube.js';
import { SubtitleScheduler } from './scheduler.js';
import { SubtitleOverlay } from './overlay.js';
import { subtitleText } from './files.js';

// Native TextTrack loading already enforces same-origin/CORS for <track src>.
// Do not turn the privileged worker/GM transport into a generic subtitle proxy.
export class HTML5Subtitles {
  constructor({ platform, getSettings }) {
    this.platform = platform; this.getSettings = getSettings; this.enabled = false; this.players = new Map();
  }
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.observer = new MutationObserver(records => {
      if (records.some(r => r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches('video,track') || n.querySelector('video,track'))))) this.scan();
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'kind', 'default'] });
    this.scan();
  }
  scan() {
    if (!this.enabled) return;
    for (const [video, entry] of this.players) if (!video.isConnected) { entry.destroy(); this.players.delete(video); }
    for (const video of document.querySelectorAll('video')) {
      if (!this.players.has(video)) this.players.set(video, new NativePlayer(video, this));
      this.players.get(video).refresh();
    }
  }
  disable() {
    this.enabled = false; this.observer?.disconnect();
    for (const entry of this.players.values()) entry.destroy();
    this.players.clear();
  }
  update(previous, next) {
    if (!subtitleOptions(next).enabled) { this.disable(); return; }
    if (['targetLang', 'sourceLang', 'provider', 'translation', 'prompt', 'glossary'].some(k => JSON.stringify(previous[k]) !== JSON.stringify(next[k]))) this.disable();
    this.enable(); for (const entry of this.players.values()) entry.render();
  }
  state() {
    const entries = [...this.players.values()];
    const entry = entries.find(e => e.current) || entries.find(e => e.cues.length);
    return { ...(entry || new YouTubeSubtitles(this)).state(), enabled: this.enabled,
      status: !this.enabled ? 'disabled' : entry ? entry.status : 'waiting-track' };
  }
}
class NativePlayer extends YouTubeSubtitles {
  constructor(video, owner) {
    super(owner); this.video = video; this.enabled = true;
    this.refresh = () => this.read();
    const render = this.render;
    this.render = () => {
      render();
      // Suppress native painting only while there is a translated current cue.
      const hide = this.current?.translation != null;
      if (this.track && this.originalMode === 'showing') {
        const mode = hide ? 'hidden' : 'showing';
        if (this.track.mode !== mode) { this.suppressed = hide; this.track.mode = mode; }
      }
    };
    for (const type of ['timeupdate', 'seeking', 'loadedmetadata', 'emptied', 'load', 'play', 'pause']) video.addEventListener(type, type === 'seeking' ? this.seek : this.refresh, true);
    for (const type of ['change', 'addtrack', 'removetrack']) video.textTracks.addEventListener(type, this.refresh);
  }
  read() {
    const tracks = [...this.video.textTracks].filter(t => ['subtitles', 'captions'].includes(t.kind));
    const track = tracks.find(t => t.mode === 'showing') || tracks.find(t => t === this.track && this.suppressed && t.mode === 'hidden') || tracks.find(t => t.mode === 'hidden');
    if (track !== this.track || this.source !== this.video.currentSrc) {
      this.clear(); this.track = track; this.source = this.video.currentSrc;
      if (track) { this.originalMode = track.mode; track.addEventListener('cuechange', this.refresh); }
    }
    if (!track) { this.status = 'waiting-track'; return; }
    let list;
    try { list = track.cues; } catch { return; }
    if (!list?.length || list.length > 10000) { if (this.cues.length) this.reset(); return; }
    // Rebuild for loaded/replaced/streamed tracks; normal timeupdate is O(1).
    const signature = [list.length, list[0], list[list.length - 1]];
    if (!this.signature || signature.some((v, i) => v !== this.signature[i])) {
      this.reset(); this.signature = signature;
      this.cues = [...list].filter(c => Number.isFinite(c.startTime) && Number.isFinite(c.endTime) && c.startTime >= 0 && c.endTime > c.startTime && typeof c.text === 'string')
        .map(c => ({ start: Math.round(c.startTime * 1000), end: Math.round(c.endTime * 1000), text: subtitleText(c.text), translation: null }))
        .filter(c => c.text).sort((a, b) => a.start - b.start).map((c, i) => ({ ...c, id: `subtitle-${i}` }));
      if (!this.cues.length) return;
      this.status = 'ready';
      this.overlay = new SubtitleOverlay(this.video.parentElement, this.video);
      const settings = this.getSettings(), generation = this.generation;
      this.service = this.platform.translator();
      this.scheduler = new SubtitleScheduler({ service: this.service, cues: this.cues,
        request: { to: settings.targetLang, from: track.language || settings.sourceLang },
        onUpdate: () => { if (generation === this.generation) this.render(); } });
      this.scheduler.seek(this.video.currentTime * 1000);
    }
    this.render();
  }
  reset() {
    this.cancel();
    this.overlay?.destroy(); this.overlay = null; this.cues = []; this.current = null; this.signature = null;
    if (this.track && this.suppressed && this.track.mode === 'hidden') this.track.mode = this.originalMode;
    this.suppressed = false;
  }
  clear() { this.track?.removeEventListener('cuechange', this.refresh); this.reset(); this.track = null; }
  destroy() {
    for (const type of ['timeupdate', 'seeking', 'loadedmetadata', 'emptied', 'load', 'play', 'pause']) this.video.removeEventListener(type, type === 'seeking' ? this.seek : this.refresh, true);
    for (const type of ['change', 'addtrack', 'removetrack']) this.video.textTracks.removeEventListener(type, this.refresh);
    this.clear();
  }
}
