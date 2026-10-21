// This graph runs only after the pinned settings resource has been verified.
import { mountSettingsForm } from '../ui/forms/index.js';
import { createUserscriptMediaPanel } from '../sidepanel/userscript-panel.js';
import { createPopupPanel } from './panel.js';

mountSettingsForm.createMediaPanel = createUserscriptMediaPanel;
mountSettingsForm.createPopupPanel = createPopupPanel;
export { mountSettingsForm };
