import { t as l10n } from '../shared/i18n.js';
// Input-box translation: press space three times quickly (or Alt+I) in a text field and its
// content is replaced or combined with the translation into settings.input.targetLang. A leading "/ja " style
// prefix overrides the target language for that one translation.

import{LANGS}from '../shared/settings.js';
import{createOverlay,toast}from './overlay.js';
import{deepActiveElement,interactionRequest}from './util.js';

const UI={s0:l10n('m4u'),s1:l10n('m4v'),s2:l10n('m4w'),s3:l10n('m4x'),s4:l10n('m4y'),s5:l10n('m4z'),s6:l10n('m50'),s7:l10n('m51'),s8:l10n('m52'),s9:l10n('m53'),s10:l10n('m54'),s11:l10n('m55'),s12:l10n('m44')};
const node=(tag,cls='',text='')=>Object.assign(document.createElement(tag),{className:cls,textContent:text});
const TEXT_TYPES=new Set(['text','search','url','email','tel']);
const PREFIX=/^\s*\/([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)[ \t ]+/;
const WINDOW_MS=500;

const CHIP_CSS=`.chip{position:fixed;display:none;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--bg);color:var(--fg2);border:1px solid var(--line);box-shadow:var(--shadow);font-size:12px;pointer-events:auto}.chip.show{display:inline-flex}.chip button{color:var(--fg2);padding:0 4px}.spin{width:10px;height:10px;border-radius:50%;border:2px solid var(--accent);border-right-color:transparent;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}`;

// The editable element a key event or focus belongs to, or null. Password fields never qualify.
export function editableOf(node){
  if(!node||node.nodeType!==1)return null;
  const tag=node.tagName;
  if(tag==='TEXTAREA')return node.readOnly||node.disabled?null:node;
  if(tag==='INPUT'){
    const type=(node.getAttribute('type')||'text').toLowerCase();
    if(!TEXT_TYPES.has(type)||node.readOnly||node.disabled)return null;
    return node;
  }
  if(node.isContentEditable){
    let host=node;
    while(host.parentElement&&host.parentElement.isContentEditable)host=host.parentElement;
    return host;
  }
  return null;
}

function resolveLang(code){
  const c=code.toLowerCase();
  const exact=LANGS.find((l)=>l.code.toLowerCase()===c);
  if(exact)return exact.code;
  const base=c.split('-')[0];
  const hit=LANGS.find((l)=>l.code.toLowerCase()===base)||LANGS.find((l)=>l.code.toLowerCase().startsWith(`${base}-`));
  return hit?hit.code:null;
}

// A canonical plain-text view keeps BR/block separators and stable offsets across editor rerenders.
function richText(el,points){
  let text='';
  const add=(value,node,start,after)=>{
    if(points)for(let i=0;i<value.length;i++)points.push([node,start+i]);
    text+=value;
    if(points)points.end=after;
  };
  const walk=node=>{
    if(node.nodeType===3){add(node.data,node,0,[node,node.length]);return;}
    let index=0;
    for(const child of node.childNodes){
      if(child.nodeName==='BR')add('\n',node,index,[node,index+1]);
      else{
        if(/^(DIV|P|LI|BLOCKQUOTE)$/.test(child.nodeName)&&child.previousSibling&&text&&!text.endsWith('\n'))add('\n',node,index,[child,0]);
        walk(child);
      }
      index++;
    }
  };
  walk(el);
  if(points)points.push(points.end||[el,0]);
  return text;
}

export function inputOutput(source,translated,cfg,singleLine){
  if(cfg.mode!=='bilingual')return translated;
  const parts=cfg.order==='translation-first'?[translated,source]:[source,translated];
  return parts.join(singleLine?' ':'\n');
}

export function inputAccessor(el,selected){
  const doc=el.ownerDocument,win=doc.defaultView;
  const field=el.tagName==='INPUT'||el.tagName==='TEXTAREA';
  const current=()=>field?el.value:richText(el);
  const before=current();
  let start=0,end=before.length;
  if(field){
    if(selected&&Number.isInteger(el.selectionStart)&&el.selectionStart!==el.selectionEnd){
      start=el.selectionStart;end=el.selectionEnd;
    }
  }else{
    const sel=win.getSelection();
    if(selected&&sel?.rangeCount&&!sel.isCollapsed&&el.contains(sel.anchorNode)&&el.contains(sel.focusNode)){
      const r=sel.getRangeAt(0),prefix=r.cloneRange();
      prefix.selectNodeContents(el);prefix.setEnd(r.startContainer,r.startOffset);
      start=richText(prefix.cloneContents()).length;
      const selected=richText(r.cloneContents());
      end=start+selected.length;
      if(before.slice(start,end)!==selected)throw Error(UI.s0);
    }
  }
  function select(){
    el.focus();
    if(field){el.setSelectionRange(start,end);return;}
    const points=[];richText(el,points);
    const r=doc.createRange();
    r.setStart(...points[start]);r.setEnd(...points[end]);
    const sel=win.getSelection();sel.removeAllRanges();sel.addRange(r);
    return r;
  }
  const event=(type,out)=>new win.InputEvent(type,{bubbles:true,composed:true,
    cancelable:type==='beforeinput',inputType:'insertText',data:out});
  return{text:before.slice(start,end),current,before,
    async apply(out,valid,writing=()=>{}){
      const expected=before.slice(0,start)+out+before.slice(end);
      const input=()=>el.dispatchEvent(event('input',out));
      const native=()=>{
        const proto=el.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el,expected);input();
      };
      const direct=()=>{
        const range=select(),fragment=doc.createDocumentFragment();
        out.split('\n').forEach((line,i)=>{if(i)fragment.append(doc.createElement('br'));fragment.append(doc.createTextNode(line));});
        range.deleteContents();range.insertNode(fragment);input();
      };
      const strategies=[
        field?native:direct,
        ()=>{select();doc.execCommand('insertText',false,out);},
        ()=>{select();if(el.dispatchEvent(event('beforeinput',out))){if(field)native();else direct();}},
      ];
      for(const write of strategies){
        if(!valid()||current()!==before)return false;
        writing(true);
        try{write();}catch{ /* unsupported strategy: try the next only if unchanged */ }
        finally{writing(false);}
        await new Promise(resolve=>setTimeout(resolve,32));
        if(!valid())return false;
        if(current()===expected)return true;
        if(current()!==before)return false; // unexpected editor/user changes are never overwritten
      }
      return false;
    },
  };
}

