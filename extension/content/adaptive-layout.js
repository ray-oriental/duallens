import { choosePresentation } from './presentation.js';
const styles=new WeakMap(),groups=new WeakMap();
const signature=el=>el?el.localName+'.'+[...el.classList].filter(x=>!x.startsWith('dl-')).sort().join('.'):'';
export function prepareLayout(u) {
  const h=u.host,p=h.parentElement;
  u.layoutBefore=[h,p].filter(Boolean).map(el=>({el,height:el.getBoundingClientRect().height}));
  const key=[signature(h),signature(p),signature(p?.parentElement),u.presentation].join('|');
  let map=groups.get(p);if(!map) groups.set(p,map=new Map());
  let g=map.get(key);if(!g) map.set(key,g=new Set());g.add(u);u.layoutGroup=g;u.layoutMap=map;u.layoutKey=key;
}
function free(el,u) {
  const existing=styles.get(el);
  if(existing) {existing.owners.add(u);(u.layoutStyles||=new Set()).add(el);return;}
  const cs=getComputedStyle(el),props={},full=!u.layoutFacts?.interactive||u.layoutFacts.title;
  if(full&&(/hidden|clip/.test(cs.overflowX)||/hidden|clip/.test(cs.overflowY))) {props.overflow='visible';props['overflow-x']='visible';props['overflow-y']='visible';}
  if(cs.webkitLineClamp&&cs.webkitLineClamp!=='none') props['-webkit-line-clamp']='unset';
  if(cs.display.includes('webkit')) props.display='block';
  const height=el.computedStyleMap?.().get('height')?.toString()||el.style.height;
  if(height&&height!=='auto') props.height='auto';
  if(cs.maxHeight!=='none') props['max-height']='none';
  if(full&&cs.whiteSpace==='nowrap') props['white-space']='normal';
  if(!Object.keys(props).length) return;
  let r=styles.get(el);if(!r) styles.set(el,r={original:el.getAttribute('style'),owners:new Set(),props:Object.entries(props).map(([k,v])=>[k,v,el.style.getPropertyValue(k),el.style.getPropertyPriority(k)])});
  r.owners.add(u);(u.layoutStyles||=new Set()).add(el);
  for(const [k,v] of Object.entries(props)) el.style.setProperty(k,v,'important');
  r.written=el.getAttribute('style');
}
export function fitLayout(u,apply) {
  const facts=u.layoutFacts||{},eligible=choosePresentation({...facts,measuredFailure:true})==='replace';
  if(eligible) {
    const failed=u.layoutBefore?.some(({el,height})=>{
      const cs=getComputedStyle(el),r=el.getBoundingClientRect(),line=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2;
      return el.scrollWidth>el.clientWidth+2&&el.clientWidth>0 || el.scrollHeight>el.clientHeight+2&&/hidden|clip/.test(cs.overflowY) ||
        r.right>innerWidth+2 || r.height>height+line*.6;
    });
    if(failed && [...u.layoutGroup].every(x=>choosePresentation({...x.layoutFacts,measuredFailure:true})==='replace')) {
      for(const x of u.layoutGroup) {x.presentation='replace';if(x.tEl) {x.tEl.dataset.dlPresentation='replace';apply(x);}}
    }
  } else {
    // Headlines and prose keep both languages. Release clipping locally and in enclosing cards.
    for(let el=u.host,n=0;el&&el!==document.body&&n<5;el=el.parentElement,n++) free(el,u);
  }
}
export function releaseLayout(u) {
  u.layoutGroup?.delete(u);
  if(!u.layoutGroup?.size) u.layoutMap?.delete(u.layoutKey);
  u.layoutGroup=null;
  if(u.presentation==='replace') u.presentation='inline';
  for(const el of u.layoutStyles||[]) {
    const r=styles.get(el);r?.owners.delete(u);
    if(r&&!r.owners.size) {
      if(el.getAttribute('style')===r.written) {if(r.original===null) el.removeAttribute('style');else el.setAttribute('style',r.original);}
      else for(const [k,v,old,priority] of r.props) if(el.style.getPropertyValue(k)===v&&el.style.getPropertyPriority(k)==='important') {if(old) el.style.setProperty(k,old,priority);else el.style.removeProperty(k);}
      styles.delete(el);
    }
  }
  u.layoutStyles=null;
}
