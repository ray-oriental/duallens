import { t as l10n, message, setText, localize, setUiLanguage } from '../shared/i18n.js';
import { element, MEDIA_CSS, mountTextForm } from './text-form.js';
import { mountSubtitleForm } from './subtitle-form.js';
import { segmented } from '../ui/components.js';

export async function mountMediaTabs(root,{platform,selected='text'}) {
  setUiLanguage((await platform.settingsStore.load()).uiLanguage);
  const style=element('style',MEDIA_CSS),pages=new Map(),views=[];
  const choose=id=>{for(const [key,page]of pages)page.hidden=key!==id;};
  const tabs=segmented(root.ownerDocument,message('ma6'),[['text',message('polishTextTab')],['subtitles',message('polishSubtitleFiles')]],selected,choose);
  for(const input of tabs.querySelectorAll('input'))input.dataset.tab=input.value;
  root.append(style,tabs);
  for(const [id,mount]of [['text',mountTextForm],['subtitles',mountSubtitleForm]]) {
    const page=element('div');page.id=id;page.className='dl-media-page';page.hidden=id!==selected;root.append(page);pages.set(id,page);
    views.push(await mount(page,{platform}));
  }
  const off=platform.settingsStore.onChange(async()=>{setUiLanguage((await platform.settingsStore.load()).uiLanguage);localize(root);});
  return {destroy(){off();for(const view of views)view.destroy();root.replaceChildren();}};
}