export class InputBox{
  constructor({getSettings,platform}){
    this.p=platform;
    this.s=getSettings;
    this.hits=[];
    this.busy=new WeakSet();
    this.ime=new WeakSet();
    this.rev=0;
    this.composition=e=>{
      const el=editableOf(e.composedPath()[0]);
      if(el)this.ime[e.type==='compositionstart'?'add':'delete'](el);
      this.hits.length=0;
    };
    this.on=false;
    this.chip=null;
    this.last=null;
    this.onFocus=(e)=>{
      const target=e.composedPath()[0];
      const editable=editableOf(target);
      if(editable)this.last=editable;
      else if(!e.composedPath().some((n)=>n.localName==='dl-ui'))this.last=null;
    };
    this.key=(e)=>this.#keydown(e);
  }

  enable(){
    if(this.on)return;
    this.on=true;
    document.addEventListener('compositionstart',this.composition,true);
    document.addEventListener('compositionend',this.composition,true);
    document.addEventListener('keydown',this.key,true);
    document.addEventListener('focusin',this.onFocus,true);
  }

  disable(){
    this.on=false;
    this.rev++;this.abort?.abort();
    this.ime=new WeakSet();
    document.removeEventListener('compositionstart',this.composition,true);
    document.removeEventListener('compositionend',this.composition,true);
    document.removeEventListener('keydown',this.key,true);
    document.removeEventListener('focusin',this.onFocus,true);
    this.last=null;
    this.failure?.detach();
    this.chip?.ui.detach();
    this.chip=null;
  }

