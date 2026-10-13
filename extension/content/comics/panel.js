const CSS = `:host{display:inline-block;vertical-align:top;width:300px;max-width:100%;position:relative;z-index:2147483600;margin:8px;line-height:1.5;color-scheme:light dark;font:14px system-ui;color:CanvasText}details{border:1px solid GrayText;border-radius:12px;padding:12px;background:Canvas}summary{cursor:pointer;min-height:44px;font-weight:600}button,select{min-height:44px;font:inherit;color:CanvasText;background:Canvas;border:1px solid GrayText;border-radius:6px;cursor:pointer}button{padding:6px 10px}li{margin:12px 0}ol{padding-left:26px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.muted{opacity:.75}.error{color:#c44}@media(max-width:600px){:host{display:block;width:calc(100% - 16px);margin:8px 0}}`;
const node = (doc,tag,text) => { const el=doc.createElement(tag); if (text!=null) el.textContent=text; return el; };
export function createPanel(candidate, { lang,onRun,onClose,onLanguages }) {
  const doc=candidate.element.ownerDocument;
  const host=node(doc,'dl-comic');
  const root=host.attachShadow({ mode:'closed' });
  const style=node(doc,'style',CSS); const details=node(doc,'details'); details.open=true;
  const summary=node(doc,'summary','漫画双语 · 本地 OCR');
  const privacy=node(doc,'p','原图留在本机；仅识别出的文字发往你配置的翻译服务。'); privacy.className='muted';
  const select=node(doc,'select'); select.setAttribute('aria-label','漫画原文语言与方向');
  for (const [code,label] of [['jpn','日文横排'],['jpn_vert','日文竖排'],['kor','韩文'],['eng','英文']]) {
    const opt=node(doc,'option',label); opt.value=code;select.append(opt);
  }
  select.value=lang;
  const run=node(doc,'button','识别并翻译'); run.type='button';
  const close=node(doc,'button','恢复原文'); close.type='button';
  const packs=node(doc,'button','语言包'); packs.type='button';
  const status=node(doc,'p','首次使用会下载并校验所选 fast 语言包。'); status.setAttribute('role','status');
  const list=node(doc,'ol'); const packList=node(doc,'div');
  details.append(summary,privacy,select,run,packs,close,status,list,packList);root.append(style,details);
  candidate.element.after(host);
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
    setStatus(text,error=false) { status.textContent=text;status.className=error?'error':''; },
    busy(value) { run.disabled=value; select.disabled=value; },
    render(regions,uncertain) {
      list.replaceChildren();
      api.setStatus(regions.length ? (uncertain?'顺序可能不确定；可用上移按钮调整。':'识别完成'):'没有找到可信文字；可切换语言/方向重试。');
      for (const region of regions) {
        const li=node(doc,'li'); const original=node(doc,'p',region.text), translated=node(doc,'p','翻译中…');
        const jump=node(doc,'button','高亮区域'); jump.type='button';jump.addEventListener('click',()=>mark(region.bbox));
        const up=node(doc,'button','上移'); up.type='button';up.addEventListener('click',()=> { if(li.previousElementSibling) list.insertBefore(li,li.previousElementSibling); });
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
      if(!result.ok) throw new Error(result.error?.message || '语言包不可用');
      packList.append(node(doc,'p',result.languages.length?'已下载（仅此设备）':'尚未下载语言包'));
      for(const pack of result.languages) {
        const row=node(doc,'p',`${pack.lang} · ${(pack.bytes/1048576).toFixed(2)} MB `);
        const del=node(doc,'button','删除');del.type='button';del.addEventListener('click',async()=>{ const r=await onLanguages(pack.lang);if(r.ok) row.remove();else api.setStatus('语言包删除失败',true); });row.append(del);packList.append(row);
      }
    } catch(e) { api.setStatus(e.message,true); }
  });
  return api;
}
