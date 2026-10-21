import { t as l10n } from '../../shared/i18n.js';
import { parsePattern } from '../../shared/site-pattern.js';

// Localized copy shared by the extension and lazy userscript UI.
const COPY=Object.freeze({s0:l10n('mi2'),s1:l10n('mi3')});

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