  #keydown(e){
    const cfg=this.s().input;
    if(!cfg.enabled||cfg.trigger!=='triple-space')return;
    if(e.isComposing||e.keyCode===229||this.ime.has(editableOf(e.composedPath()[0]))){
      this.hits.length=0;
      return;
    }
    if(e.key===' '&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat){
      const el=editableOf(e.composedPath()[0]);
      if(!el){
        this.hits.length=0;
        return;
      }
      if(this.hitElement!==el){this.hits.length=0;this.hitElement=el;}
      const now=performance.now();
      this.hits=this.hits.filter((t)=>now-t<=WINDOW_MS);
      this.hits.push(now);
      if(this.hits.length>=3){
        this.hits.length=0;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.run(el,false);
      }
    }else if(e.key!=='Shift'&&e.key!=='Control'&&e.key!=='Alt'&&e.key!=='Meta'){
      this.hits.length=0;
    }
  }

  // Command path (Alt+I): the focused field, honouring a selection inside it.
  translateFocused(allowRecent=false){
    // Touching a shadow menu may move focus away from the field. Only that explicit menu
    // action may use the last editable; shortcuts retain their focused-field semantics.
    const el=editableOf(deepActiveElement())||(allowRecent&&this.last?.isConnected?editableOf(this.last):null);
    if(!el){
      toast(UI.s1,'error');
      return;
    }
    this.run(el,true);
  }

  #show(el){
    if(!this.chip){
      const ui=createOverlay(CHIP_CSS),n=node('div','chip'),close=node('button','','×');
      close.setAttribute('aria-label',UI.s2);close.onclick=()=>{this.rev++;this.abort?.abort();this.#hide();this.p.settingsStore.save({input:{enabled:false}});};
      n.append(node('i','spin'),document.createTextNode(UI.s3),close);ui.el.append(n);this.chip={ui,node:n};
    }
    const {ui,node:n}=this.chip,r=el.getBoundingClientRect();ui.attach();
    n.style.left=Math.max(4,Math.min(innerWidth-100,r.right-90))+'px';n.style.top=Math.max(4,Math.min(innerHeight-30,r.bottom+4))+'px';n.classList.add('show');
  }

  #hide(){
    this.chip?.node.classList.remove('show');
  }

  async run(el,selected){
    if(this.busy.has(el)||this.ime.has(el)||!editableOf(el))return;
    const cfg=this.s();
    if(!cfg.input.enabled&&!selected)return;
    let acc;
    try{acc=inputAccessor(el,selected);}catch{toast(UI.s4,'error');return;}
    // the first two spaces of a triple-space trigger are already in the field
    let text=selected?acc.text:acc.text.replace(/[  ]+$/,'');
    let target=cfg.input.targetLang;
    if(cfg.input.prefixOverride){
      const m=PREFIX.exec(text);
      const lang=m&&resolveLang(m[1]);
      if(lang){
        target=lang;
        text=text.slice(m[0].length);
      }
    }
    if(!text.trim()){
      toast(UI.s5,'error');
      return;
    }
    const epoch=this.rev;
    let edited=false,writing=false;
    const changed=e=>{if(!writing||e.type==='compositionstart')edited=true;};
    const observer=new MutationObserver(()=>{if(!writing)edited=true;});
    if(el.isContentEditable)observer.observe(el,{subtree:true,childList:true,characterData:true,attributes:true});
    for(const type of['input','beforeinput','compositionstart'])el.addEventListener(type,changed,true);
    const valid=()=>!edited&&this.rev===epoch&&(selected||this.on&&this.s().input.enabled)&&
      el.isConnected&&!!editableOf(el)&&!this.ime.has(el);
    this.abort=new AbortController();
    this.busy.add(el);
    this.#show(el);
    try{
      const res=await this.p.translator().translateText({text,to:target,from:'auto',purpose:'input',signal:this.abort.signal,...interactionRequest(cfg.input)});
      if(!valid())return;
      if(res.error?.code==='CANCELLED')return;
      if(!res.ok||typeof res.text!=='string'||!res.text.trim()){
        toast(UI.s6,'error',4000,()=>this.run(el,selected));return;
      }
      if(acc.current()!==acc.before){toast(UI.s7,'error',3500);return;}
      // Drain pending mutations before allowing our own writes.
      if(observer.takeRecords().length)return;
      observer.disconnect();writing=true;
      const out=inputOutput(text,res.text,cfg.input,el.tagName==='INPUT');
      if(!await acc.apply(out,valid,value=>{writing=value;})&&valid())this.#fallback(res.text);
    }catch{toast(UI.s6,'error',4000,()=>this.run(el,selected));}
    finally{
      observer.disconnect();
      for(const type of['input','beforeinput','compositionstart'])el.removeEventListener(type,changed,true);
      this.busy.delete(el);this.#hide();
    }
  }

  #fallback(text){
    this.failure?.detach();const ui=createOverlay('.failure{position:fixed;bottom:calc(16px + var(--safe-bottom));left:calc(16px + var(--safe-left));width:min(360px,calc(100vw - 32px - var(--safe-left) - var(--safe-right)));padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:12px;pointer-events:auto}.failure textarea{display:block;max-width:100%;width:100%}');
    const box=node('div','failure'),value=node('textarea'),copy=node('button','',UI.s10),close=node('button','',UI.s12);
    box.setAttribute('role','alert');value.readOnly=true;value.value=text;value.setAttribute('aria-label',UI.s9);
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.textContent=UI.s11;}catch{value.select();}};
    close.onclick=()=>ui.detach();box.append(node('p','',UI.s8),value,copy,close);ui.el.append(box);ui.attach();this.failure=ui;
  }
}
