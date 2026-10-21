import { t as l10n } from '../shared/i18n.js';
// Selection UI is created on demand, entirely inside one closed shadow root.
import{lensIcon}from './visual.js';
import{createOverlay}from './overlay.js';
import{deepActiveElement,interactionRequest}from './util.js';
import{LANGS}from '../shared/settings.js';
const UI={auto:l10n('m5e'),translate:l10n('m22'),result:l10n('m5f'),copy:l10n('m5g'),copied:l10n('m55'),selected:l10n('m5h'),
  speak:l10n('m5i'),more:l10n('m4e'),close:l10n('m5j'),both:l10n('m5k'),only:l10n('m4f'),refine:l10n('m5l'),refining:l10n('m5m'),
  hint:l10n('m5n'),kept:l10n('m5o'),
  profile:l10n('m5p'),model:l10n('m5q'),modelHint:l10n('m5r'),inherit:l10n('m5s'),again:l10n('m5t'),
  off:l10n('m5u'),error:l10n('m5v'),retry:l10n('m5d'),mt:l10n('m5w'),ai:l10n('m5x')};
const CSS=`.icon,.card{position:fixed;background:var(--bg);border:1px solid var(--line);box-shadow:var(--shadow);pointer-events:auto}.icon{display:none;width:28px;height:28px;border-radius:50%;padding:4px;border-color:var(--dl-border-strong);color:var(--fg2)}.icon.show{display:grid;place-items:center}.icon svg{width:16px;height:16px}.card{display:none;width:320px;max-width:calc(100vw - 16px);max-height:70vh;border-radius:12px;overflow:auto}.card.show{display:block}.head,.foot,.services{display:flex;align-items:center;gap:4px;padding:6px 10px}.head{cursor:move;background:var(--bg2);touch-action:none}.title,.engine{font-size:12px;color:var(--dl-text-3);flex:1}.tool{color:var(--fg2);padding:4px 6px;font-size:12px}[hidden]{display:none!important}.body{padding:12px;overflow-wrap:anywhere}.src,.dst{margin:0;white-space:pre-wrap}.dst{font-size:15px;line-height:1.6}.src{font-size:12.5px;color:var(--fg2);border-top:1px dashed var(--line);padding-top:8px;margin-top:12px}.only .src{display:none}.selection-menu{position:fixed;width:200px;max-width:calc(100vw - 16px);max-height:60vh;overflow:auto;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);pointer-events:auto;padding:4px}.selection-menu>button{display:block;width:100%;text-align:left;padding:8px}.error-details{display:block;margin-top:8px;font-size:12px}.services{flex-wrap:wrap}.services input,.services select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--dl-border-strong);border-radius:8px;width:100%;padding:4px}.retry{padding:6px;color:var(--accent);background:var(--bg2)}.err{color:var(--fg2)}@media(pointer:coarse){.icon{width:44px;height:44px}.tool,.retry{min-width:44px;min-height:44px}}`;
const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!=null)e.textContent=text;return e;};
const button=(text,fn,title=text)=>{const b=node('button','tool',text);b.type='button';b.title=title;b.ariaLabel=title;b.onclick=fn;return b;};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export class SelectionUI{
  constructor({getSettings,platform}){
    this.s=getSettings;this.p=platform;this.rev=0;this.on=false;this.open=false;
    this.event=e=>{
      const type=e.type,sel=getSelection();
      if(type==='keydown'||type==='pointerdown'){
        if(type==='keydown'?e.key==='Escape':!e.composedPath().some(n=>n.localName==='dl-ui')){this.#hide();this.closeCard();}
        return;
      }
      if(type==='scroll'||type==='resize'||!sel||sel.isCollapsed){this.#hide();return;}
      if(type==='keyup'&&!(e.shiftKey&&/^(Arrow|Home|End|Page)/.test(e.key))||
        type==='mouseup'&&e.button!==0||type==='pointerup'&&e.pointerType!=='touch'||
        type==='selectionchange'&&!this.p.coarse||e.composedPath().includes(this.ui?.host))return;
      const run=()=>{if(this.on)this.#check();};
      if(type==='selectionchange'){clearTimeout(this.timer);this.timer=setTimeout(run,100);}else setTimeout(run,0);
    };
  }
  #listen(on){
    for(const type of['mouseup','pointerup','keyup','selectionchange','keydown','pointerdown','scroll','resize'])
      (type==='scroll'||type==='resize'?window:document)[on?'addEventListener':'removeEventListener'](type,this.event,true);
  }
  enable(){if(!this.on){this.on=true;this.#listen(true);}}
  disable(){this.on=false;clearTimeout(this.timer);this.#listen(false);this.#hide();this.closeCard();this.ui?.detach();}
  destroy(){this.disable();this.ui=null;this.v=null;}
  state(){return{selectionIcon:!!this.v?.icon.classList.contains('show'),selectionCard:this.r?{...this.r,visible:this.open}:null};}
  #hide(){this.v?.icon.classList.remove('show');}
  #check(){
    const s=this.s(),sel=getSelection(),active=deepActiveElement();
    if(!s.selection.enabled||active?.matches('input,textarea'))return;
    const text=sel?.toString().trim();if(!text||!sel.rangeCount)return this.#hide();
    const r=sel.getRangeAt(0),rect=[...r.getClientRects()].at(-1)||r.getBoundingClientRect();
    if(!rect.width&&!rect.height)return;
    this.range={text:text.slice(0,4000),rect};
    if(!s.selection.showIcon){void this.openCard(text,rect);return;}
    this.#build();this.ui.attach();const icon=this.v.icon,size=this.p.coarse?44:28;
    icon.style.left=clamp(this.p.coarse?rect.left:rect.right+6,4,innerWidth-size-4)+'px';
    icon.style.top=clamp(rect.bottom+6,4,innerHeight-size-4)+'px';icon.classList.add('show');
  }
  #build(){
    if(this.ui)return;this.ui=createOverlay(CSS);const v=this.v={};
    v.icon=button('',()=>{this.#hide();if(this.range)void this.openCard(this.range.text,this.range.rect);},UI.translate);
    v.icon.className='icon';v.icon.setAttribute('aria-label',UI.translate);v.icon.append(lensIcon(true));
    v.icon.onpointerdown=v.icon.onmousedown=e=>e.preventDefault();
    v.card=node('section','card');v.card.setAttribute('role','dialog');v.card.setAttribute('aria-label',UI.result);
    v.title=node('span','title');v.head=node('div','head');
    v.copy=button(UI.copy,async()=>{
      if(!this.r?.text)return;
      try{await navigator.clipboard.writeText(this.r.text);v.copy.textContent=UI.copied;}
      catch{const range=document.createRange();range.selectNodeContents(v.dst);const sel=this.ui.root.getSelection?.()||getSelection();sel.removeAllRanges();sel.addRange(range);v.copy.textContent=UI.selected;}
      setTimeout(()=>{v.copy.textContent=UI.copy;},1200);
    });
    v.say=button(UI.speak,()=>{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(this.r?.text||'');u.lang=this.s().targetLang;speechSynthesis.speak(u);});
    v.say.hidden=!globalThis.speechSynthesis;
    v.more=button(UI.more,()=>{v.menu.hidden=!v.menu.hidden;v.editor.hidden=true;v.more.setAttribute('aria-expanded',String(!v.menu.hidden));this.#menuPlace();});
    v.more.setAttribute('aria-expanded','false');v.head.append(v.title,v.copy,v.say,v.more,button('×',()=>this.closeCard(),UI.close));
    v.src=node('p','src');v.dst=node('p','dst');v.dst.setAttribute('aria-live','polite');
    v.body=node('div','body');v.body.append(v.dst,v.src);
    v.by=node('span','engine');v.ai=button(UI.refine,()=>this.#refine(),UI.hint);
    v.foot=node('div','foot');v.foot.append(v.by,v.ai);
    v.menu=node('div','selection-menu');v.menu.hidden=true;v.menu.setAttribute('aria-label',UI.more);v.editor=node('div','services');v.editor.hidden=true;
    v.mode=button(UI.both,()=>{this.mode=this.mode==='translation-only'?'bilingual':'translation-only';this.#mode();});
    v.p=node('select','');v.p.setAttribute('aria-label',UI.profile);
    v.m=node('input','');v.m.setAttribute('aria-label',UI.model);v.m.placeholder=UI.modelHint;v.m.maxLength=256;
    v.p.onchange=()=>{v.m.value='';};
    const apply=button(UI.again,()=>{this.pick={profileId:v.p.value,model:v.m.value};void this.openCard(this.r.source,null,true);});apply.className='retry';
    v.editor.append(v.p,v.m,apply);const service=button(l10n('polishService'),()=>{v.editor.hidden=!v.editor.hidden;this.#menuPlace();});v.menu.append(v.mode,service,v.editor,button(UI.off,()=>{this.disable();void this.p.settingsStore.save({selection:{enabled:false}});}));
    v.card.append(v.head,v.body,v.foot);this.ui.el.append(v.icon,v.card,v.menu);
    v.head.onpointerdown=e=>{
      if(e.target.closest('button,input,select'))return;const r=v.card.getBoundingClientRect();v.head.setPointerCapture(e.pointerId);
      v.head.onpointermove=ev=>{this.drag=true;v.card.style.left=clamp(r.left+ev.clientX-e.clientX,8,innerWidth-r.width-8)+'px';v.card.style.top=clamp(r.top+ev.clientY-e.clientY,8,innerHeight-40)+'px';};
      v.head.onpointerup=v.head.onpointercancel=()=>{v.head.onpointermove=null;if(v.head.hasPointerCapture(e.pointerId))v.head.releasePointerCapture(e.pointerId);};
    };
  }
  #mode(){const only=this.mode==='translation-only';this.v.card.classList.toggle('only',only);this.v.mode.textContent=only?l10n('polishDisplayOnly'):UI.both;}
  #menuPlace(){const r=this.v.card.getBoundingClientRect(),m=this.v.menu;m.style.left=clamp(r.right-200,8,innerWidth-208)+'px';m.style.top=clamp(r.bottom+4,8,innerHeight-m.offsetHeight-8)+'px';}
  #place(rect,keep=false){
    const card=this.v.card,r=card.getBoundingClientRect(),width=Math.min(320,innerWidth-16);
    const left=keep&&this.drag?r.left:rect?.left??innerWidth-width-24;
    let top=keep&&this.drag?r.top:rect?.bottom+10||24;
    if(top+r.height>innerHeight-8)top=rect&&!keep?rect.top-r.height-10:innerHeight-r.height-8;
    card.style.width=width+'px';card.style.left=clamp(left,8,innerWidth-width-8)+'px';card.style.top=Math.max(8,top)+'px';
  }
  #render(text){this.v.dst.className='dst';this.v.dst.textContent=text;this.r.text=text;}
  async openCard(text,rect,keep=false){
    const source=String(text||'').trim().slice(0,4000);if(!source)return;
    this.abort?.abort();this.abort=new AbortController();const token=++this.rev,s=this.s();
    this.#build();this.#hide();const v=this.v;
    if(!keep){this.pick={};this.drag=false;v.menu.hidden=true;v.more.setAttribute('aria-expanded','false');}
    this.mode||=s.displayMode;this.#mode();this.open=true;this.r={source,text:'',visible:true};
    const language=code=>LANGS.find(l=>l.code===code)?.name||UI.auto;
    v.title.textContent=language(s.sourceLang)+' → '+language(s.targetLang);v.dst.lang=s.targetLang;
    v.src.textContent=source;v.dst.className='dst';v.dst.textContent='…';v.by.textContent='';
    v.ai.hidden=true;v.ai.disabled=false;v.ai.textContent=UI.refine;v.ai.title=UI.hint;
    v.p.replaceChildren(...[{id:'',name:UI.inherit},...s.provider.profiles].map(p=>{const option=node('option','',p.name||p.id);option.value=p.id;return option;}));
    v.p.value=this.pick.profileId||'';v.m.value=this.pick.model||'';
    v.card.classList.add('show');this.ui.attach();this.#place(rect,keep);
    for(const type of['keydown','pointerdown'])document.addEventListener(type,this.event,true);
    const res=await this.p.translator().translateText({text:source,to:s.targetLang,from:s.sourceLang||'auto',purpose:'selection',signal:this.abort.signal,...interactionRequest(this.pick)}).catch(()=>({ok:false}));
    if(token!==this.rev||!this.open)return;
    if(res.ok){
      this.#render(res.text);v.by.textContent=res.by==='mt'?UI.mt:s.provider.profiles.find(p=>p.id===(this.pick.profileId||s.provider.active))?.name||UI.ai;
      v.ai.hidden=!(res.by==='mt'&&['mt+llm','auto'].includes(s.translation?.mode));
    }else{
      if(res.error?.code==='CANCELLED'){this.closeCard();return;}
      v.dst.className='dst err';v.dst.textContent=UI.error;
      const retry=button(UI.retry,()=>this.openCard(source,rect,true));retry.className='retry';const details=button(l10n('polishDetails'),()=>{v.detail.hidden=!v.detail.hidden;});v.detail=node('small','error-details',res.error?.message||UI.error);v.detail.hidden=true;v.dst.append(document.createTextNode(' '),retry,details,v.detail);
    }
    this.#place(rect,true);
  }
  async#refine(){
    const v=this.v;if(v.ai.disabled||!this.r?.text)return;
    const token=this.rev,s=this.s();v.ai.disabled=true;v.ai.textContent=UI.refining;
    const res=await this.p.translator().translateText({text:this.r.source,to:s.targetLang,from:s.sourceLang||'auto',purpose:'selection',mode:'llm',signal:this.abort.signal}).catch(()=>({ok:false}));
    if(token!==this.rev||!this.open)return;v.ai.textContent=UI.refine;
    if(res.ok){this.#render(res.text);v.ai.hidden=true;}else{v.ai.disabled=false;v.ai.title=UI.kept;}
  }
  closeCard(){
    this.abort?.abort();this.rev++;this.open=false;if(this.r)this.r.visible=false;
    if(this.v){this.v.card.classList.remove('show');this.v.menu.hidden=true;this.v.head.onpointerup?.();}
    if(!this.on)for(const type of['keydown','pointerdown'])document.removeEventListener(type,this.event,true);
    globalThis.speechSynthesis?.cancel();
  }
}
