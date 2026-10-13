// Long-lived port to the service worker (SPEC §4.1).
//
// The worker can be recycled at any time; when the port drops while requests are outstanding the
// client reconnects and re-sends only the items nobody has answered yet. The worker's cache makes
// the already-translated part of a resent batch come back immediately.

import { PORT_TRANSLATE, MSG_TRANSLATE, MSG_CANCEL, MSG_PARTIAL, MSG_DONE, ERR } from '../shared/protocol.js';
import { contextValid } from './util.js';

const MAX_RECONNECTS = 5;

export class TranslateClient {
  constructor() {
    this.port = null;
    this.seq = 0;
    this.tag = Math.random().toString(36).slice(2, 8);
    this.reqs = new Map(); // reqId -> { msg, remaining:Set, onResults, onDone, attempts }
    this.retryTimer = 0;
  }

  // handlers: { onResults(results[]), onDone() }. Returns the reqId.
  request({ items, priority, to, from = 'auto', context }, handlers) {
    const reqId = `${this.tag}-${++this.seq}`;
    const msg = { type: MSG_TRANSLATE, reqId, to, from, priority, context, items };
    this.reqs.set(reqId, {
      msg,
      remaining: new Set(items.map((i) => i.id)),
      onResults: handlers.onResults,
      onDone: handlers.onDone,
      attempts: 0,
    });
    this.#post(msg);
    return reqId;
  }

  cancel(reqId) {
    if (!this.reqs.delete(reqId)) return;
    if (this.port) {
      try {
        this.port.postMessage({ type: MSG_CANCEL, reqId });
      } catch {
        /* port already gone: nothing left to cancel */
      }
    }
  }

  cancelAll() {
    for (const id of [...this.reqs.keys()]) this.cancel(id);
  }

  outstanding() {
    return this.reqs.size;
  }

  #connect() {
    if (this.port) return this.port;
    if (!contextValid()) return null;
    let port;
    try {
      port = chrome.runtime.connect({ name: PORT_TRANSLATE });
    } catch {
      return null;
    }
    port.onMessage.addListener((m) => this.#onMessage(m));
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
      void chrome.runtime.lastError; // read it so Chrome does not log "Unchecked lastError"
      if (this.reqs.size) this.#scheduleReconnect();
    });
    this.port = port;
    return port;
  }

  #post(msg) {
    const port = this.#connect();
    if (port) {
      try {
        port.postMessage(msg);
        return;
      } catch {
        this.port = null;
      }
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = 0;
      this.#resendAll();
    }, 200);
  }

  #resendAll() {
    if (!contextValid()) return this.#failAll(ERR.CONFIG, '扩展已更新，请刷新页面');
    for (const [reqId, r] of [...this.reqs]) {
      if (++r.attempts > MAX_RECONNECTS) {
        this.#fail(reqId, ERR.NETWORK, '与后台的连接中断');
        continue;
      }
      const items = r.msg.items.filter((i) => r.remaining.has(i.id));
      if (!items.length) {
        this.reqs.delete(reqId);
        r.onDone?.();
        continue;
      }
      const port = this.#connect();
      if (!port) {
        this.#scheduleReconnect();
        return;
      }
      try {
        port.postMessage({ ...r.msg, items });
      } catch {
        this.port = null;
        this.#scheduleReconnect();
        return;
      }
    }
  }

  #fail(reqId, code, message) {
    const r = this.reqs.get(reqId);
    if (!r) return;
    this.reqs.delete(reqId);
    const results = [...r.remaining].map((id) => ({ id, error: { code, message } }));
    if (results.length) r.onResults?.(results);
    r.onDone?.();
  }

  #failAll(code, message) {
    for (const id of [...this.reqs.keys()]) this.#fail(id, code, message);
  }

  #onMessage(m) {
    if (!m || !this.reqs.has(m.reqId)) return;
    const r = this.reqs.get(m.reqId);
    if (m.type === MSG_PARTIAL) {
      const fresh = (m.results || []).filter((x) => r.remaining.delete(x.id));
      if (fresh.length) r.onResults?.(fresh);
    } else if (m.type === MSG_DONE) {
      this.reqs.delete(m.reqId);
      if (r.remaining.size) {
        // the worker finished without answering some ids: surface it instead of spinning forever
        const lost = [...r.remaining].map((id) => ({ id, error: { code: ERR.PARSE, message: '没有收到译文' } }));
        r.remaining.clear();
        r.onResults?.(lost);
      }
      r.onDone?.();
    }
  }

  dispose() {
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.cancelAll();
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
  }
}
