// Pure presentation policy; computed style is sampled separately in the controller's read phase.
export function denseLinkMenu(el) {
  if (!el?.matches('span,nav,[role="navigation"]') || el.querySelectorAll(':scope > a').length < 3) return false;
  // Link-heavy prose (scores, authors and dates) still needs its sentence context.
  let letters = 0;
  for (const n of el.childNodes) {
    if (n.nodeType === 1 && n.localName === 'a') continue;
    letters += (n.textContent.match(/\p{L}/gu) || []).length;
  }
  return letters <= 12;
}

export function choosePresentation({ tag = '', role = '', textLength = 0, inlineMaxChars = 24,
  whiteSpace = '', overflowX = '', overflowY = '', textOverflow = '', fixedHeight = false,
  singleLineFlex = false, iconOnly = false, paragraph = false } = {}) {
  if (tag === 'option' || iconOnly || whiteSpace === 'nowrap' || /hidden|clip/.test(overflowX) ||
      /hidden|clip/.test(overflowY) || textOverflow === 'ellipsis' || fixedHeight || singleLineFlex) return 'replace';
  if (paragraph || /^(p|blockquote|li|dd|figcaption)$/.test(tag)) return 'block';
  if (textLength <= inlineMaxChars || /^(a|button|label|summary|th|legend|h[1-6])$/.test(tag) ||
      /^(button|tab|menuitem|option|link)$/.test(role)) return 'inline';
  return 'block';
}

const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y) + .05) / (Math.min(x,y) + .05);
}
export function translationColor(foreground, background) {
  const muted = foreground.map((v,i) => Math.round(v * .92 + background[i] * .08));
  const color = contrastRatio(muted,background) >= 4.5 ? muted : contrastRatio(foreground,background) >= 4.5 ? foreground :
    contrastRatio([0,0,0],background) > contrastRatio([255,255,255],background) ? [0,0,0] : [255,255,255];
  return `rgb(${color.join(',')})`;
}

const colorCache = new Map();
let colorContext;
function parseColor(value) {
  if (/^rgba?\(/.test(value)) return value.match(/[\d.]+/g)?.map(Number);
  if (colorCache.has(value)) return colorCache.get(value);
  // CSS Color 4 (including display-p3/oklch) needs conversion, not numeric token extraction.
  colorContext ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!colorContext) return null;
  colorContext.clearRect(0,0,1,1); colorContext.fillStyle = value; colorContext.fillRect(0,0,1,1);
  const [r,g,b,a] = colorContext.getImageData(0,0,1,1).data;
  const rgba = [r,g,b,a/255];
  if (colorCache.size >= 128) colorCache.clear();
  colorCache.set(value,rgba); return rgba;
}
export function measureColor(host) {
  const parse = parseColor;
  const fg = parse(getComputedStyle(host).color);
  if (!fg || fg.length < 3) return null;
  // Resolve ordinary transparent backgrounds from the outside in. Unpainted pages use the
  // browser canvas colour. Images/gradients remain a visual acceptance case.
  const backgrounds = [];
  for (let el = host; el; el = el.parentElement) {
    const rgba = parse(getComputedStyle(el).backgroundColor);
    if (rgba?.length >= 3) backgrounds.unshift(rgba);
  }
  let bg = matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.includes('dark') ? [18,18,18] : [255,255,255];
  for (const c of backgrounds) bg = bg.map((v,i) => c[i] * (c[3] ?? 1) + v * (1 - (c[3] ?? 1)));
  const color = fg.slice(0,3).map((v,i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
  return translationColor(color,bg);
}

export function measurePresentation(unit, inlineMaxChars) {
  const host = unit.host, cs = getComputedStyle(host);
  const control = host.closest('a,button,label,summary,th,[role="button"],[role="tab"],[role="menuitem"]');
  const container = control || host;
  const style = container === host ? cs : getComputedStyle(container);
  const parent = container.parentElement;
  const ps = parent ? getComputedStyle(parent) : null;
  // Computed height is always pixels, even for auto. min/max and authored rules are more useful:
  // a control that cannot fit another line is constrained regardless of where its height came from.
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const compact = container.getBoundingClientRect().height <= line * 1.65 + padding;
  const height = container.computedStyleMap?.().get('height')?.toString() || container.style.height;
  const linkMenu = container.localName === 'a' && denseLinkMenu(parent);
  return choosePresentation({ tag: host.localName, role: host.getAttribute('role') || '',
    textLength: unit.plain.length, inlineMaxChars, whiteSpace: style.whiteSpace,
    overflowX: style.overflowX, overflowY: style.overflowY, textOverflow: style.textOverflow,
    fixedHeight: (!!height && height !== 'auto') || (!!control && compact && /^(button|input)$/.test(container.localName)),
    singleLineFlex: !!control && compact && (linkMenu || (!!ps && /flex/.test(ps.display) && ps.flexWrap === 'nowrap')),
    paragraph: unit.paragraph || (!unit.whole && !!host.querySelector(':scope > br')) });
}
