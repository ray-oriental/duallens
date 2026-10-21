// Error type shared by providers, queue and translator. `code` is one of protocol.js ERR.

import { ERR } from './protocol.js';

const KNOWN_CODES = new Set(Object.values(ERR));

export class DLError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'DLError';
    this.code = code;
    if (extra.status != null) this.status = extra.status;
    if (extra.retryAfterMs != null) this.retryAfterMs = extra.retryAfterMs;
    if (extra.serverCode != null) this.serverCode = extra.serverCode; // provider machine-readable code
  }
}

export function cancelledError() {
  return new DLError(ERR.CANCELLED, 'cancelled');
}

export function isCancelled(e) {
  return !!e && e.code === ERR.CANCELLED;
}

// Normalises anything thrown into the { code, message } shape carried on the wire.
export function toErrorInfo(e) {
  if (e && KNOWN_CODES.has(e.code)) return { code: e.code, message: String(e.message || e.code) };
  return { code: ERR.PROVIDER, message: String((e && e.message) || e || 'unknown error') };
}
