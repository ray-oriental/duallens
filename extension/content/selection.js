import { t as l10n } from '../shared/i18n.js';
// Selection UI is created on demand, entirely inside one closed shadow root.
import{lensIcon}from './visual.js';
import{createOverlay}from './overlay.js';
import{deepActiveElement,interactionRequest}from './util.js';
import{LANGS}from '../shared/settings.js';
const UI={get auto(){return l10n('m5e');},get translate(){return l10n('m22');},get result(){return l10n('m5f');},get copy(){return l10n('m5g');},get copied(){return l10n('m55');},get selected(){return l10n('m5h');},
  get speak(){return l10n('m5i');},get more(){return l10n('m4e');},get close(){return l10n('m5j');},get both(){return l10n('m5k');},get only(){return l10n('m4f');},get refine(){return l10n('m5l');},get refining(){return l10n('m5m');},
  get hint(){return l10n('m5n');},get kept(){return l10n('m5o');},
  get profile(){return l10n('m5p');},get model(){return l10n('m5q');},get modelHint(){return l10n('m5r');},get inherit(){return l10n('m5s');},get again(){return l10n('m5t');},
  get off(){return l10n('m5u');},get error(){return l10n('m5v');},get retry(){return l10n('m5d');},get mt(){return l10n('m5w');},get ai(){return l10n('m5x');}};
