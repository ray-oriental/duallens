import {setUiLanguage} from '../shared/i18n.js';
// This graph runs only after the pinned settings resource has been verified.
import { mountSettingsForm } from '../ui/forms/index.js';
import { createUserscriptMediaPanel } from '../sidepanel/userscript-panel.js';
import { createPopupPanel } from './panel.js';
import { messages } from '../shared/i18n-messages.js';

mountSettingsForm.createMediaPanel = createUserscriptMediaPanel;
mountSettingsForm.createPopupPanel = createPopupPanel;
mountSettingsForm.messages = messages;
mountSettingsForm.setUiLanguage = setUiLanguage;
export { mountSettingsForm };
