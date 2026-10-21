import { t as l10n, uiLanguage } from '../shared/i18n.js';
// Page-level UI (selection icon/card, float ball, toasts) lives in closed shadow roots so page CSS
// and scripts can neither restyle nor reach into it. Hosts are <dl-ui> elements on <html>, put in
// the top layer when the browser supports popovers so they stay above modal dialogs.

const HOST_STYLE=[
  'all:initial',
  'display:block',
  'position:fixed',
  'inset:0 auto auto 0',
  'width:0',
  'height:0',
  'overflow:visible',
  'margin:0',
  'padding:0',
  'border:0',
  'background:transparent',
  'pointer-events:none',
  'z-index:2147483647',
]
  .map((d)=>`${d}!important`)
  .join(';');

export const BASE_CSS=`:host{all:initial;}*,*::before,*::after{box-sizing:border-box;}.dl-root{--dl-bg:#f6f6f7;--dl-surface:#fff;--dl-inset:#efeff1;--dl-raised:#fff;--dl-border:#e3e3e8;--dl-border-strong:#7f7f8b;--dl-text:#1c1c21;--dl-text-2:#575762;--dl-text-3:#6b6b76;--dl-accent:#3556d6;--dl-accent-hover:#2a47b8;--dl-accent-soft:#e8edff;--dl-on-accent:#fff;--dl-ok:#17704f;--dl-warn:#8a5a00;--dl-danger:#b3283f;--dl-scrim:rgba(16,18,27,.48);--dl-shadow-2:0 4px 16px rgba(16,18,27,.12),0 0 0 1px rgba(16,18,27,.05);--dl-font:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei UI","Noto Sans CJK SC",sans-serif;--dl-r-sm:8px;--dl-r-md:12px;--dl-dur-1:120ms;--dl-dur-2:180ms;--dl-ease:cubic-bezier(.2,0,0,1);--fg:var(--dl-text);--fg2:var(--dl-text-2);--bg:var(--dl-surface);--bg2:var(--dl-inset);--line:var(--dl-border);--safe-top:env(safe-area-inset-top,0px);--safe-right:env(safe-area-inset-right,0px);--safe-bottom:env(safe-area-inset-bottom,0px);--safe-left:env(safe-area-inset-left,0px);--accent:var(--dl-accent);--accent-fg:var(--dl-on-accent);--danger:var(--dl-warn);--shadow:var(--dl-shadow-2);font:14px/1.5 var(--dl-font);color-scheme:light dark;color:var(--fg);}@media (prefers-color-scheme:dark){.dl-root{--dl-bg:#131316;--dl-surface:#1b1b1f;--dl-inset:#101013;--dl-raised:#2a2a31;--dl-border:#34343c;--dl-border-strong:#82828f;--dl-text:#ececf1;--dl-text-2:#a9a9b5;--dl-text-3:#9494a1;--dl-accent:#8fa5ff;--dl-accent-hover:#a9baff;--dl-accent-soft:#252c4a;--dl-on-accent:#0f1530;--dl-ok:#5fcfa3;--dl-warn:#e3b04b;--dl-danger:#ff8b9c;--dl-scrim:rgba(0,0,0,.6);--dl-shadow-2:0 4px 16px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.06);}}button,select,input{min-height:28px}@media (pointer:coarse){button,select,input:not([type=checkbox]){min-width:44px;min-height:44px;}input,select,textarea{font-size:16px}}button{font:inherit;color:inherit;cursor:pointer;border:0;border-radius:8px;background:transparent;}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}@media(forced-colors:active){button,select,input{border:1px solid CanvasText!important}*:focus-visible{outline-color:Highlight}}`;

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

const UI={close:l10n('m44'),retry:l10n('m5d')};
let toastOverlay=null;
let toastTimer=0;

const TOAST_CSS=`.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:min(420px,calc(100vw - 32px));padding:8px 14px;border-radius:8px;background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow:var(--shadow);pointer-events:auto;display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .15s;}.toast.show{opacity:1;}.toast button{color:var(--accent);flex:none}`;

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
  const message=document.createElement('span');message.textContent=text;
  n.replaceChildren(message);
  if(retry){const b=document.createElement('button');b.textContent=UI.retry;b.onclick=()=>{clearToast();retry();};n.append(b);}
  const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label',UI.close);close.onclick=clearToast;n.append(close);
  n.className=`toast ${kind === 'error' ? 'err' : ''}`;
  void n.offsetWidth; // restart the transition
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(clearToast,ms);
  document.addEventListener('keydown',toastEscape,true);
}

function toastEscape(e){if(e.key==='Escape')clearToast();}

export function clearToast(){
  clearTimeout(toastTimer);
  toastTimer=0;
  document.removeEventListener('keydown',toastEscape,true);
  toastOverlay?.detach();
  toastOverlay=null;
}
