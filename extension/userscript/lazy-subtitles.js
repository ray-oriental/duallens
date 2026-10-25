import { subtitleOptions } from '../content/subtitles/track.js';
import { toast } from '../content/overlay.js';
import { uiLanguage } from '../shared/i18n.js';
import { loadFeatures, syncFeatureLanguage, FEATURES_RESOURCE_ERROR } from './features-loader.js';

// Only the userscript packer substitutes this adapter. MV3 keeps its native controller.
export class VideoSubtitles {
  constructor(options) {
    this.options = options; this.requested = false; this.generation = 0; this.failed = false;
  }
  get enabled() { return this.controller ? this.controller.enabled : this.requested; }
  enable() {
    if (this.enabled) return;
    this.requested = true; this.failed = false;
    const generation = ++this.generation;
    void loadFeatures().then(module => {
      if (!this.requested || generation !== this.generation) return;
      this.module = module;
      this.controller ||= new module.VideoSubtitles(this.options);
      this.controller.enable();
    }).catch(() => {
      if (!this.requested || generation !== this.generation) return;
      this.controller?.disable(); this.requested = false; this.failed = true;
      toast(FEATURES_RESOURCE_ERROR());
    });
  }
  disable() {
    this.requested = false; this.failed = false; this.generation++;
    this.controller?.disable();
  }
  update(previous, next) {
    // App calls update for every settings change, even when only OCR has loaded the resource.
    syncFeatureLanguage();
    if (!subtitleOptions(next).enabled) { this.disable(); return; }
    if (this.controller) {
      this.module.setUiLanguage(uiLanguage());
      this.controller.update(previous, next);
    } else this.enable();
  }
  state() {
    return this.controller ? this.controller.state() : {
      enabled: this.enabled, status: this.failed ? 'error' : this.enabled ? 'waiting-track' : 'disabled',
      cues: 0, translated: 0, failed: 0, order: [], overlay: false, visible: false, display: null, current: null,
    };
  }
}
