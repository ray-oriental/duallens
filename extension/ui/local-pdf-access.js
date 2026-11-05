import { t, message, setText } from '../shared/i18n.js';
import { element } from './components.js';
import { createFeedback } from './forms/feedback.js';

// Extension-only capability: shared popup/forms never access browser globals.
export function localPDFAccess(api) {
  return {
    allowed: () => api.extension.isAllowedFileSchemeAccess(),
    openDetails: () => api.tabs.create({ url: `chrome://extensions/?id=${api.runtime.id}` }),
    get title() { return t('uxLocalPDF'); },
    status: allowed => t(allowed ? 'uxLocalPDFReadyOn' : 'uxLocalPDFReadyOff'),
    choices(body, enabled, change) {
      const el = (tag, text, attrs) => element(body.ownerDocument, tag, text, attrs);
      body.append(el('p', t('uxLocalPDFIntro')));
      const list = el('div', null, { class: 'dl-choices', role: 'radiogroup', 'aria-label': t('uxLocalPDF') });
      for (const [value, title, hint] of [
        ['on', 'uxLocalPDFEnable', 'uxLocalPDFEnableHint'],
        ['off', 'uxLocalPDFLater', 'uxLocalPDFLaterHint'],
      ]) {
        const row = el('label', null, { class: 'dl-choice' });
        const input = el('input', null, { type: 'radio', name: 'onboard-file-access', value });
        input.checked = (value === 'on') === enabled;
        input.addEventListener('change', () => change(value === 'on'));
        const content = el('span', t(title));
        content.append(el('small', t(hint)));
        row.append(input, content); list.append(row);
      }
      body.append(list);
    },
  };
}

export function mountLocalPDFSettings(root, access) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const el = (tag, text, attrs) => element(doc, tag, text, attrs);
  const section = el('section', null, { id: 'local-pdf-settings' });
  const status = el('span', '', { id: 'local-pdf-status', role: 'status', 'aria-live': 'polite' });
  const open = el('button', t('uxLocalPDFDetails'), { type: 'button', id: 'local-pdf-details', class: 'dl-text-button', 'data-i18n': 'uxLocalPDFDetails' });
  const label = el('div'); label.append(status, el('p', message('uxLocalPDFSettingsHint'), { class: 'hint' }));
  const row = el('div', null, { class: 'frow' }); row.append(label, open);
  section.append(el('h2', message('uxLocalPDF')), row);
  root.querySelector('[data-group="data"] section').after(section);
  const feedback = createFeedback(root);
  open.addEventListener('click', () => { void feedback.run(open, () => access.openDetails()); });
  let revision = 0, closed = false;
  async function refresh() {
    if (doc.visibilityState === 'hidden' || closed) return;
    const current = ++revision;
    try {
      const allowed = await access.allowed();
      if (!closed && current === revision) setText(status, message(allowed ? 'uxLocalPDFOn' : 'uxLocalPDFOff'));
    } catch {
      if (!closed && current === revision) setText(status, message('uxLocalPDFUnknown'));
    }
  }
  doc.addEventListener('visibilitychange', refresh); win.addEventListener('focus', refresh);
  void refresh();
  return () => {
    closed = true; revision++;
    doc.removeEventListener('visibilitychange', refresh); win.removeEventListener('focus', refresh);
    feedback.destroy(); section.remove();
  };
}
