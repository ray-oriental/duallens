import { t as l10n } from '../shared/i18n.js';
export const $ = (id) => document.getElementById(id);
export function options(select, entries, selected) {
  select.replaceChildren();
  for (const entry of entries) {
    const opt = document.createElement('option');
    opt.value = entry.code ?? entry.id ?? entry.value;
    opt.textContent = entry.name ?? entry.label ?? entry.value;
    select.append(opt);
  }
  if (selected != null) select.value = selected;
}
export function notice(text, error = false, id = 'status') {
  const out = $(id); if (!out) return;
  out.textContent = text;
  out.className = `status ${error ? 'error' : 'success'}`;
}
export async function request(type, fields = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...fields }) || { ok:false, error:{get message(){return l10n('m7k');}} }; }
  catch (e) { return { ok:false, error:{message:e.message || String(e)} }; }
}
export function errorText(res) { return res?.error?.message || l10n('maq'); }
export async function busy(button, task) {
  button.disabled = true;
  try { return await task(); } catch (e) { notice(e.message || String(e), true); }
  finally { button.disabled = false; }
}
