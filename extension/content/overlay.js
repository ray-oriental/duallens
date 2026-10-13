// Page-level UI (selection icon/card, float ball, toasts) lives in closed shadow roots so page CSS
// and scripts can neither restyle nor reach into it. Hosts are <dl-ui> elements on <html>, put in
// the top layer when the browser supports popovers so they stay above modal dialogs.

const HOST_STYLE = [
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
  .map((d) => `${d}!important`)
  .join(';');

export const BASE_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.dl-root {
  --fg: #1f2328; --fg2: #59636e; --bg: #ffffff; --bg2: #f6f8fa; --line: #d1d9e0;
  --accent: #4263eb; --accent-fg: #ffffff; --danger: #cf222e; --shadow: 0 8px 24px rgba(31,35,40,.18);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .dl-root {
    --fg: #e6edf3; --fg2: #9198a1; --bg: #1c2128; --bg2: #262c36; --line: #3d444d;
    --accent: #748ffc; --accent-fg: #101418; --danger: #ff7b72; --shadow: 0 8px 24px rgba(0,0,0,.5);
  }
}
button { font: inherit; color: inherit; cursor: pointer; }
`;

// -> { host, root, el, attach(), detach(), attached }
// `el` is the .dl-root container inside the shadow root; everything visible goes in it.
export function createOverlay(css = '') {
  const host = document.createElement('dl-ui');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = BASE_CSS + css;
  const el = document.createElement('div');
  el.className = 'dl-root';
  root.append(style, el);

  const api = {
    host,
    root,
    el,
    attached: false,
    attach() {
      if (api.attached && host.isConnected) return;
      document.documentElement.appendChild(host);
      try {
        host.popover = 'manual';
        host.showPopover();
      } catch {
        /* no popover support: z-index above is enough for ordinary pages */
      }
      api.attached = true;
    },
    detach() {
      host.remove();
      api.attached = false;
    },
  };
  return api;
}

// ---- toast ---------------------------------------------------------------------------------

let toastOverlay = null;
let toastTimer = 0;

const TOAST_CSS = `
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  max-width: min(420px, calc(100vw - 32px)); padding: 8px 14px; border-radius: 8px;
  background: var(--fg); color: var(--bg); box-shadow: var(--shadow); pointer-events: none;
  opacity: 0; transition: opacity .15s;
}
.toast.show { opacity: 1; }
.toast.err { background: var(--danger); color: #fff; }
`;

export function toast(text, kind = 'info', ms = 2600) {
  if (!toastOverlay) {
    toastOverlay = createOverlay(TOAST_CSS);
    toastOverlay.node = document.createElement('div');
    toastOverlay.node.className = 'toast';
    toastOverlay.el.appendChild(toastOverlay.node);
  }
  toastOverlay.attach();
  const n = toastOverlay.node;
  n.textContent = text;
  n.className = `toast ${kind === 'error' ? 'err' : ''}`;
  void n.offsetWidth; // restart the transition
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(clearToast, ms);
}

export function clearToast() {
  clearTimeout(toastTimer);
  toastTimer = 0;
  toastOverlay?.detach();
  toastOverlay = null;
}
