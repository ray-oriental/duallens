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

// One lifecycle for accessible iframe Documents and open ShadowRoots. Discovery is event-driven.
export class FrameRoots {
  constructor({doc=document,css='',added,removed,changed}) {
    Object.assign(this,{doc,css,added,removed,changed});
    this.entries=new Map();this.loads=new Set();
    this.refresh=()=>{if(this.running)this.update();};
  }
  start() {
    this.running=true;
    this.resize=new ResizeObserver(this.refresh);
    this.doc.defaultView?.addEventListener('resize',this.refresh);
    this.update();
  }
  update() {
    const seen=new Set([this.doc]),frames=new Set();
    const add=root=>{
      if(seen.has(root))return;
      seen.add(root);
      let entry=this.entries.get(root);
      if(entry && entry.body!==root.body){this.remove(root);entry=null;}
      if(!entry) {
        const style=(root.ownerDocument || root).createElement('style');style.textContent=this.css;
        entry={body:root.body,style};this.entries.set(root,entry);
        (root.head || (root.host ? root:root.documentElement)).append(style);
        this.added(root);
      } else if(!entry.style.isConnected)(root.head || root).append(entry.style);
      visit(root);
    };
    const visit=root=>{
      for(const el of root.querySelectorAll('*')) {
        if(el.shadowRoot && !el.localName.startsWith('dl-'))add(el.shadowRoot);
        if(el.localName!=='iframe')continue;
        frames.add(el);
        if(!this.loads.has(el)){el.addEventListener('load',this.refresh);this.loads.add(el);this.resize?.observe(el);}
        if(!frameVisible(el))continue;
        let child;try{child=el.contentDocument;}catch{continue;}
        if(child?.body && /html/i.test(child.contentType || 'text/html'))add(child);
      }
    };
    visit(this.doc);
    for(const root of this.entries.keys())if(!seen.has(root))this.remove(root);
    for(const el of this.loads)if(!frames.has(el)){el.removeEventListener('load',this.refresh);this.resize?.unobserve(el);this.loads.delete(el);}
    this.changed?.();
  }
  remove(root) {
    const entry=this.entries.get(root);this.entries.delete(root);this.removed(root);entry.style.remove();
  }
  stop() {
    this.running=false;this.resize?.disconnect();
    this.doc.defaultView?.removeEventListener('resize',this.refresh);
    for(const el of this.loads)el.removeEventListener('load',this.refresh);
    this.loads.clear();
    for(const root of this.entries.keys())this.remove(root);
  }
}
