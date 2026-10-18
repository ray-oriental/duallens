// MV3 service worker. All listeners are registered synchronously at top level so Chrome can wake
// the worker for them. Nothing here relies on in-memory state surviving: if the worker is
// recycled the translate port disconnects and the content script re-sends unfinished items
// (finished ones come back from the cache).

import {
  PORT_TRANSLATE,
  MSG_TRANSLATE,
  MSG_CANCEL,
  MSG_PARTIAL,
  MSG_DONE,
  MSG_COMMAND,
  MSG_GET_STATE,
  MSG_TRANSLATE_SELECTION,
  COMMANDS,
  PRIORITY,
} from '../shared/protocol.js';
import { loadSettings, saveSettings, getDefaultSettingsStore } from '../shared/settings.js';
import { toErrorInfo } from '../shared/errors.js';
import { createProviders } from './providers.js';
import { createQueue } from './queue.js';
import { createCache } from './cache.js';
import { createTranslator } from './translator.js';
import { createHandlers } from './handlers.js';
import { createComicHandlers } from './comics.js';
import { createCanvasRegistry, createImageRegistry } from './comic-sites.js';
import { createPDFEntries } from './pdf.js';
import { registerSidePanelCommand } from './media.js';
import { createSubtitleHandlers } from './subtitles.js';

const queue = createQueue();
const cache = createCache();
const getSecret = id => getDefaultSettingsStore().getSecret(id);
const providers = createProviders({ getSecret });
const translator = createTranslator({ provider: providers.chat, cache, queue, getSettings: loadSettings, getSecret });
const handlers = createHandlers({
  translator,
  cache,
  providers,
  getSettings: loadSettings,
  openOptions: () => chrome.runtime.openOptionsPage(),
});
const imageRegistry=createImageRegistry(chrome,loadSettings);
const comicHandlers=createComicHandlers(chrome);
Object.assign(handlers,comicHandlers);
handlers['comic-ocr']=async(msg,sender)=> {
  await imageRegistry.sync();
  return comicHandlers['comic-ocr'](msg,sender);
};
const pdfEntries = createPDFEntries(chrome);
Object.assign(handlers, pdfEntries.handlers);
Object.assign(handlers, createSubtitleHandlers());
const canvasRegistry=createCanvasRegistry(chrome,loadSettings);
handlers['comic-canvas-sites-sync']=async()=> {await imageRegistry.sync();return canvasRegistry.sync();};
handlers['open-sidepanel'] = async (_msg, sender) => {
  try {
    if (sender.tab?.id == null || !chrome.sidePanel?.open) return { ok: false, error: { code: 'unsupported', message: '请使用 Alt+S 或浏览器侧栏入口' } };
    await chrome.sidePanel.open({ tabId: sender.tab.id });
    return { ok: true };
  } catch { return { ok: false, error: { code: 'unsupported', message: '请使用 Alt+S 或浏览器侧栏入口' } }; }
};
getDefaultSettingsStore().onChange(()=>{void canvasRegistry.sync().catch(()=>{});void imageRegistry.sync().catch(()=>{});});
void canvasRegistry.sync().catch(()=>{});
void imageRegistry.sync().catch(()=>{});

// A pending fetch alone does not stop Chrome from stopping an idle worker after ~30s; any
// extension API call resets that timer, so poke one while work is in flight.
let busy = 0;
let keepAlive = null;
function retain() {
  if (busy++ === 0) {
    keepAlive = setInterval(() => {
      chrome.runtime.getPlatformInfo().catch(() => {});
    }, 20000);
  }
}
function release() {
  if (--busy <= 0) {
    busy = 0;
    clearInterval(keepAlive);
    keepAlive = null;
  }
}

let portSeq = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_TRANSLATE) return;
  if (port.sender && port.sender.id !== chrome.runtime.id) {
    port.disconnect();
    return;
  }
  const portId = ++portSeq;
  const inflight = new Map(); // reqId -> AbortController
  let open = true;
  const post = (m) => {
    if (!open) return;
    try {
      port.postMessage(m);
    } catch {
      open = false;
    }
  };

  function startTranslate(msg) {
    const reqId = msg.reqId;
    if (inflight.has(reqId)) inflight.get(reqId).abort();
    const ctrl = new AbortController();
    inflight.set(reqId, ctrl);
    const items = Array.isArray(msg.items) ? msg.items : [];
    const reported = new Set();
    const priority = [PRIORITY.VISIBLE, PRIORITY.NEAR, PRIORITY.PREFETCH].includes(msg.priority) ? msg.priority : PRIORITY.NEAR;
    retain();
    translator
      .translate(
        { ...msg, items, priority, reqId: `${portId}:${reqId}` },
        {
          signal: ctrl.signal,
          onPartial: (results) => {
            for (const r of results) if (r.stage !== 'draft') reported.add(r.id);
            post({ type: MSG_PARTIAL, reqId, results });
          },
        },
      )
      .catch((e) => {
        // unexpected failure: give every item that has no answer yet an error so the page is not left pending
        const error = toErrorInfo(e);
        const rest = items.filter((it) => it && !reported.has(it.id)).map((it) => ({ id: it.id, error }));
        if (rest.length && !ctrl.signal.aborted) post({ type: MSG_PARTIAL, reqId, results: rest });
      })
      .finally(() => {
        if (inflight.get(reqId) === ctrl) {
          inflight.delete(reqId);
          if (!ctrl.signal.aborted) post({ type: MSG_DONE, reqId });
        }
        release();
      });
  }

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === MSG_TRANSLATE) startTranslate(msg);
    else if (msg.type === MSG_CANCEL) {
      const ctrl = inflight.get(msg.reqId);
      if (ctrl) {
        ctrl.abort();
        inflight.delete(msg.reqId);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    open = false;
    for (const ctrl of inflight.values()) ctrl.abort();
    inflight.clear();
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  retain();
  handler(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: toErrorInfo(e) }))
    .finally(release);
  return true;
});

