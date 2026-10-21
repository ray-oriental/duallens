// Closed-shadow page control. Position is device-local and scoped to the website.
import{lensIcon}from './visual.js';
import{createOverlay,toast}from './overlay.js';
const UI={toggle:'翻译 / 显示原文',translate:'翻译此页',original:'显示原文',more:'更多',only:'仅译文',site:'本站',
  modes:['按需','总是','从不'],left:'移到左侧',right:'移到右侧',close:'关闭悬浮球',settings:'设置',input:'翻译当前输入框',
  closed:'悬浮球已关闭，可在弹出页重新打开'};
const KEY='dl-ball-pos';
const vw=()=>document.documentElement.clientWidth;
const CSS=`.ball,.more,.menu{position:fixed;pointer-events:auto;background:var(--bg);border:1px solid var(--dl-border-strong);box-shadow:var(--shadow)}.ball{width:36px;height:36px;border-radius:50%;padding:0;display:grid;place-items:center;color:var(--fg2);opacity:.6;touch-action:none;transition:opacity var(--dl-dur-1),transform var(--dl-dur-2)}.ball svg{width:20px;height:20px}.ball:hover,.ball:focus-visible,.ball.open,.ball.drag{opacity:1}.ball.tucked{opacity:.45;transform:translateX(20px)}.ball.tucked.left{transform:translateX(-20px)}.ball::after{content:"";display:none;position:absolute;right:0;bottom:0;width:8px;height:8px;box-sizing:content-box;border:2px solid var(--bg);border-radius:50%;background:var(--accent)}.ball.on::after,.ball.busy::after{display:block}.ball.busy::after{background:transparent;border-color:var(--accent);border-top-color:transparent;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.more{display:none;width:28px;height:28px;padding:0;border-radius:50%}.more.show{display:block}.menu{display:none;width:224px;padding:6px;border-radius:12px;border-color:var(--line);max-height:calc(100dvh - 16px);overflow:auto}.menu.show{display:block}.row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;width:100%;padding:6px 8px;text-align:left}.row:hover{background:var(--bg2)}.row input{accent-color:var(--accent);min-height:24px}.site{display:flex;align-items:center;gap:4px;padding:6px}.site button{padding:4px}.site [aria-pressed=true]{background:var(--dl-accent-soft);color:var(--accent);font-weight:600}@media(pointer:coarse){.ball,.more{width:44px;height:44px}.ball.tucked{transform:translateX(28px)}.ball.tucked.left{transform:translateX(-28px)}.row{min-height:44px}}`;
const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!=null)e.textContent=text;return e;};

