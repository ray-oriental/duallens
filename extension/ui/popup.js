import { getDefaultSettingsStore } from '../shared/settings.js';
import { chromeStorageArea } from '../shared/storage-areas.js';
import { mountPopup } from './popup-view.js';
const TEXT={failed:'设置读取失败，请重新打开。'};
try {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  let restricted=!tab?.id||!/^https?:\/\//.test(tab.url||'');
  // Compatibility with the baseline worker until tab-ensure is integrated.
  if(!restricted)try{const r=await chrome.runtime.sendMessage({type:'tab-ensure',tabId:tab.id});if(r?.ok===false&&['restricted','no-access'].includes(r.reason))restricted=true;}catch{/* Direct content probe below supports the old worker. */}
  const commands=await chrome.commands?.getAll?.()||[];
  const localArea=chromeStorageArea(chrome.storage.local,'local',chrome.storage.onChanged);
  const view=await mountPopup(document.body,{store:getDefaultSettingsStore(),localArea,platform:{kind:'extension',localArea},url:tab?.url,restricted,
    shortcut:commands.find(c=>c.name==='toggle-page')?.shortcut||'',pageMessage:msg=>chrome.tabs.sendMessage(tab.id,msg),
    onSettings:group=>chrome.tabs.create({url:chrome.runtime.getURL(`ui/options.html#${group}`)}),onText:()=>chrome.sidePanel?.open({tabId:tab.id})});
  window.addEventListener('pagehide',()=>view.destroy(),{once:true});
}catch{document.body.textContent=TEXT.failed;}
