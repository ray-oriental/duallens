import { t as l10n } from '../shared/i18n.js';
// Original local worker: coordinate grouping cannot block the reader's main thread.
// No network, storage, document URL, image bytes or provider configuration is used.
import { segmentPage, estimateWidth } from './segments.js';

const context = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
const widths = new Map();
if (context) context.font = '100px "Times New Roman", Times, serif';
function measure(text) {
  if (!context) return estimateWidth(text);
  if (!widths.has(text)) {
    if (widths.size >= 20000) widths.clear();
    widths.set(text, context.measureText(text).width / 100);
  }
  return widths.get(text);
}
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: segmentPage(data.items, { ...data.options, measure }) });
  } catch {
    self.postMessage({ id: data.id, error: l10n('m6j') });
  }
};
