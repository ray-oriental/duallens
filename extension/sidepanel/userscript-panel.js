import { t as l10n, message, localize, setUiLanguage } from '../shared/i18n.js';
import { createSettingsPanel } from '../userscript/panel.js';
import { element } from './text-form.js';
import { mountMediaTabs } from './media-tabs.js';

// Settings keeps only its seven groups. Text and subtitle files share a tool view.
export function createUserscriptMediaPanel(platform,{loadSettingsForm}) {
  let selected='settings',view=null;
  const panel=createSettingsPanel({store:platform.settingsStore,platform,mountForm:async root=>{
    const mount=selected==='settings'?await loadSettingsForm():null;
    const mounted=mount?await mount(root,{store:platform.settingsStore,platform}):await mountMediaTabs(root,{platform,selected:selected==='subtitles'?'subtitles':'text'});view=mounted;
    const footer=element('footer'),text=element('button',selected==='settings'?message('ma6'):message('m4n'));text.type='button';footer.className='dl-actions';footer.append(text);root.append(footer);
    const off=platform.settingsStore.onChange(async()=>{setUiLanguage((await platform.settingsStore.load()).uiLanguage);localize(footer);});
    text.onclick=()=>{void open(selected==='settings'?'text':'settings');};
    return {...mounted,canClose:()=>view?.canClose?.()??true,destroy(){off();mounted.destroy();view=null;root.replaceChildren();}};
  }});
  async function open(tab='settings') {
    if(view){if(tab==='settings'&&selected==='settings')return view.navigateGroup?.(platform.settingsGroup||'common');if(view.canClose&&!await view.canClose())return;view.canClose=()=>true;panel.close();await new Promise(resolve=>setTimeout(resolve,0));}
    selected=tab;return panel.open();
  }
  return {open,close:panel.close};
}
