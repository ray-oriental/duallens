import { t as l10n } from '../shared/i18n.js';
import { createSettingsPanel } from '../userscript/panel.js';
import { element } from './text-form.js';
import { mountMediaTabs } from './media-tabs.js';

// Settings keeps only its seven groups. Text and subtitle files share a tool view.
export function createUserscriptMediaPanel(platform,{loadSettingsForm}) {
  let selected='settings',view=null;
  const panel=createSettingsPanel({store:platform.settingsStore,platform,mountForm:async root=>{
    const mount=selected==='settings'?await loadSettingsForm():null;
    const mounted=mount?await mount(root,{store:platform.settingsStore,platform}):await mountMediaTabs(root,{platform,selected:selected==='subtitles'?'subtitles':'text'});view=mounted;
    const footer=element('footer'),text=element('button',selected==='settings'?l10n('ma6'):l10n('m4n'));text.type='button';footer.className='dl-actions';footer.append(text);root.append(footer);
    text.onclick=()=>{void open(selected==='settings'?'text':'settings');};
    return {...mounted,canClose:()=>view?.canClose?.()??true,destroy(){mounted.destroy();view=null;root.replaceChildren();}};
  }});
  async function open(tab='settings') {
    if(view){if(tab==='settings'&&selected==='settings')return view.navigateGroup?.(platform.settingsGroup||'common');if(view.canClose&&!await view.canClose())return;view.canClose=()=>true;panel.close();await new Promise(resolve=>setTimeout(resolve,0));}
    selected=tab;return panel.open();
  }
  return {open,close:panel.close};
}
