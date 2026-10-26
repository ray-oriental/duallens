import { t as l10n, uiLanguage } from '../shared/i18n.js';
import { renderError } from '../shared/errors.js';
// Page-level UI (selection icon/card, float ball, toasts) lives in closed shadow roots so page CSS
// and scripts can neither restyle nor reach into it. Hosts are <dl-ui> elements on <html>, put in
// the top layer when the browser supports popovers so they stay above modal dialogs.

const HOST_STYLE=[
  'all:initial',
  'display:block',
  'position:fixed',
  'inset:0',
  'contain:strict',
  'overflow:clip',
  'margin:0',
  'padding:0',
  'border:0',
  'background:transparent',
  'pointer-events:none',
  'z-index:2147483647',
]
  .map((d)=>`${d}!important`)
  .join(';');

export const BASE_CSS=`:host{all:initial;}*,*::before,*::after{box-sizing:border-box;}
.dl-root{--dl-bg:#fafaf9;--dl-surface:#fff;--dl-raised:#fff;--dl-inset:rgba(0,0,0,.045);--dl-fill-2:rgba(0,0,0,.1);--dl-border:rgba(0,0,0,.08);--dl-border-strong:rgba(0,0,0,.14);--dl-text:#1c1c1e;--dl-text-2:#5f6066;--dl-text-3:#6e6f75;--dl-accent:#1c1c1e;--dl-accent-hover:#1c1c1e;--dl-accent-soft:rgba(0,0,0,.045);--dl-on-accent:#fff;--dl-ok:#5f6066;--dl-warn:#b3261e;--dl-danger:#b3261e;--dl-knob:#fff;--dl-knob-shadow:0 1px 2px rgba(0,0,0,.2);--dl-selected:#fff;--dl-scrim:rgba(0,0,0,.4);--dl-shadow-2:0 8px 24px rgba(0,0,0,.12);--dl-shadow-3:0 8px 24px rgba(0,0,0,.12);--dl-pop:0 2px 8px rgba(0,0,0,.08);--dl-font:system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei UI",sans-serif;--dl-r-sm:8px;--dl-r-md:12px;--dl-dur-1:120ms;--dl-dur-2:120ms;--dl-ease:ease;--fg:var(--dl-text);--fg2:var(--dl-text-2);--bg:var(--dl-surface);--bg2:var(--dl-inset);--line:var(--dl-border);--safe-top:env(safe-area-inset-top,0px);--safe-right:env(safe-area-inset-right,0px);--safe-bottom:env(safe-area-inset-bottom,0px);--safe-left:env(safe-area-inset-left,0px);--accent:var(--dl-accent);--accent-fg:var(--dl-on-accent);--danger:var(--dl-danger);--shadow:var(--dl-shadow-2);font:13px/1.5 var(--dl-font);-webkit-text-size-adjust:none;text-size-adjust:none;color-scheme:light dark;color:var(--fg);}
@media (prefers-color-scheme:dark){.dl-root{--dl-bg:#1b1b1d;--dl-surface:#2a2a2d;--dl-raised:#2a2a2d;--dl-inset:rgba(255,255,255,.06);--dl-fill-2:rgba(255,255,255,.14);--dl-border:rgba(255,255,255,.08);--dl-border-strong:rgba(255,255,255,.16);--dl-text:#ececee;--dl-text-2:#a1a1a6;--dl-text-3:#909096;--dl-accent:#ececee;--dl-accent-hover:#ececee;--dl-accent-soft:rgba(255,255,255,.06);--dl-on-accent:#1b1b1d;--dl-ok:#a1a1a6;--dl-warn:#f2b8b5;--dl-danger:#f2b8b5;--dl-knob:#d8d8dc;--dl-knob-shadow:none;--dl-selected:#3a3a3e;--dl-scrim:rgba(0,0,0,.6);--dl-shadow-2:0 8px 24px rgba(0,0,0,.5);--dl-shadow-3:0 8px 24px rgba(0,0,0,.5);--dl-pop:0 2px 8px rgba(0,0,0,.4);}}
[hidden]{display:none!important}select,input{min-height:28px}@media (pointer:coarse){button,select,input:not([type=checkbox]){min-width:44px;min-height:44px;}input,select,textarea{font-size:16px}}
button{font:inherit;color:inherit;cursor:pointer;border:0;border-radius:6px;background:transparent;padding:0;}button:disabled{opacity:.5;cursor:default}
button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.pop{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);pointer-events:auto}
.tb{height:28px;padding:0 8px;color:var(--fg2);white-space:nowrap}.tb:hover{color:var(--fg);text-decoration:underline;text-underline-offset:2px}
.pb{height:30px;padding:0 14px;border-radius:8px;background:var(--accent);color:var(--accent-fg);font-weight:500;white-space:nowrap}.pb:hover{opacity:.9}.pb:active{opacity:.82}
.sb{height:30px;padding:0 12px;border:1px solid var(--dl-border-strong);border-radius:8px;color:var(--fg);white-space:nowrap}.sb:hover{background:var(--bg2)}
@keyframes dl-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}@media(forced-colors:active){button,select,input{border:1px solid CanvasText!important}*:focus-visible{outline-color:Highlight}}`;

