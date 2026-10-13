import { originalTrackURL, subtitleOptions, isYouTube } from './track.js';
import { parseJSON3, cueIndexAt } from './json3.js';
import { SubtitleScheduler } from './scheduler.js';
import { SubtitleOverlay } from './overlay.js';

export class YouTubeSubtitles {
  constructor({ platform, getSettings }) {
    this.platform = platform; this.getSettings = getSettings;
    this.enabled = false; this.cues = []; this.url = ''; this.status = 'disabled';
    this.generation = 0; this.lastTrack = ''; this.page = location.href;
    this.render = () => {
      if (!this.video) return;
      const time = this.video.currentTime * 1000;
      this.scheduler?.updateTime(time);
      const cue = this.cues[cueIndexAt(this.cues, time)];
      this.current = cue && cue.start <= time && time < cue.end ? cue : null;
      this.overlay?.render(this.current, subtitleOptions(this.getSettings()));
    };
    this.seek = () => { this.scheduler?.seek(this.video.currentTime * 1000); this.render(); };
  }
  enable() {
    if (this.enabled || !isYouTube(location.hostname)) return;
    this.enabled = true; this.status = 'waiting-track'; this.page = location.href;
    this.off = this.platform.subtitles.observe(url => {
      this.lastTrack = url;
      if (this.video) void this.load(url);
    });
    this.timer = setInterval(() => this.refreshPlayer(), 500);
    document.addEventListener('yt-navigate-finish', this.navigate = () => this.refreshPlayer());
    document.addEventListener('fullscreenchange', this.render);
    this.refreshPlayer();
  }
  refreshPlayer() {
    if (!this.enabled) return;
    if (location.href !== this.page) {
      // Discard data before a new video can reuse the same DOM/player.
      this.clear(); this.lastTrack = ''; this.page = location.href; this.status = 'waiting-track';
      this.off?.(); this.off = this.platform.subtitles.observe(url => { this.lastTrack = url; if (this.video) void this.load(url); });
    }
    const video = document.querySelector('#movie_player video, .html5-video-player video, #player-container-id video, #player video');
    const player = video?.closest('#movie_player, .html5-video-player, #player-container-id, #player');
    if (!video || !player) {
      if (this.video) this.clear();
      return;
    }
    if (this.video === video && this.overlay?.player === player && this.overlay.host.isConnected) return;
    this.clear(); this.video = video;
    this.overlay = new SubtitleOverlay(player);
    for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) video.addEventListener(type, this.render);
    video.addEventListener('seeking', this.seek);
    if (this.lastTrack) void this.load(this.lastTrack);
  }
  async load(raw) {
    const url = originalTrackURL(raw, location.href);
    if (!url || url === this.url || !this.enabled || !this.video) return;
    this.cancel(); this.url = url; this.cues = []; this.render(); this.status = 'loading';
    const generation = this.generation;
    const ctrl = this.fetchController = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    try {
      const data = await this.platform.subtitles.fetchTrack(url, { signal: ctrl.signal });
      if (generation !== this.generation || !this.enabled) return;
      this.cues = parseJSON3(data, { asr: new URL(url).searchParams.get('kind') === 'asr' });
      this.status = this.cues.length ? 'ready' : 'empty';
      const settings = this.getSettings();
      const service = this.service = this.platform.translator();
      this.scheduler = new SubtitleScheduler({ service, cues: this.cues,
        request: { to: settings.targetLang, from: new URL(url).searchParams.get('lang') || settings.sourceLang,
          context: { title: document.title, host: location.hostname, url: location.href } }, onUpdate: this.render });
      this.scheduler.seek(this.video.currentTime * 1000);
      this.render();
    } catch {
      if (generation === this.generation && this.enabled) { this.status = 'error'; this.url = ''; }
    } finally { clearTimeout(timeout); }
  }
  cancel() {
    this.generation++; this.fetchController?.abort(); this.fetchController = null;
    this.scheduler?.stop(); this.scheduler = null; this.service?.dispose?.(); this.service = null;
  }
  clear() {
    this.cancel();
    if (this.video) {
      for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) this.video.removeEventListener(type, this.render);
      this.video.removeEventListener('seeking', this.seek);
    }
    this.video = null; this.overlay?.destroy(); this.overlay = null; this.cues = []; this.current = null; this.url = '';
  }
  disable() {
    this.enabled = false; this.off?.(); this.off = null; clearInterval(this.timer);
    document.removeEventListener('yt-navigate-finish', this.navigate);
    document.removeEventListener('fullscreenchange', this.render);
    this.clear(); this.lastTrack = ''; this.status = 'disabled';
  }
  update(previous, next) {
    if (!subtitleOptions(next).enabled) { this.disable(); return; }
    if (!this.enabled) { this.enable(); return; }
    if (previous.targetLang !== next.targetLang || previous.sourceLang !== next.sourceLang ||
        JSON.stringify(previous.provider) !== JSON.stringify(next.provider) ||
        JSON.stringify(previous.prompt) !== JSON.stringify(next.prompt) ||
        JSON.stringify(previous.glossary) !== JSON.stringify(next.glossary)) {
      const url = this.url; this.cancel(); this.url = ''; if (url) void this.load(url);
    }
    this.render();
  }
  state() {
    return { enabled: this.enabled, status: this.status, cues: this.cues.length,
      translated: this.cues.filter(c => c.translation !== null).length,
      failed: this.scheduler?.failed.size || 0, order: this.scheduler?.order || [],
      overlay: !!this.overlay?.host.isConnected, visible: !!this.overlay?.host.hasAttribute('data-ready'),
      display: this.overlay?.state() || null,
      current: this.current ? { source: this.current.text, translation: this.current.translation } : null };
  }
}
