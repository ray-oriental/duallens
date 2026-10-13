import { createOverlay } from '../content/overlay.js';
import { LANGS } from '../shared/settings.js';
import { deepActiveElement } from '../content/util.js';

const CSS = `
.backdrop { position: fixed; inset: 0; background: #0006; pointer-events: auto; }
.panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(480px,calc(100vw - 24px));
  max-height: calc(100dvh - 24px); overflow: auto; padding: 20px; border: 1px solid var(--line);
  border-radius: 14px; background: var(--bg); color: var(--fg); pointer-events: auto; box-shadow: var(--shadow); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 18px; margin: 0; }
label { display: flex; flex-direction: column; gap: 6px; margin: 14px 0; }
input, select { width: 100%; min-height: 44px; font: inherit; font-size: 16px; padding: 8px; color: var(--fg); background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; }
button { min-height: 44px; min-width: 44px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg2); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.status { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg2); }
@media (max-width: 599px) {
 .panel { inset: 0; transform: none; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0;
   padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left)); }
}
`;

const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };

// Replace only this function with ui/forms/index.js: mountSettingsForm(root, { store, platform }).
// Stored keys are never rendered. The key editor keeps input in its closure and renders bullets.
export async function mountMinimalSettingsForm(root, { store, platform }) {
  const settings = await store.load();
  const profile = settings.provider.profiles.find((p) => p.id === settings.provider.active) || settings.provider.profiles[0];
  const form = node('form');
  const field = (label, input) => { const wrap = node('label', label); wrap.append(input); form.append(wrap); return input; };
  const target = field('目标语言', node('select'));
  for (const l of LANGS) { const option = node('option', l.name); option.value = l.code; target.append(option); }
  target.value = settings.targetLang;
  const address = field('服务地址', node('input')); address.type = 'url'; address.value = profile.baseUrl || '';
  address.placeholder = 'https://…/v1';
  const model = field('模型', node('input')); model.value = profile.model || '';
  const keyInput = field('API key（留空保留已保存的密钥）', node('input'));
  keyInput.type = 'password'; keyInput.autocomplete = 'off'; keyInput.spellcheck = false;
  keyInput.setAttribute('autocapitalize', 'off');
  let key = '';
  const display = () => { keyInput.value = '•'.repeat(Math.min(key.length, 80)); };
  keyInput.addEventListener('beforeinput', (e) => {
    if (!e.cancelable) return;
    e.preventDefault();
    if (e.inputType.startsWith('delete')) key = key.slice(0, -1);
    else if (e.data && /^[\x20-\x7e]+$/.test(e.data)) key += e.data;
    display();
  });
  keyInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = e.clipboardData?.getData('text') || '';
    if (/^[\x20-\x7e]+$/.test(pasted)) key = pasted.trim();
    display();
  });
  // Autofill/composition is not a supported secret-input path; discard it immediately.
  keyInput.addEventListener('input', display);
  const actions = node('div'); actions.className = 'actions';
  const save = node('button', '保存'); save.type = 'submit';
  const test = node('button', '测试连接'); test.type = 'button';
  const status = node('p'); status.className = 'status'; status.setAttribute('role', 'status');
  actions.append(save, test); form.append(actions, status); root.append(form);
  let busy = false;
  async function persist() {
    const next = { ...profile, baseUrl: address.value.trim(), model: model.value.trim() };
    if (next.kind !== 'mock' && next.kind !== 'gateway') next.kind = 'openai';
    // Remove any legacy value before the public settings leave this form.
    delete next.apiKey;
    if (key) { const value = key; key = ''; display(); await store.setSecret(next.id, value); }
    await store.save({ targetLang: target.value, provider: { active: next.id,
      profiles: settings.provider.profiles.map((p) => p.id === next.id ? next : p) } });
    return next.id;
  }
  async function run(testing) {
    if (busy) return;
    busy = true; save.disabled = test.disabled = true;
    try {
      const id = await persist();
      if (!testing) status.textContent = '已保存';
      else {
        status.textContent = '测试中…';
        const result = await platform.translator().testProvider(id);
        status.textContent = result.ok ? `连接成功（${result.latencyMs} ms）` : '连接失败，请检查服务地址、模型与密钥';
      }
    } catch { status.textContent = '保存或连接失败，请检查配置'; }
    finally { busy = false; save.disabled = test.disabled = false; }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); void run(false); });
  test.addEventListener('click', () => { void run(true); });
  return { destroy() { key = ''; display(); form.remove(); } };
}

export function createSettingsPanel({ store, platform, mountForm = mountMinimalSettingsForm }) {
  let ui = null, mounted = null, previous = null;
  let generation = 0;
  function close() {
    generation++;
    mounted?.destroy?.(); mounted = null;
    ui?.detach(); ui = null;
    previous?.focus?.(); previous = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab' || !ui) return;
    const controls = [...ui.root.querySelectorAll('button,input,select,textarea,[tabindex]')].filter((el) => !el.disabled);
    if (!controls.length) return;
    const current = ui.root.activeElement;
    const index = controls.indexOf(current);
    const next = controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length];
    e.preventDefault(); next.focus();
  }
  return {
    async open() {
      if (ui) return;
      const token = ++generation;
      previous = deepActiveElement();
      ui = createOverlay(CSS);
      const backdrop = node('div'); backdrop.className = 'backdrop'; backdrop.addEventListener('click', close);
      const panel = node('section'); panel.className = 'panel'; panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'DualLens 设置');
      const head = node('div'); head.className = 'head';
      const exit = node('button', '关闭'); exit.type = 'button'; exit.addEventListener('click', close);
      head.append(node('h2', 'DualLens 设置'), exit);
      // Shared-form integration seam, inside the closed shadow root.
      const mount = node('div'); mount.className = 'settings-form-mount';
      panel.append(head, mount); ui.el.append(backdrop, panel); ui.attach();
      document.addEventListener('keydown', onKey, true); exit.focus();
      try {
        const result = await mountForm(mount, { store, platform });
        if (token !== generation) result?.destroy?.(); else mounted = result;
      } catch { if (token === generation) mount.textContent = '设置加载失败，请关闭后重试'; }
    },
    close,
  };
}
