import { t } from '../../shared/i18n.js';

// Shared async states for settings, popup and explicitly opened tools.
export function createFeedback(ui) {
  const $ = id => ui.querySelector('#' + id);
  const pending = new Set();
  let closed = false;
  function paint(node, message, error, stamp) {
    if (!node || closed) return;
    node.getAnimations?.().forEach(animation => animation.cancel());
    node.textContent = message ? `${stamp} · ${message}` : '';
    node.classList.toggle('error', error);
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    if (message && !ui.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
      node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  }
  function notice(message, error = false, inline) {
    const stamp = new Date().toTimeString().slice(0, 8);
    paint($('status'), message, error, stamp);
    paint(inline, message, error, stamp);
  }
  async function run(button, fn, { busy = t('actionWorking'), inline = false } = {}) {
    if (!button || closed || button.disabled || pending.has(button)) return;
    pending.add(button);
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busy;
    button.setAttribute('aria-busy', 'true');
    let result;
    if (inline && button.id) {
      result = $('result-' + button.id);
      if (!result) {
        result = ui.ownerDocument.createElement('span');
        result.id = 'result-' + button.id;
        result.className = 'status';
        result.setAttribute('role', 'status');
        button.after(result);
      }
    }
    notice('', false, result);
    const report = (message, error = false) => notice(message, error, result);
    try { return await fn(report); }
    catch (error) { report(error.message || t('maq'), true); }
    finally {
      pending.delete(button);
      if (!closed) {
        button.textContent = label;
        button.removeAttribute('aria-busy');
        button.disabled = false;
      }
    }
  }
  return { notice, run, pending, destroy() { closed = true; } };
}
