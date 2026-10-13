import { createExtensionPlatform } from '../platform/extension.js';
import { mountTextForm } from './text-form.js';
import { mountSubtitleForm } from './subtitle-form.js';

const platform = createExtensionPlatform();
const mounted = await Promise.all([mountTextForm(document.querySelector('#text'), { platform }), mountSubtitleForm(document.querySelector('#subtitles'), { platform })]);
window.addEventListener('pagehide', () => { for (const view of mounted) view.destroy(); }, { once: true });
