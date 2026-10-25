import { ERR } from '../shared/protocol.js';
import { initUiLanguage, localize } from '../shared/i18n.js';
import { t as l10n } from '../shared/i18n.js';
import { getDefaultSettingsStore } from '../shared/settings.js';
import { chromeStorageArea } from '../shared/storage-areas.js';
import { mountPopup } from './popup-view.js';
const TEXT={get failed(){return l10n('mj6');}};
try {
  const offLanguage=await initUiLanguage(getDefaultSettingsStore(),document);
  window.addEventListener('pagehide',offLanguage,{once:true});
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const reader=tab?.url?.startsWith(chrome.runtime.getURL('pdf/viewer.html'));
  let restricted=!tab?.id||(!reader&&!/^https?:\/\//.test(tab.url||'')),stale=false,accessError;
  if(!restricted&&!reader)try{
    const r=await chrome.runtime.sendMessage({type:'tab-ensure',tabId:tab.id});
    restricted=r?.ok!==true;accessError=r?.reason==='no-access'?ERR.PERMISSION:r?.reason==='injection-failed'?ERR.INJECTION:ERR.RESTRICTED;
    // A real refusal carries a reason. No answer, or one without a reason, comes from an older background
    // still running after the extension's files changed (developer-mode installs): it needs one reload.
    stale=restricted&&!r?.reason;
  }catch{restricted=true;stale=true;}
  const looksPDF=(()=>{try{return /\.pdf$/i.test(new URL(tab?.url).pathname);}catch{return false;}})();
  const pdf=!reader&&tab?.id&&(restricted||looksPDF)?await chrome.runtime.sendMessage({type:'pdf-status',tabId:tab.id}).catch(()=>null):null;
  if(pdf?.available)accessError=ERR.RESTRICTED;
  const commands=await chrome.commands?.getAll?.()||[];
  const localArea=chromeStorageArea(chrome.storage.local,'local',chrome.storage.onChanged);
  const view=await mountPopup(document.body,{store:getDefaultSettingsStore(),localArea,platform:{kind:'extension',localArea,reloadPage:()=>chrome.tabs.reload(tab.id)},url:tab?.url,restricted,stale,accessError,onReload:()=>chrome.runtime.reload(),
    pdfAvailable:!!pdf?.available,onPDF:async()=>{
      const result=await chrome.runtime.sendMessage({type:'pdf-open',tabId:tab.id});
      if(!result?.ok)throw new Error(result?.error?.message||TEXT.failed);
    },
    shortcut:commands.find(c=>c.name==='toggle-page')?.shortcut||'',pageMessage:msg=>chrome.tabs.sendMessage(tab.id,msg,{frameId:0}),
    onSettings:group=>chrome.tabs.create({url:chrome.runtime.getURL(`ui/options.html#${group}`)}),onText:()=>chrome.sidePanel?.open({tabId:tab.id})});
  window.addEventListener('pagehide',()=>view.destroy(),{once:true});
}catch{document.body.textContent=TEXT.failed;}
