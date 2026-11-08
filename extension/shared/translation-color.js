// Page ink choices in hue-wheel order; pairs are for light and dark composited backgrounds.
// Each tier shares one OKLCH lightness and chroma (light 0.52 / 0.12, dark 0.80 / 0.09) so no swatch
// outweighs another; orange is lifted to 0.55 / 0.13 at hue 45 so it reads as orange, not brown.
export const TRANSLATION_COLORS=Object.freeze({
  blue:['#346aac','#97c1f7'],purple:['#7955a0','#cbafed'],orange:['#ae5528','#eead89'],
  green:['#287c42','#94cf9f'],gray:['#656970','#abaeb4'],
});
export function normalizeTranslationColor(value) {
  return typeof value==='string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase()
    : typeof value==='string' && (value==='auto' || Object.hasOwn(TRANSLATION_COLORS,value)) ? value : 'auto';
}
