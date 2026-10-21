import { t as l10n } from '../../shared/i18n.js';
const CSS = `:host{display:block;box-sizing:border-box;width:100%;max-width:720px;position:relative;isolation:isolate;margin:12px auto;line-height:1.5;color-scheme:light dark;font:14px system-ui;color:CanvasText;white-space:normal;text-align:start;writing-mode:horizontal-tb}*{box-sizing:border-box}details{border:1px solid GrayText;border-radius:12px;padding:12px;background:Canvas}summary{cursor:pointer;min-height:44px;font-weight:600}button,select{max-width:100%;min-height:44px;font:inherit;color:CanvasText;background:Canvas;border:1px solid GrayText;border-radius:6px;cursor:pointer}button{padding:6px 10px}li{margin:12px 0}ol{padding-left:26px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.muted{opacity:.75}.error{color:#c44}@media(max-width:600px){:host{margin:8px 0}details{padding:10px}}`;
const node = (doc,tag,text) => { const el=doc.createElement(tag); if (text!=null) el.textContent=text; return el; };
export function createPanel(candidate, { lang,onRun,onClose,onLanguages,onEnableCanvas }) {
  const doc=candidate.element.ownerDocument;
  const host=node(doc,'dl-comic');
  const root=host.attachShadow({ mode:'closed' });
  const style=node(doc,'style',CSS); const details=node(doc,'details'); details.open=true;
  const summary=node(doc,'summary',l10n('m2p'));
  const privacy=node(doc,'p',l10n('m2q')); privacy.className='muted';
  const select=node(doc,'select'); select.setAttribute('aria-label',l10n('m2r'));
  for (const [code,label] of [['jpn',l10n('m2s')],['jpn_vert',l10n('m2t')],['kor',l10n('m2u')],['eng',l10n('m2v')]]) {
    const opt=node(doc,'option',label); opt.value=code;select.append(opt);
  }
  select.value=lang;
  const run=node(doc,'button',l10n('m2w')); run.type='button';
  const close=node(doc,'button',l10n('m2x')); close.type='button';
  const packs=node(doc,'button',l10n('m2y')); packs.type='button';
  const status=node(doc,'p',l10n('m2z')); status.setAttribute('role','status');
  const list=node(doc,'ol'); const packList=node(doc,'div');
  details.append(summary,privacy,select,run,packs,close,status,list,packList);root.append(style,details);
  if(onEnableCanvas) {
    const enable=node(doc,'button',l10n('m30'));enable.type='button';
    enable.addEventListener('click',async()=> {
      enable.disabled=true;
      try { if(await onEnableCanvas()) {api.setStatus(l10n('m31'));enable.remove();} else throw new Error(l10n('m32')); }
      catch(e) {api.setStatus(e.message,true);enable.disabled=false;}
    });
    details.append(enable);
  }
  // Do not put interactive controls inside the artwork's full-size image link.
  // Normal document flow reserves space and cannot cover site actions/comments.
  let anchor=candidate.element;
  while(anchor.parentElement?.matches('a,picture')) anchor=anchor.parentElement;
  const figure=anchor.closest('figure');
  if(figure && figure.querySelectorAll('img,canvas').length===1) anchor=figure;
  anchor.after(host);
  let highlight;
  function clearHighlight() { highlight?.remove();highlight=null; }
  const stopHighlight=() => clearHighlight();
  doc.defaultView.addEventListener('scroll',stopHighlight,true);doc.defaultView.addEventListener('resize',stopHighlight);
  function mark(bbox) {
    clearHighlight(); const r=candidate.element.getBoundingClientRect();
    highlight=node(doc,'dl-ui');
    Object.assign(highlight.style,{ position:'fixed',pointerEvents:'none',zIndex:'2147483646',border:'3px solid #e08b12',boxSizing:'border-box',
      left:`${r.left+r.width*bbox.x0}px`,top:`${r.top+r.height*bbox.y0}px`,width:`${r.width*(bbox.x1-bbox.x0)}px`,height:`${r.height*(bbox.y1-bbox.y0)}px` });
    doc.documentElement.append(highlight);
  }
  const api={
    host,lang:()=>select.value,
    setMode(mode) { for(const li of list.children) li.firstElementChild.hidden=mode==='translation-only'; },
    setStatus(text,error=false) { status.textContent=text;status.className=error?'error':''; },
    busy(value) { run.disabled=value; select.disabled=value; },
    render(regions,uncertain) {
      list.replaceChildren();
      api.setStatus(regions.length ? (uncertain?l10n('m33'):l10n('m34')):l10n('m35'));
      for (const region of regions) {
        const li=node(doc,'li'); const original=node(doc,'p',region.text), translated=node(doc,'p',l10n('m36'));
        const jump=node(doc,'button',l10n('m37')); jump.type='button';jump.addEventListener('click',()=>mark(region.bbox));
        const up=node(doc,'button',l10n('m38')); up.type='button';up.addEventListener('click',()=> { if(li.previousElementSibling) list.insertBefore(li,li.previousElementSibling); });
        li.append(original,translated,jump,up);list.append(li);
        region.show=(text,error)=> { translated.textContent=text;translated.className=error?'error':''; };
      }
    },
    state:()=>({ status:status.textContent,items:[...list.children].map((el)=>({ original:el.children[0].textContent,translation:el.children[1].textContent })),language:select.value }),
    destroy() { clearHighlight();host.remove();doc.defaultView.removeEventListener('scroll',stopHighlight,true);doc.defaultView.removeEventListener('resize',stopHighlight); },
  };
  run.addEventListener('click',()=>onRun(api));close.addEventListener('click',onClose);
  packs.addEventListener('click',async()=> {
    packList.replaceChildren();
    try {
      const result=await onLanguages();
      if(!result.ok) throw new Error(result.error?.message || l10n('m39'));
      packList.append(node(doc,'p',result.languages.length?l10n('m3a'):l10n('m3b')));
      for(const pack of result.languages) {
        const row=node(doc,'p',`${pack.lang} · ${(pack.bytes/1048576).toFixed(2)} MB `);
        const del=node(doc,'button',l10n('m3c'));del.type='button';del.addEventListener('click',async()=>{ const r=await onLanguages(pack.lang);if(r.ok) row.remove();else api.setStatus(l10n('m3d'),true); });row.append(del);packList.append(row);
      }
    } catch(e) { api.setStatus(e.message,true); }
  });
  return api;
}
