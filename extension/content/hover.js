import { t as l10n } from '../shared/i18n.js';
// Hover translation. Hold the configured modifier (Shift by default) over a paragraph to translate
// just that paragraph; press again on a translated one to collapse it. With modifier "none" the
// paragraph under a resting pointer is translated after 500 ms (Esc collapses it).
//
// Typing capital letters also presses Shift, so a press only counts when nothing else happens
// within HOLD_MS: any other key or a mouse button disarms it.

import{blockContainerOf}from './walker.js';
import{editableOf}from './inputbox.js';
import{deepActiveElement,hoverService}from './util.js';
import{createOverlay}from './overlay.js';

const UI={close:l10n('m4q')};
const HOLD_MS=130;
const REST_MS=500;

export class HoverTranslate{
  constructor({getSettings,controller,platform}){
    this.p=platform;
    this.touch=null;
    this.touchWait=0;
    this.touchDown=(e)=>this.#touchDown(e);
    this.touchMove=(e)=>{if(this.touch&&e.pointerId===this.touch.id&&Math.hypot(e.clientX-this.touch.x,e.clientY-this.touch.y)>10)this.#cancelTouch();};
    this.touchEnd=()=>this.#cancelTouch();
    this.s=getSettings;
    this.page=controller;
    if(controller.client)controller.client.service=hoverService(controller.client.service,getSettings);
    this.on=false;
    this.target=null;
    this.armed=false;
    this.hold=0;
    this.rest=0;
    this.seen=new Set(); // containers acted on during the current key hold
    this.x=-1;
    this.y=-1;

    this.move=(e)=>this.#move(e);
    this.key=(e)=>this.#keydown(e);
    this.keyUp=(e)=>{
      if(e.key===this.#modifier())this.#disarm();
    };
    this.mouseDown=e=>{if(!e.composedPath().some(n=>n.localName==='dl-ui'))this.#disarm();};
    this.blur=()=>this.#disarm();
  }

  enable(){
    if(this.on)return;
    this.on=true;
    this.#listen(true);
  }
  #listen(on){
    for(const[target,type,handler]of[[document,'pointerdown',this.touchDown],[document,'pointermove',this.touchMove],
      [document,'pointerup',this.touchEnd],[document,'pointercancel',this.touchEnd],[window,'scroll',this.touchEnd],
      [document,'mousemove',this.move],[document,'keydown',this.key],[document,'keyup',this.keyUp],
      [document,'mousedown',this.mouseDown],[window,'blur',this.blur]])
      target[on?'addEventListener':'removeEventListener'](type,handler,true);
  }
  disable(){
    this.on=false;this.#listen(false);this.#cancelTouch();this.#disarm();clearTimeout(this.rest);this.outline?.detach();
  }

  #cancelTouch(){clearTimeout(this.touchWait);this.touch=null;this.outline?.detach();}

  #mark(target){
    if(!this.outline){
      this.outline=createOverlay('.mark{position:fixed;border:1px solid rgba(128,128,128,.7);border-radius:4px;pointer-events:none}.mark button{position:absolute;right:4px;top:4px;width:20px;min-width:20px;height:20px;min-height:20px;border-radius:6px;font-size:14px;line-height:1;color:var(--dl-text-3)}.mark button:hover{color:var(--fg);background:var(--bg2)}');
      this.mark=document.createElement('div');this.mark.className='mark';const b=document.createElement('button');b.className='pop';b.textContent='×';b.setAttribute('aria-label',UI.close);
      b.onclick=()=>{this.disable();this.p.settingsStore.save({hover:{enabled:false}});};this.mark.append(b);this.outline.el.append(this.mark);
    }
    const r=blockContainerOf(target).getBoundingClientRect();this.mark.style.cssText=`left:${r.left-2}px;top:${r.top-2}px;width:${r.width+4}px;height:${r.height+4}px`;this.outline.attach();
  }

  #touchDown(e){
    this.#cancelTouch();
    if(e.pointerType!=='touch'||!e.isPrimary||!this.isActive())return;
    const target=e.composedPath()[0];
    if(!target?.closest||target.closest('dl-ui,a,button,input,textarea,select,[contenteditable]')||editableOf(target))return;
    this.touch={id:e.pointerId,x:e.clientX,y:e.clientY};
    this.touchWait=setTimeout(()=>{
      if(this.touch&&this.isActive()&&target.isConnected){this.#mark(target);this.page.hoverToggle(target,'toggle');}
      this.touch=null;
    },REST_MS);
  }

  isActive(){
    return this.on&&!!this.s().hover.enabled;
  }

  #modifier(){
    return this.s().hover.modifier;
  }

  #usable(){
    return this.isActive()&&!!this.target&&!this.#typing();
  }

  #typing(){
    return!!editableOf(deepActiveElement())||!!editableOf(this.target);
  }

  #move(e){
    if(this.p.coarse||!this.s().hover.enabled)return;
    if(e.clientX===this.x&&e.clientY===this.y)return; // layout-induced move events
    this.x=e.clientX;
    this.y=e.clientY;
    this.target=e.composedPath()[0]||e.target;
    const mod=this.#modifier();
    if(mod==='none'){
      clearTimeout(this.rest);
      const t=this.target;
      this.rest=setTimeout(()=>{
        if(this.#usable()&&this.target===t)this.page.hoverToggle(t,'translate');
      },REST_MS);
    }else if(this.armed&&this.fired){
      // key still held: moving onto the next paragraph translates it too
      const c=this.#container();
      if(c&&!this.seen.has(c)){
        this.seen.add(c);
        this.#mark(c);
        this.page.hoverToggle(this.target,'translate');
      }
    }
  }

  #container(){
    try{
      return this.target&&this.target.nodeType===1?blockContainerOf(this.target):null;
    }catch{
      return null;
    }
  }

  #keydown(e){
    const cfg=this.s().hover;
    if(!cfg.enabled)return;
    if(cfg.modifier==='none'){
      if(e.key==='Escape'&&this.target)this.page.hoverToggle(this.target,'collapse');
      return;
    }
    if(e.key===cfg.modifier){
      if(e.repeat||this.armed)return;
      this.armed=true;
      this.fired=false;
      this.seen.clear();
      if(this.#usable())this.#mark(this.target);
      clearTimeout(this.hold);
      this.hold=setTimeout(()=>{
        if(!this.armed||!this.#usable())return;
        this.fired=true;
        const c=this.#container();
        if(c)this.seen.add(c);
        this.page.hoverToggle(this.target,'toggle');
      },HOLD_MS);
    }else{
      this.#disarm(); // a chord such as Shift+A, not a hover gesture
    }
  }

  #disarm(){
    this.outline?.detach();
    this.armed=false;
    this.fired=false;
    clearTimeout(this.hold);
  }
}
