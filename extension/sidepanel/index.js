import { localize, initUiLanguage } from '../shared/i18n.js';
import { createExtensionPlatform } from '../platform/extension.js';
import { mountMediaTabs } from './media-tabs.js';
const platform=createExtensionPlatform();
const offLanguage=await initUiLanguage(platform.settingsStore,document);
window.addEventListener('pagehide',offLanguage,{once:true});
const view=await mountMediaTabs(document.querySelector('#tools'),{platform});
window.addEventListener('pagehide',()=>view.destroy(),{once:true});
