import { t as l10n } from '../shared/i18n.js';
import { element, MEDIA_CSS, mountTextForm } from './text-form.js';
import { mountSubtitleForm } from './subtitle-form.js';
import { segmented } from '../ui/components.js';

export async function mountMediaTabs(root,{platform,selected='text'}) {
  const style=element('style',MEDIA_CSS),pages=new Map(),views=[];
  const choose=id=>{for(const [key,page]of pages)page.hidden=key!==id;};
  const tabs=segmented(root.ownerDocument,l10n('ma6'),[['text',l10n('polishTextTab')],['subtitles',l10n('polishSubtitleFiles')]],selected,choose);
  for(const input of tabs.querySelectorAll('input'))input.dataset.tab=input.value;
  root.append(style,tabs);
  for(const [id,mount]of [['text',mountTextForm],['subtitles',mountSubtitleForm]]) {
    const page=element('div');page.id=id;page.className='dl-media-page';page.hidden=id!==selected;root.append(page);pages.set(id,page);
    views.push(await mount(page,{platform}));
  }
  return {destroy(){for(const view of views)view.destroy();root.replaceChildren();}};
}