// ---- tab messaging, shortcuts, context menu ------------------------------------------------

function sendToTab(tabId, message) {
  if (tabId == null) return Promise.resolve(null);
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => null);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

const KNOWN_COMMANDS = new Set(Object.values(COMMANDS));
registerSidePanelCommand(chrome);
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!KNOWN_COMMANDS.has(command)) return;
  await sendToTab(tab && tab.id != null ? tab.id : await activeTabId(), { type: MSG_COMMAND, name: command });
});

const MENU = {
  TEXT: 'dl-open-text',
  SUBTITLES: 'dl-toggle-subtitles',
  COMICS: 'dl-translate-comics',
  TOGGLE: 'dl-toggle-page',
  SELECTION: 'dl-translate-selection',
  ALWAYS: 'dl-site-always',
  NEVER: 'dl-site-never',
};

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    const add = (props) => chrome.contextMenus.create(props, () => void chrome.runtime.lastError);
    add({ id: MENU.TOGGLE, title: '翻译此页 / 恢复原文', contexts: ['page', 'link', 'image'] });
    add(pdfEntries.menu);
    add({ id: MENU.TEXT, title: 'DualLens 文本翻译', contexts: ['page', 'selection'] });
    add({ id: MENU.SUBTITLES, title: '启用 / 恢复 YouTube 双语字幕', contexts: ['video', 'page'], documentUrlPatterns: ['https://www.youtube.com/*', 'https://m.youtube.com/*'] });
    add({ id: MENU.COMICS, title: '翻译此页漫画', contexts: ['page', 'image'] });
    add({ id: MENU.SELECTION, title: '翻译选中文字', contexts: ['selection'] });
    add({ id: MENU.ALWAYS, title: '总是翻译此网站', contexts: ['page'] });
    add({ id: MENU.NEVER, title: '从不翻译此网站', contexts: ['page'] });
  });
}
chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);

function hostnameOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

// Moves `host` into the `mode` list ('always' | 'never') and out of the other one.
async function setSiteRule(host, mode) {
  const { siteRules } = await loadSettings();
  const always = siteRules.always.filter((p) => p !== host);
  const never = siteRules.never.filter((p) => p !== host);
  (mode === 'always' ? always : never).push(host);
  await saveSettings({ siteRules: { always, never } });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab && tab.id;
  switch (info.menuItemId) {
    case pdfEntries.menu.id:
      await pdfEntries.openFromMenu(tab);
      break;
    case MENU.TEXT:
      await chrome.sidePanel.open({ tabId }).catch(() => {});
      break;
    case MENU.SUBTITLES:
      await sendToTab(tabId, { type: MSG_COMMAND, name: 'toggle-subtitles' });
      break;
    case MENU.COMICS:
      await sendToTab(tabId, { type: MSG_COMMAND, name: 'translate-comics' });
      break;
    case MENU.TOGGLE:
      await sendToTab(tabId, { type: MSG_COMMAND, name: COMMANDS.TOGGLE_PAGE });
      break;
    case MENU.SELECTION:
      if (info.selectionText) await sendToTab(tabId, { type: MSG_TRANSLATE_SELECTION, text: info.selectionText });
      break;
    case MENU.ALWAYS:
    case MENU.NEVER: {
      const host = hostnameOf(info.pageUrl || (tab && tab.url));
      if (!host) break;
      const always = info.menuItemId === MENU.ALWAYS;
      await setSiteRule(host, always ? 'always' : 'never');
      // act on the current page right away so the choice is visible
      const state = await sendToTab(tabId, { type: MSG_GET_STATE });
      if (state && state.translated !== always) await sendToTab(tabId, { type: MSG_COMMAND, name: COMMANDS.TOGGLE_PAGE });
      break;
    }
  }
});
