const CSS = `
:host { all:initial; pointer-events:none; }
.captions { position:absolute; inset-inline:4%; bottom:12%; text-align:center; color:#fff;
  font-family:"Segoe UI","Microsoft YaHei",sans-serif; line-height:1.35; font-weight:500; white-space:pre-wrap;
  overflow-wrap:anywhere; text-shadow:0 1px 3px #000; pointer-events:none; }
.captions.top { bottom:auto; top:8%; }
.line { display:table; margin:2px auto; padding:3px 8px; background:rgba(8,8,8,.75); border-radius:3px; max-width:100%; }
.source { opacity:.88; }
`;

export class SubtitleOverlay {
  constructor(player, video = null) {
    this.player = player;
    this.host = document.createElement('dl-ui');
    this.host.setAttribute('data-dl-subtitles', '');
    this.host.style.cssText = 'all:initial!important;position:absolute!important;inset:0!important;pointer-events:none!important;z-index:60!important;display:block!important;';
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = CSS;
    this.box = document.createElement('div'); this.box.className = 'captions';
    this.source = document.createElement('div'); this.source.className = 'line source'; this.source.dir = 'auto';
    this.target = document.createElement('div'); this.target.className = 'line target'; this.target.dir = 'auto';
    this.box.append(this.source, this.target); root.append(style, this.box);
    // Hide only the visual native caption layer while a translated cue is shown.
    // Never toggle the player's CC setting, alter caption nodes or intercept responses.
    this.nativeStyle = document.createElement('style');
    this.nativeStyle.textContent = `:is(#movie_player,.html5-video-player,#player-container-id,#player):has(>dl-ui[data-dl-subtitles][data-ready]) :is(.ytp-caption-window-container,.caption-window,.captions-text) { visibility:hidden!important; }`;
    this.position = player.style.getPropertyValue('position');
    this.positionPriority = player.style.getPropertyPriority('position');
    this.hadStyle = player.hasAttribute('style');
    this.changedPosition = !video && getComputedStyle(player).position === 'static';
    if (this.changedPosition) player.style.setProperty('position', 'relative');
    if (!video) player.append(this.nativeStyle, this.host);
    else {
      // A top-layer popover can remain above an element-fullscreen <video>,
      // whose fallback children cannot render. No player/track DOM is changed.
      this.host.setAttribute('popover', 'manual');
      this.reposition = () => {
        const full = document.fullscreenElement;
        const parent = full && full !== video && full.contains(video) ? full : document.body;
        if (this.host.parentNode !== parent) parent.append(this.host);
        if (full === video && !this.host.matches(':popover-open')) this.host.showPopover?.();
        else if (full !== video && this.host.matches(':popover-open')) this.host.hidePopover?.();
        const r = video.getBoundingClientRect();
        this.host.style.cssText = `all:initial!important;position:fixed!important;inset:auto!important;left:${r.left}px!important;top:${r.top}px!important;width:${r.width}px!important;height:${r.height}px!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important;`;
      };
      for (const type of ['resize', 'scroll', 'fullscreenchange']) window.addEventListener(type, this.reposition, true);
      this.resize = new ResizeObserver(this.reposition); this.resize.observe(video);
      this.reposition();
    }
    this.render(null, {});
  }
  render(cue, options) {
    const ready = cue && cue.translation !== null;
    this.host.toggleAttribute('data-ready', !!ready);
    this.box.hidden = !ready;
    this.source.textContent = ready ? cue.text : '';
    this.target.textContent = ready ? cue.translation : '';
    this.source.hidden = options.mode === 'translation-only';
    this.box.classList.toggle('top', options.position === 'top');
    this.box.style.fontSize = `${options.fontSize || 22}px`;
  }
  state() {
    return { visible: !this.box.hidden, sourceHidden: this.source.hidden,
      fontSize: this.box.style.fontSize, position: this.box.classList.contains('top') ? 'top' : 'bottom' };
  }
  destroy() {
    for (const type of ['resize', 'scroll', 'fullscreenchange']) window.removeEventListener(type, this.reposition, true);
    this.resize?.disconnect();
    this.host.remove(); this.nativeStyle.remove();
    if (this.changedPosition && this.player.style.getPropertyValue('position') === 'relative') {
      if (this.position) this.player.style.setProperty('position', this.position, this.positionPriority);
      else this.player.style.removeProperty('position');
      if (!this.hadStyle && !this.player.getAttribute('style')) this.player.removeAttribute('style');
    }
  }
}
