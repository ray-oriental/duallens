import { getDefaultSettingsStore } from '../shared/settings.js';
import { chromeStorageArea } from '../shared/storage-areas.js';
import { mountPopup } from './popup-view.js';
const TEXT={failed:'设置读取失败，请重新打开。'};
try {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const reader=tab?.url?.startsWith(chrome.runtime.getURL('pdf/viewer.html'));
  let restricted=!tab?.id||(!reader&&!/^https?:\/\//.test(tab.url||''));
  if(!restricted&&!reader)try{
    const r=await chrome.runtime.sendMessage({type:'tab-ensure',tabId:tab.id});
    restricted=r?.ok!==true;
  }catch{restricted=true;}
  const pdf=!reader&&tab?.id?await chrome.runtime.sendMessage({type:'pdf-status',tabId:tab.id}).catch(()=>null):null;
  const commands=await chrome.commands?.getAll?.()||[];
  const localArea=chromeStorageArea(chrome.storage.local,'local',chrome.storage.onChanged);
  const view=await mountPopup(document.body,{store:getDefaultSettingsStore(),localArea,platform:{kind:'extension',localArea},url:tab?.url,restricted,
    pdfAvailable:!!pdf?.available,onPDF:async()=>{
      const result=await chrome.runtime.sendMessage({type:'pdf-open',tabId:tab.id});
      if(!result?.ok)throw new Error(result?.error?.message||TEXT.failed);
    },
    shortcut:commands.find(c=>c.name==='toggle-page')?.shortcut||'',pageMessage:msg=>chrome.tabs.sendMessage(tab.id,msg,{frameId:0}),
    onSettings:group=>chrome.tabs.create({url:chrome.runtime.getURL(`ui/options.html#${group}`)}),onText:()=>chrome.sidePanel?.open({tabId:tab.id})});
  window.addEventListener('pagehide',()=>view.destroy(),{once:true});
}catch{document.body.textContent=TEXT.failed;}
