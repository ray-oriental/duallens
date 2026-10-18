// Same-origin documents are owned by the nearest controller, never by two controllers.
export function parentOwnsDocument(win = window) {
  try { return win.parent !== win && !!win.parent.document; } catch { return false; }
}

export function frameVisible(frame) {
  const r = frame.getBoundingClientRect();
  if (r.width < 200 || r.height < 100) return false;
  for (let el = frame; el; el = el.parentElement) {
    const s = el.ownerDocument.defaultView.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
  }
  return true;
}

// Map range coordinates through same-origin frame viewports, clipping at each boundary.
export function frameRect(rect, doc, root = document) {
  let r = {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
  while (doc !== root) {
    const win = doc.defaultView, frame = win?.frameElement;
    if (!frame || !frameVisible(frame)) return {left:0,right:0,top:0,bottom:0};
    const box = frame.getBoundingClientRect();
    const sx = box.width / (frame.offsetWidth || box.width), sy = box.height / (frame.offsetHeight || box.height);
    const x = box.left + frame.clientLeft * sx, y = box.top + frame.clientTop * sy;
    r = {left:x + Math.max(0,r.left)*sx,right:x + Math.min(win.innerWidth,r.right)*sx,
      top:y + Math.max(0,r.top)*sy,bottom:y + Math.min(win.innerHeight,r.bottom)*sy};
    doc = frame.ownerDocument;
  }
  return r;
}

export class FrameRoots {
  constructor({doc = document, css = '', added, removed, changed}) {
    Object.assign(this, {doc,css,added,removed,changed});
    this.entries = new Map();
    this.loads = new Map();
    this.refresh = () => this.update();
  }
  start() { this.update(); this.timer = setInterval(this.refresh, 400); }
  update() {
    const seen = new Set([this.doc]), frames = new Set();
    const visit = doc => {
      for (const frame of doc.querySelectorAll('iframe')) {
        frames.add(frame);
        if (!this.loads.has(frame)) { frame.addEventListener('load',this.refresh); this.loads.set(frame,true); }
        if (!frameVisible(frame)) continue;
        let child;
        try { child = frame.contentDocument; } catch { continue; }
        if (!child?.body || !/html/i.test(child.contentType || 'text/html') || seen.has(child)) continue;
        seen.add(child);
        let entry = this.entries.get(child);
        // document.open/write may keep the Document but replace its entire element tree.
        if (entry && entry.body !== child.body) { this.remove(child); entry = null; }
        if (!entry) {
          const style = child.createElement('style');
          style.textContent = this.css;
          (child.head || child.documentElement).append(style);
          entry = {body:child.body,style}; this.entries.set(child,entry);
          this.added(child);
        } else if (!entry.style.isConnected) (child.head || child.documentElement).append(entry.style);
        visit(child);
      }
    };
    visit(this.doc);
    for (const doc of this.entries.keys()) if (!seen.has(doc)) this.remove(doc);
    for (const frame of this.loads.keys()) if (!frames.has(frame)) {frame.removeEventListener('load',this.refresh);this.loads.delete(frame);}
    this.changed?.();
  }
  remove(doc) { const e = this.entries.get(doc); this.entries.delete(doc); this.removed(doc); e.style.remove(); }
  documents() { return [this.doc,...this.entries.keys()]; }
  stop() {
    clearInterval(this.timer);
    for (const frame of this.loads.keys()) frame.removeEventListener('load',this.refresh);
    this.loads.clear();
    for (const doc of this.entries.keys()) this.remove(doc);
  }
}