const CSS=`.icon,.card,.selection-menu{position:fixed}.icon{display:none;width:24px;height:24px;padding:0;border-radius:6px;color:var(--fg2);box-shadow:var(--dl-pop)}.icon.show{display:grid;place-items:center}.icon:hover{color:var(--fg)}.icon svg{width:14px;height:14px}.card{display:none;width:min(360px,calc(100% - 32px));max-width:calc(100% - 32px - var(--safe-left) - var(--safe-right));max-height:70vh;overflow:auto}.card.show{display:block}.head,.foot,.services{display:flex;align-items:center;gap:2px}.head{padding:6px 8px 0 16px;cursor:move;touch-action:none}.title,.engine{flex:1;min-width:0;color:var(--dl-text-3)}.title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.engine:empty{display:none}.x{width:24px;min-width:24px;padding:0;font-size:16px;line-height:1;color:var(--dl-text-3)}.x:hover{color:var(--fg);background:var(--bg2);text-decoration:none}.body{padding:6px 16px 12px;overflow-wrap:anywhere}.src,.dst{margin:0;white-space:pre-wrap}.dst{line-height:1.6}.src{color:var(--fg2);border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.only .src{display:none}.foot{padding:0 8px 8px 16px}.foot:not(:has(.engine:not(:empty),.tool:not([hidden]))){display:none}.dst.err{color:var(--dl-danger)}.dst .retry,.dst .tb{height:24px;min-height:24px;padding:0 6px;color:var(--fg);text-decoration:underline;text-underline-offset:2px}.error-details{display:block;margin-top:8px;color:var(--fg2)}.selection-menu{width:200px;max-width:calc(100% - 32px - var(--safe-left) - var(--safe-right));max-height:60vh;overflow:auto;padding:4px}.selection-menu>button{display:flex;align-items:center;width:100%;height:32px;padding:0 10px;text-align:left;color:var(--fg)}.selection-menu>button:hover{background:var(--bg2);text-decoration:none}.services{flex-wrap:wrap;padding:6px 0 4px}.services input,.services select{width:100%;height:32px;padding:0 8px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--dl-border-strong);border-radius:6px}.services .retry{height:30px;padding:0 12px;color:var(--fg);border:1px solid var(--dl-border-strong);border-radius:8px}.services .retry:hover{background:var(--bg2)}@media(pointer:coarse){.icon{width:44px;height:44px}.icon svg{width:16px;height:16px}.tb,.retry,.dst .tb,.dst .retry{min-width:44px;min-height:44px}.x{width:44px}.selection-menu>button{height:44px}}`;
const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!=null)e.textContent=text;return e;};
const button=(text,fn,title=text)=>{const b=node('button','tool tb',text);b.type='button';b.title=title;b.ariaLabel=title;b.onclick=fn;return b;};
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
    this.#build();this.ui.attach();const icon=this.v.icon,size=this.p.coarse?44:24;
    icon.style.left=clamp(this.p.coarse?rect.left:rect.right+6,4,innerWidth-size-4)+'px';
    icon.style.top=clamp(rect.bottom+6,4,innerHeight-size-4)+'px';icon.classList.add('show');
  }
  #build(){
    if(this.ui)return;this.ui=createOverlay(CSS);const v=this.v={};
    v.icon=button('',()=>{this.#hide();if(this.range)void this.openCard(this.range.text,this.range.rect);},UI.translate);
    v.icon.className='icon pop';v.icon.setAttribute('aria-label',UI.translate);v.icon.append(lensIcon(true));
    v.icon.onpointerdown=v.icon.onmousedown=e=>e.preventDefault();
    v.card=node('section','card pop');v.card.setAttribute('role','dialog');v.card.setAttribute('aria-label',UI.result);
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
    v.more.setAttribute('aria-expanded','false');const x=button('×',()=>this.closeCard(),UI.close);x.className='tb x';v.head.append(v.title,v.copy,v.say,v.more,x);
    v.src=node('p','src');v.dst=node('p','dst');v.dst.setAttribute('aria-live','polite');
    v.body=node('div','body');v.body.append(v.dst,v.src);
    v.by=node('span','engine');v.ai=button(UI.refine,()=>this.#refine(),UI.hint);
    v.foot=node('div','foot');v.foot.append(v.by,v.ai);
    v.menu=node('div','selection-menu pop');v.menu.hidden=true;v.menu.setAttribute('aria-label',UI.more);v.editor=node('div','services');v.editor.hidden=true;
    v.mode=button(UI.both,()=>{this.mode=this.mode==='translation-only'?'bilingual':'translation-only';this.#mode();});
    v.p=node('select','');v.p.setAttribute('aria-label',UI.profile);
    v.m=node('input','');v.m.setAttribute('aria-label',UI.model);v.m.placeholder=UI.modelHint;v.m.maxLength=256;
    v.p.onchange=()=>{v.m.value='';};
    const apply=button(UI.again,()=>{this.pick={profileId:v.p.value,model:v.m.value};void this.openCard(this.r.source,null,true);});apply.className='retry';
    v.editor.append(v.p,v.m,apply);const service=button(l10n('polishService'),()=>{v.editor.hidden=!v.editor.hidden;this.#menuPlace();});v.menu.append(v.mode,service,v.editor,button(UI.off,()=>{this.disable();void this.p.settingsStore.save({selection:{enabled:false}});}));
    v.card.append(v.head,v.body,v.foot);this.ui.el.append(v.icon,v.card,v.menu);
    v.head.onpointerdown=e=>{
      if(e.target.closest('button,input,select'))return;const r=v.card.getBoundingClientRect();v.head.setPointerCapture(e.pointerId);
      v.head.onpointermove=ev=>{this.drag=true;v.card.style.left=clamp(r.left+ev.clientX-e.clientX,16,innerWidth-r.width-16)+'px';v.card.style.top=clamp(r.top+ev.clientY-e.clientY,8,innerHeight-40)+'px';};
      v.head.onpointerup=v.head.onpointercancel=()=>{v.head.onpointermove=null;if(v.head.hasPointerCapture(e.pointerId))v.head.releasePointerCapture(e.pointerId);};
    };
  }
  #mode(){const only=this.mode==='translation-only';this.v.card.classList.toggle('only',only);this.v.mode.textContent=only?l10n('polishDisplayOnly'):UI.both;}
  #menuPlace(){const r=this.v.card.getBoundingClientRect(),m=this.v.menu;m.style.left=clamp(r.right-200,16,innerWidth-216)+'px';m.style.top=clamp(r.bottom+4,8,innerHeight-m.offsetHeight-8)+'px';}
  #place(rect,keep=false){
    const card=this.v.card,r=card.getBoundingClientRect(),width=Math.min(360,innerWidth-32);
    const left=keep&&this.drag?r.left:rect?.left??innerWidth-width-24;
    let top=keep&&this.drag?r.top:rect?.bottom+10||24;
    if(top+r.height>innerHeight-8)top=rect&&!keep?rect.top-r.height-10:innerHeight-r.height-8;
    card.style.width=width+'px';card.style.left=clamp(left,16,innerWidth-width-16)+'px';card.style.top=Math.max(8,top)+'px';
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
