// Deterministic English browser environment without changing ICU or host settings.
Object.defineProperty(globalThis.navigator, 'language', { configurable:true, value:'en-US' });
Object.defineProperty(globalThis.navigator, 'languages', { configurable:true, value:['en-US'] });
