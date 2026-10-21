import { localize } from '../shared/i18n.js';
import { createExtensionPlatform } from '../platform/extension.js';
import { mountMediaTabs } from './media-tabs.js';
localize();
const view=await mountMediaTabs(document.querySelector('#tools'),{platform:createExtensionPlatform()});
window.addEventListener('pagehide',()=>view.destroy(),{once:true});
