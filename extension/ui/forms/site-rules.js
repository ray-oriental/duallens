import { parsePattern } from '../../shared/site-pattern.js';

// User-visible copy is centralized for the next localization pass.
const COPY=Object.freeze({s0:"规则已加入列表；点击保存设置。",s1:"站点模式或规则 JSON 无效，例如 example.com/docs/*"});

// Shared compact editor; selector/style fields survive updates of an existing pattern.
export function mountSiteRules(root) {
  const $ = id => root.querySelector('#' + id), json = $('customRules');
  const fields = ['page', 'selection', 'hover', 'input'];
  const parse = () => JSON.parse(json.value || '[]');
  const match = () => $('rule-match').value.trim();
  $('rule-match').oninput = () => {
    try {
      const rule = parse().find(r => r.match === match());
      for (const f of fields) $('rule-' + f).value = rule?.[f] || 'default';
    } catch { /* Save reports invalid JSON. */ }
  };
  $('site-rule-add').onclick = () => {
    try {
      if (!parsePattern(match())) throw new Error();
      const rules = parse(), rule = rules.find(r => r.match === match()) || { match: match() };
      for (const f of fields) rule[f] = $('rule-' + f).value;
      if (!rules.includes(rule)) rules.push(rule);
      json.value = JSON.stringify(rules, null, 2);
      json.dispatchEvent(new Event('input', { bubbles: true }));
      $('status').textContent = COPY.s0;
    } catch { $('status').textContent = COPY.s1; }
  };
}
