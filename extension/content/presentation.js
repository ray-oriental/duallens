// Pure presentation policy; computed style is sampled separately in the controller's read phase.
export function denseLinkMenu(el) {
  if(!el?.matches('span,nav,[role="navigation"]') || el.querySelectorAll(':scope > a').length < 3) return false;
  // Link-heavy prose (scores, authors and dates) still needs its sentence context.
  let letters=0;
  for(const n of el.childNodes) {
    if(n.nodeType===1 && n.localName==='a') continue;
    letters +=(n.textContent.match(/\p{L}/gu) || []).length;
  }
  return letters <=12;
}

export function choosePresentation({tag='',role='',textLength=0,words=1,inlineMaxChars=24,title=false,paragraph=false,metadata=false,interactive=false,measuredFailure=false}={}) {
  if(title || /^h[1-6]$/.test(tag)) return 'block';
  if(metadata) return 'inline';
  if(words>3 || paragraph || /^(p|blockquote|li|dd|figcaption)$/.test(tag)) return 'block';
  if(interactive && textLength<=24 && measuredFailure) return 'replace';
  return textLength<=inlineMaxChars || /^(a|button|label|summary|th|legend)$/.test(tag) || /^(button|tab|menuitem|option)$/.test(role)?'inline':'block';
}
const luminance=rgb=> rgb.map(v=> v / 255).map(v=> v <=.04045 ? v / 12.92:((v + .055) / 1.055) ** 2.4)
  .reduce((sum,v,i)=> sum + v * [.2126,.7152,.0722][i],0);
export function contrastRatio(a,b) {
  const x=luminance(a),y=luminance(b);
  return(Math.max(x,y) + .05) /(Math.min(x,y) + .05);
}
export function translationColor(foreground,background) {
  const muted=foreground.map((v,i)=> Math.round(v * .92 + background[i] * .08));
  const color=contrastRatio(muted,background) >=4.5 ? muted:contrastRatio(foreground,background) >=4.5 ? foreground:
    contrastRatio([0,0,0],background) > contrastRatio([255,255,255],background) ? [0,0,0]:[255,255,255];
  return `rgb(${color.join(',')})`;
}

const colorCache=new Map();
let colorContext;
function parseColor(value) {
  if(/^rgba?\(/.test(value)) return value.match(/[\d.]+/g)?.map(Number);
  if(colorCache.has(value)) return colorCache.get(value);
  // CSS Color 4 (including display-p3/oklch) needs conversion, not numeric token extraction.
  colorContext ||=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  if(!colorContext) return null;
  colorContext.clearRect(0,0,1,1); colorContext.fillStyle=value; colorContext.fillRect(0,0,1,1);
  const [r,g,b,a]=colorContext.getImageData(0,0,1,1).data;
  const rgba=[r,g,b,a/255];
  if(colorCache.size >=128) colorCache.clear();
  colorCache.set(value,rgba); return rgba;
}
export function measureColor(host) {
  const parse=parseColor;
  const fg=parse(getComputedStyle(host).color);
  if(!fg || fg.length < 3) return null;
  // Resolve ordinary transparent backgrounds from the outside in. Unpainted pages use the
  // browser canvas colour. Images/gradients remain a visual acceptance case.
  const backgrounds=[];
  for(let el=host; el; el=el.parentElement) {
    const rgba=parse(getComputedStyle(el).backgroundColor);
    if(rgba?.length >=3) backgrounds.unshift(rgba);
  }
  let bg=matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.includes('dark') ? [18,18,18]:[255,255,255];
  for(const c of backgrounds) bg=bg.map((v,i)=> c[i] *(c[3] ?? 1) + v *(1 -(c[3] ?? 1)));
  const color=fg.slice(0,3).map((v,i)=> v *(fg[3] ?? 1) + bg[i] *(1 -(fg[3] ?? 1)));
  return translationColor(color,bg);
}

export function presentationFacts(unit) {
  const h=unit.host,text=unit.plain||h.textContent.trim();
  const control=h.closest('button,select,option,[role="button"],[role="tab"],[role="menuitem"],nav a,header a,[role="navigation"] a');
  const menu=denseLinkMenu(h.parentElement)||denseLinkMenu(h.parentElement?.parentElement);
  const title=!!h.closest('h1,h2,h3,h4,h5,h6,[class*="title" i],[class*="headline" i],[class*="heading" i]') ||(h.localName==='a'&&!control&&!menu&&!h.closest('.subtext'));
  return {tag:h.localName,role:h.getAttribute('role')||'',textLength:text.length,words:text.split(/\s+/).length,title,
    paragraph:unit.paragraph||(!unit.whole&&!!h.querySelector(':scope > br')),metadata:!!h.closest('.subtext,[class~="metadata"]'),interactive:!!control};
}
export function measurePresentation(unit,inlineMaxChars) {
  unit.layoutFacts=presentationFacts(unit);
  const h=unit.host;
  if(!unit.layoutFacts.metadata && [...(h.parentElement?.children||[])].some(el=>el!==h&&el.localName===h.localName&&el.className===h.className&&!el.querySelector('dl-t')&&choosePresentation(presentationFacts({host:el}))==='block')) unit.layoutFacts.title=true;
  return choosePresentation({...unit.layoutFacts,inlineMaxChars});
}