export class FloatBall{
  constructor({platform,getSettings,ctx}){
    this.p=platform;this.s=getSettings;this.ctx=ctx;this.size=platform.coarse?44:36;this.on=false;
    this.pos={side:'right',topRatio:.6};
    this.resize=()=>this.#layout();
    this.full=()=>{this.ui.host.style.visibility=document.fullscreenElement?'hidden':'';};
    this.away=e=>{if(!e.composedPath().includes(this.ui.host))this.#menu(false);};
    this.key=e=>{if(e.key==='Escape')this.#menu(false);};
  }
  async enable(){
    if(this.on)return;this.on=true;const version=this.rev=(this.rev||0)+1;
    const s=this.s().floatBall;this.pos={side:s.side,topRatio:s.topRatio};
    try{const got=await this.p.localArea.get(KEY);this.pos=got[KEY]?.[location.hostname]||this.pos;}catch{}
    if(!this.on||version!==this.rev)return;
    if(!this.ui)this.#build();this.ui.attach();this.#layout();this.full();this.refresh();
    window.addEventListener('resize',this.resize);document.addEventListener('fullscreenchange',this.full);
    document.addEventListener('pointerdown',this.away,true);document.addEventListener('keydown',this.key,true);
  }
  disable(){
    this.on=false;this.rev++;clearTimeout(this.idle);clearTimeout(this.hold);this.end?.();
    window.removeEventListener('resize',this.resize);document.removeEventListener('fullscreenchange',this.full);
    document.removeEventListener('pointerdown',this.away,true);document.removeEventListener('keydown',this.key,true);
    this.ui?.detach();this.open=false;
  }
  visible(){return!!(this.on&&this.ui?.host.isConnected&&!document.fullscreenElement);}
  refresh(){if(this.open)this.#menu(true);this.update();this.#wait();}
  update(){if(this.ball){const s=this.ctx.getState();this.ball.classList.toggle('on',!!s.translated);this.ball.classList.toggle('busy',s.pending>0);}}
  #build(){
    this.ui=createOverlay(CSS);this.ball=node('button','ball');this.more=node('button','more','⋯');this.menu=node('div','menu');
    this.ball.type=this.more.type='button';this.ball.setAttribute('aria-label',UI.toggle);
    this.more.setAttribute('aria-label',UI.more);this.ball.append(lensIcon(true));this.ui.el.append(this.ball,this.more,this.menu);
    this.ball.onclick=e=>{if(e.detail===0)this.ctx.toggle();};
    this.ball.onpointerdown=e=>this.#drag(e);
    this.ball.oncontextmenu=e=>{e.preventDefault();this.#menu(true);};
    this.ball.onkeydown=e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();this.#menu(!this.open);}};
    this.more.onclick=()=>this.#menu(!this.open);
    this.more.onpointerdown=e=>e.preventDefault();
    for(const b of[this.ball,this.more]){
      b.onpointerenter=()=>{this.#reveal();this.more.classList.add('show');};b.onpointerleave=()=>this.#wait();
      b.onfocus=()=>{this.#reveal();this.more.classList.add('show');};b.onblur=()=>this.#wait();
    }
  }
  #reveal(){clearTimeout(this.idle);this.ball?.classList.remove('tucked');}
  #wait(){
    clearTimeout(this.idle);
    if(this.s().floatBall.autoHide===false){this.#reveal();return;}
    if(!this.on||this.open)return;
    this.idle=setTimeout(()=>{if(!this.end&&!this.ui.el.querySelector(this.p.coarse?':focus-visible':':hover,:focus-visible')){this.ball.classList.add('tucked');this.more.classList.remove('show');}},2500);
  }
  #layout(){
    if(!this.ball)return;const cs=getComputedStyle(this.ui.el),safe=side=>parseFloat(cs.getPropertyValue('--safe-'+side))||0;
    const left=this.pos.side==='left',size=this.size;
    const x=left?8+safe('left'):vw()-size-8-safe('right');
    const y=Math.max(8+safe('top'),Math.min(innerHeight-size-8-safe('bottom'),this.pos.topRatio*(innerHeight-size)));
    this.ball.style.left=x+'px';this.ball.style.top=y+'px';this.ball.classList.toggle('left',left);
    this.more.style.left=(left?x+size+8:x-size-8)+'px';this.more.style.top=y+'px';
    if(this.open){const r=this.menu.getBoundingClientRect();this.menu.style.left=Math.max(8,Math.min(vw()-r.width-8,left?x+size+12:x-r.width-12))+'px';this.menu.style.top=Math.max(8,Math.min(innerHeight-r.height-8,y))+'px';}
  }
  async#save(){try{const got=await this.p.localArea.get(KEY);await this.p.localArea.set({[KEY]:{...got[KEY],[location.hostname]:this.pos}});}catch{}}
  #drag(e){
    if(e.button!==0||!e.isPrimary)return;e.preventDefault();this.#reveal();const b=this.ball,r=b.getBoundingClientRect();let moved=false,held=false;
    if(e.pointerType==='touch')this.hold=setTimeout(()=>{held=true;this.#menu(true);},500);
    b.setPointerCapture(e.pointerId);
    const move=ev=>{if(ev.pointerId!==e.pointerId||Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)<5&&!moved)return;
      moved=true;clearTimeout(this.hold);this.#menu(false);b.classList.add('drag');
      b.style.left=Math.max(8,Math.min(vw()-this.size-8,r.left+ev.clientX-e.clientX))+'px';b.style.top=Math.max(8,Math.min(innerHeight-this.size-8,r.top+ev.clientY-e.clientY))+'px';};
    const up=ev=>{if(ev.pointerId!==e.pointerId)return;clearTimeout(this.hold);this.end=null;
      b.removeEventListener('pointermove',move);b.removeEventListener('pointerup',up);b.removeEventListener('pointercancel',up);b.classList.remove('drag');
      if(b.hasPointerCapture(e.pointerId))b.releasePointerCapture(e.pointerId);
      if(moved){const rect=b.getBoundingClientRect();this.pos={side:rect.left+this.size/2<vw()/2?'left':'right',topRatio:Math.max(0,Math.min(1,rect.top/Math.max(1,innerHeight-this.size)))};this.#layout();void this.#save();}
      else if(ev.type==='pointerup'&&!held)this.ctx.toggle();this.#wait();};
    this.end=()=>up({pointerId:e.pointerId,type:'pointercancel'});
    b.addEventListener('pointermove',move);b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);
  }
  #menu(open){
    this.open=open;if(!this.menu)return;this.menu.classList.toggle('show',open);this.ball.classList.toggle('open',open);

    if(!open){this.more.classList.remove('show');this.#wait();return;}
    this.#reveal();this.menu.replaceChildren();const s=this.s();
    const action=(label,fn)=>{const b=node('button','row',label);b.type='button';b.onclick=()=>{this.#menu(false);fn();};this.menu.append(b);};
    action(this.ctx.getState().translated?UI.original:UI.translate,()=>this.ctx.toggle());
    const row=node('label','row',UI.only),check=node('input','');check.type='checkbox';check.checked=s.displayMode==='translation-only';check.setAttribute('role','switch');check.onchange=()=>this.ctx.saveSettings({displayMode:check.checked?'translation-only':'bilingual'});row.append(check);this.menu.append(row);
    const site=node('div','site',UI.site);[null,'always','never'].forEach((value,i)=>{const b=node('button','',UI.modes[i]);b.type='button';b.setAttribute('aria-pressed',String(this.ctx.siteMode()===value));b.onclick=()=>{this.#menu(false);this.ctx.setSiteMode(value);};site.append(b);});this.menu.append(site);
    action(this.pos.side==='left'?UI.right:UI.left,()=>{this.pos.side=this.pos.side==='left'?'right':'left';this.#layout();void this.#save();});
    action(UI.input,()=>this.ctx.translateInput());
    action(UI.close,()=>{this.disable();this.ctx.saveSettings({floatBall:{enabled:false}});toast(UI.closed);});
    action(UI.settings,()=>this.ctx.openOptions());this.#layout();
  }
}
