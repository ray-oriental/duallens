import { uiTranslation } from './ui-glossary.js';
export function metadataTranslation(text,target) {
  if(!uiTranslation('Search',target)) return null;
  const units={second:'秒',minute:'分钟',hour:'小时',day:'天',week:'周',month:'个月',year:'年'};
  return text.trim().replace(/\s+/g,' ')
    .replace(/\b(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi,(_,n,u)=>n+' '+units[u.toLowerCase()]+'前')
    .replace(/\b(\d+)\s+points?\b/gi,'$1 分').replace(/\b(\d+)\s+comments?\b/gi,'$1 条评论')
    .replace(/\bby\s+/gi,'来自 ')
    .replace(/\b(hide|comments?|discuss|reply|root|parent|next|past|favorite)\b/gi,w=>({root:'根评论',parent:'上级',past:'往期',favorite:'收藏'}[w.toLowerCase()]||uiTranslation(w,target)||w));
}
