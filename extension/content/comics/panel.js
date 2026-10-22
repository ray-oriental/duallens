import { t as l10n } from '../../shared/i18n.js';
import { BASE_CSS } from '../overlay.js';
const CSS = `:host{display:block;box-sizing:border-box;width:100%;max-width:720px;position:relative;isolation:isolate;margin:12px auto;white-space:normal;text-align:start;writing-mode:horizontal-tb}details.pop{padding:12px 16px;box-shadow:none}summary{cursor:pointer;min-height:28px;font-weight:600}.bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:8px 0}select{max-width:100%;height:32px;padding:0 8px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--dl-border-strong);border-radius:6px;cursor:pointer}ol{margin:8px 0 0;padding-left:22px}li{padding:8px 0}li+li{border-top:1px solid var(--line)}li::marker{color:var(--dl-text-3)}li>p:first-child{color:var(--fg2)}p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:var(--dl-text-3)}.error{color:var(--dl-danger)}@media(max-width:600px){:host{margin:8px 0}details.pop{padding:10px 12px}}`;
const node = (doc,tag,text) => { const el=doc.createElement(tag); if (text!=null) el.textContent=text; return el; };
export function createPanel(candidate, { lang,onRun,onClose,onLanguages,onEnableCanvas }) {
  const doc=candidate.element.ownerDocument;
  const host=node(doc,'dl-comic');
  const root=host.attachShadow({ mode:'closed' });
  const style=node(doc,'style',BASE_CSS+CSS); const wrap=node(doc,'div'); wrap.className='dl-root'; const details=node(doc,'details'); details.className='pop'; details.open=true;
  const summary=node(doc,'summary',l10n('m2p'));
  const privacy=node(doc,'p',l10n('m2q')); privacy.className='muted';
  const select=node(doc,'select'); select.setAttribute('aria-label',l10n('m2r'));
  for (const [code,label] of [['jpn',l10n('m2s')],['jpn_vert',l10n('m2t')],['kor',l10n('m2u')],['eng',l10n('m2v')]]) {
    const opt=node(doc,'option',label); opt.value=code;select.append(opt);
  }
  select.value=lang;
  const run=node(doc,'button',l10n('m2w')); run.type='button'; run.className='pb';
  const close=node(doc,'button',l10n('m2x')); close.type='button'; close.className='tb';
  const packs=node(doc,'button',l10n('m2y')); packs.type='button'; packs.className='tb';
  const status=node(doc,'p',l10n('m2z')); status.setAttribute('role','status');
  const list=node(doc,'ol'); const packList=node(doc,'div');
  const bar=node(doc,'div'); bar.className='bar'; bar.append(select,run,packs,close);
  details.append(summary,privacy,bar,status,list,packList);wrap.append(details);root.append(style,wrap);
  if(onEnableCanvas) {
    const enable=node(doc,'button',l10n('m30'));enable.type='button';enable.className='sb';
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
    Object.assign(highlight.style,{ position:'fixed',pointerEvents:'none',zIndex:'2147483646',border:'2px solid #1c1c1e',boxShadow:'0 0 0 1px rgba(255,255,255,.9),inset 0 0 0 1px rgba(255,255,255,.9)',borderRadius:'2px',boxSizing:'border-box',
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
        const jump=node(doc,'button',l10n('m37')); jump.type='button';jump.className='tb';jump.addEventListener('click',()=>mark(region.bbox));
        const up=node(doc,'button',l10n('m38')); up.type='button';up.className='tb';up.addEventListener('click',()=> { if(li.previousElementSibling) list.insertBefore(li,li.previousElementSibling); });
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
        const del=node(doc,'button',l10n('m3c'));del.type='button';del.className='tb';del.addEventListener('click',async()=>{ const r=await onLanguages(pack.lang);if(r.ok) row.remove();else api.setStatus(l10n('m3d'),true); });row.append(del);packList.append(row);
      }
    } catch(e) { api.setStatus(e.message,true); }
  });
  return api;
}
