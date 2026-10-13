import { mountSettingsForm } from '../ui/forms/index.js';

// The shared form uses input.value as its draft-secret interface. Give that form a
// private view of the field while the connected native input contains bullets only.
// No proxy, accessor, key or bridge is attached to a DOM node or to window.
export async function mountPrivateSettingsForm(root, { store, platform }) {
  let container, containerView, input, inputView, formView, secret = '', editing = false;
  const handlers = new Map();
  const cleanups = [];
  const bound = (target, key) => {
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const clear = () => { secret = ''; editing = false; if (input) input.value = ''; };
  function fieldView() {
    if (inputView) return inputView;
    input = container.querySelector('#apiKey');
    const display = () => { input.value = '•'.repeat(Math.min(secret.length, 80)); };
    const changed = () => { display(); input.dispatchEvent(new Event('input', { bubbles: true })); };
    const before = event => {
      if (!event.cancelable) return;
      event.preventDefault();
      if (!editing) { secret = ''; editing = true; }
      if (event.inputType.startsWith('delete')) secret = secret.slice(0, -1);
      else if (event.data && /^[\x20-\x7e]+$/.test(event.data)) secret += event.data;
      changed();
    };
    const paste = event => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text') || '';
      if (/^[\x20-\x7e]+$/.test(text)) { secret = text.trim(); editing = true; changed(); }
    };
    // Unsupported autofill/composition never becomes a persisted secret.
    const sanitize = () => { if (editing) display(); else input.value = ''; };
    for (const [name, fn] of [['beforeinput', before], ['paste', paste], ['input', sanitize]]) {
      input.addEventListener(name, fn); cleanups.push(() => input.removeEventListener(name, fn));
    }
    input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    inputView = new Proxy(input, {
      get(target, key) { return key === 'value' ? secret : bound(target, key); },
      set(target, key, value) {
        if (key !== 'value') return Reflect.set(target, key, value, target);
        // Programmatic profile loads remain blank; stored keys are never backfilled.
        secret = String(value || ''); editing = false; target.value = ''; return true;
      },
    });
    return inputView;
  }
  function eventView(form) {
    if (formView) return formView;
    formView = new Proxy(form, {
      get(target, key) {
        if (key === 'addEventListener') return (name, fn, options) => {
          if (name !== 'input') return target.addEventListener(name, fn, options);
          const listener = event => fn(event.target === input ? new Proxy(event, {
            get(e, prop) { return prop === 'target' ? inputView : bound(e, prop); },
          }) : event);
          handlers.set(fn, listener); target.addEventListener(name, listener, options);
        };
        if (key === 'removeEventListener') return (name, fn, options) => {
          target.removeEventListener(name, handlers.get(fn) || fn, options); handlers.delete(fn);
        };
        return bound(target, key);
      },
    });
    return formView;
  }
  const doc = root.ownerDocument;
  const documentView = new Proxy(doc, {
    get(target, key) {
      if (key !== 'createElement') return bound(target, key);
      return (...args) => {
        const el = target.createElement(...args);
        // drawLayout creates the settings container before its children.
        if (container || args[0] !== 'div') return el;
        container = el;
        containerView = new Proxy(el, {
          get(node, prop) {
            if (prop === 'querySelector') return selector => selector === '#apiKey' ? fieldView()
              : selector === '#settings-form' ? eventView(node.querySelector(selector)) : node.querySelector(selector);
            return bound(node, prop);
          },
        });
        return containerView;
      };
    },
  });
  const rootView = new Proxy(root, {
    get(target, key) {
      if (key === 'ownerDocument') return documentView;
      if (key === 'append') return (...nodes) => target.append(...nodes.map(node => node === containerView ? container : node));
      return bound(target, key);
    },
  });
  const formStore = new Proxy(store, {
    get(target, key) {
      if (key === 'setSecret') return async (id, value) => { await target.setSecret(id, value); clear(); };
      return bound(target, key);
    },
  });
  const destroy = () => { clear(); cleanups.forEach(fn => fn()); handlers.clear(); };
  try {
    const mounted = await mountSettingsForm(rootView, { store: formStore, platform });
    return {
      refresh: () => mounted.refresh(),
      destroy() { mounted.destroy(); destroy(); },
    };
  } catch (error) { destroy(); container?.remove(); throw error; }
}
