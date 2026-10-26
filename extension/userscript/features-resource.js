// Evaluated only after the install-time cached release asset passes byte/SHA-256 checks.
import { VideoSubtitles } from '../content/subtitles/controller.js';
import { createUserscriptOCR } from '../content/comics/userscript-ocr.js';
import { ComicTranslator } from '../content/comics/controller.js';
import { messages } from '../shared/i18n-messages.js';
import { setUiLanguage } from '../shared/i18n.js';
export { VideoSubtitles, createUserscriptOCR, ComicTranslator, messages, setUiLanguage };