// Chinese text next to a Latin name or number gets a half-width space (service names are inserted into
// translated sentences). Same rule as ui/components.js spaced(), kept here so page UI never pulls that module in.
export const spaced=text=>uiLanguage()==='zh-CN'?String(text).replace(/(\p{sc=Han})([A-Za-z0-9])/gu,'$1 $2').replace(/([A-Za-z0-9.%])(\p{sc=Han})/gu,'$1 $2'):String(text);

// -> { host, root, el, attach(), detach(), attached }
// `el` is the .dl-root container inside the shadow root; everything visible goes in it.
export function createOverlay(css=''){
  const host=document.createElement('dl-ui');
  host.lang=uiLanguage();
  host.setAttribute('style',HOST_STYLE);
  const root=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=BASE_CSS+css;
  const el=document.createElement('div');
  el.className='dl-root';
  root.append(style,el);

  const api={
    host,
    root,
    el,
    attached:false,
    attach(){
      if(api.attached&&host.isConnected)return;
      document.documentElement.appendChild(host);
      try{
        host.popover='manual';
        host.showPopover();
      }catch{
        /* no popover support: z-index above is enough for ordinary pages */
      }
      api.attached=true;
    },
    detach(){
      host.remove();
      api.attached=false;
    },
  };
  return api;
}

// ---- toast ---------------------------------------------------------------------------------

const UI={get close(){return l10n('m44');},get retry(){return l10n('m5d');}};
let toastOverlay=null;
let toastTimer=0;

const TOAST_CSS=`.toast{position:fixed;left:50%;bottom:calc(16px + var(--safe-bottom));transform:translateX(-50%);width:max-content;max-width:min(360px,calc(100% - 32px - var(--safe-left) - var(--safe-right)));overflow-wrap:anywhere;padding:6px 6px 6px 14px;display:flex;align-items:center;gap:2px;opacity:0;transition:opacity var(--dl-dur-1)}.toast span{min-width:0;flex:1;padding:2px 0}.toast.show{opacity:1}.toast.err span{color:var(--dl-danger)}.toast .x{flex:none;width:24px;min-width:24px;height:24px;color:var(--dl-text-3);font-size:16px;line-height:1}.toast .x:hover{color:var(--fg);background:var(--bg2)}@media(pointer:coarse){.toast .x{width:44px;height:44px}}`;

export function toast(text,kind='info',ms=2600,retry){
  if(!toastOverlay){
    toastOverlay=createOverlay(TOAST_CSS);
    toastOverlay.node=document.createElement('div');
    toastOverlay.node.className='toast';
    toastOverlay.el.appendChild(toastOverlay.node);
  }
  toastOverlay.attach();
  const n=toastOverlay.node;
  n.setAttribute('role','status');
  const message=document.createElement('span');message.textContent=spaced(text);
  n.replaceChildren(message);
  if(retry){const b=document.createElement('button');b.className='tb';b.textContent=UI.retry;b.onclick=()=>{clearToast();retry();};n.append(b);}
  const close=document.createElement('button');close.className='x';close.textContent='×';close.setAttribute('aria-label',UI.close);close.onclick=clearToast;n.append(close);
  n.className=`toast pop${kind === 'error' ? ' err' : ''}`;
  void n.offsetWidth; // restart the transition
  n.classList.add('show');
  clearTimeout(toastTimer);
  if(ms>0)toastTimer=setTimeout(clearToast,ms);
  document.addEventListener('keydown',toastEscape,true);
}

export function errorToast(error, options = {}) {
  toast('', 'error', error?.code === 'mt_fallback' ? 6000 : 0);
  const node = toastOverlay.node;
  renderError(node, error, {...options, buttonClass:'tb'});
  const close=document.createElement('button');close.className='x';close.textContent='×';close.setAttribute('aria-label',UI.close);close.onclick=clearToast;node.append(close);
}

function toastEscape(e){if(e.key==='Escape')clearToast();}

export function clearToast(){
  clearTimeout(toastTimer);
  toastTimer=0;
  document.removeEventListener('keydown',toastEscape,true);
  toastOverlay?.detach();
  toastOverlay=null;
}
