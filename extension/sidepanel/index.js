import { localize } from '../shared/i18n.js';
localize();
import { createExtensionPlatform } from '../platform/extension.js';
import { mountTextForm } from './text-form.js';
import { mountSubtitleForm } from './subtitle-form.js';
import { engineSummary } from '../ui/components.js';

const platform = createExtensionPlatform();
const privacy=document.createElement('p');privacy.className='dl-status';document.querySelector('.dl-root').insertBefore(privacy,document.querySelector('#text'));
const showDestination=async()=>{privacy.textContent=engineSummary(await platform.settingsStore.load()).full;};
await showDestination();
const off=platform.settingsStore.onChange(showDestination);
const mounted = await Promise.all([mountTextForm(document.querySelector('#text'), { platform }), mountSubtitleForm(document.querySelector('#subtitles'), { platform })]);
window.addEventListener('pagehide', () => { off?.();for (const view of mounted) view.destroy(); }, { once: true });
