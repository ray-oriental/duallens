import { stripMarkup } from './markup.js';
// Explicit LLM-only requests remain unrestricted; automatic page refinement is prose-only.
export function refinementEligible(item) {
  if(item.refine===false) return false;
  const text=stripMarkup(item.text||'').trim();
  const cjk=text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
  return cjk?cjk.length>=12:(text.match(/\p{L}[\p{L}\p{N}'’-]*/gu)||[]).length>=6;
}
