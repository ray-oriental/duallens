// Hover translation. Hold the configured modifier (Shift by default) over a paragraph to translate
// just that paragraph; press again on a translated one to collapse it. With modifier "none" the
// paragraph under a resting pointer is translated after 500 ms (Esc collapses it).
//
// Typing capital letters also presses Shift, so a press only counts when nothing else happens
// within HOLD_MS: any other key or a mouse button disarms it.

import { blockContainerOf } from './walker.js';
import { editableOf } from './inputbox.js';
import { deepActiveElement } from './util.js';

const HOLD_MS = 130;
const REST_MS = 500;

export class HoverTranslate {
  constructor({ getSettings, controller }) {
    this.getSettings = getSettings;
    this.controller = controller;
    this.on = false;
    this.target = null;
    this.armed = false;
    this.holdTimer = 0;
    this.restTimer = 0;
    this.handled = new Set(); // containers acted on during the current key hold
    this.lastX = -1;
    this.lastY = -1;

    this.onMove = (e) => this.#move(e);
    this.onKeyDown = (e) => this.#keydown(e);
    this.onKeyUp = (e) => {
      if (e.key === this.#modifier()) this.#disarm();
    };
    this.onMouseDown = () => this.#disarm();
    this.onBlur = () => this.#disarm();
  }

  enable() {
    if (this.on) return;
    this.on = true;
    document.addEventListener('mousemove', this.onMove, { capture: true, passive: true });
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('blur', this.onBlur);
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    document.removeEventListener('mousemove', this.onMove, { capture: true });
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('blur', this.onBlur);
    this.#disarm();
    clearTimeout(this.restTimer);
  }

  isActive() {
    return this.on && !!this.getSettings().hover.enabled;
  }

  #modifier() {
    return this.getSettings().hover.modifier;
  }

  #usable() {
    return this.isActive() && !!this.target && !this.#typing();
  }

  #typing() {
    return !!editableOf(deepActiveElement()) || !!editableOf(this.target);
  }

  #move(e) {
    if (!this.getSettings().hover.enabled) return;
    if (e.clientX === this.lastX && e.clientY === this.lastY) return; // layout-induced move events
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.target = e.composedPath()[0] || e.target;
    const mod = this.#modifier();
    if (mod === 'none') {
      clearTimeout(this.restTimer);
      const t = this.target;
      this.restTimer = setTimeout(() => {
        if (this.#usable() && this.target === t) this.controller.hoverToggle(t, 'translate');
      }, REST_MS);
    } else if (this.armed && this.fired) {
      // key still held: moving onto the next paragraph translates it too
      const c = this.#container();
      if (c && !this.handled.has(c)) {
        this.handled.add(c);
        this.controller.hoverToggle(this.target, 'translate');
      }
    }
  }

  #container() {
    try {
      return this.target && this.target.nodeType === 1 ? blockContainerOf(this.target) : null;
    } catch {
      return null;
    }
  }

  #keydown(e) {
    const cfg = this.getSettings().hover;
    if (!cfg.enabled) return;
    if (cfg.modifier === 'none') {
      if (e.key === 'Escape' && this.target) this.controller.hoverToggle(this.target, 'collapse');
      return;
    }
    if (e.key === cfg.modifier) {
      if (e.repeat || this.armed) return;
      this.armed = true;
      this.fired = false;
      this.handled.clear();
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        if (!this.armed || !this.#usable()) return;
        this.fired = true;
        const c = this.#container();
        if (c) this.handled.add(c);
        this.controller.hoverToggle(this.target, 'toggle');
      }, HOLD_MS);
    } else {
      this.#disarm(); // a chord such as Shift+A, not a hover gesture
    }
  }

  #disarm() {
    this.armed = false;
    this.fired = false;
    clearTimeout(this.holdTimer);
  }
}
