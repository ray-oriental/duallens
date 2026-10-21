import { t as l10n } from '../../shared/i18n.js';
import { parsePattern } from '../../shared/site-pattern.js';
import { element } from '../components.js';
export function mountSiteRules(root) {
  const $=id=>root.querySelector('#'+id),json=$('customRules'),fields=['page','selection','hover','input'];
  const parse=()=>JSON.parse(json.value||'[]'),el=(tag,text,attrs)=>element(root.ownerDocument,tag,text,attrs);
  const show=rule=>{$('rule-match').value=rule?.match||'';for(const field of fields)$('rule-'+field).value=rule?.[field]||'default';$('site-rule-editor').hidden=false;$('site-actions').hidden=false;$('site-rule-new').hidden=true;$('rule-match').focus();};
  const advanced=$('site-rule-list').parentElement.querySelector('details');
  const close=()=>{$('site-rule-editor').hidden=true;$('site-rule-new').hidden=false;$('site-actions').hidden=!advanced.open;};
  advanced.addEventListener('toggle',()=>{$('site-actions').hidden=!advanced.open&&$('site-rule-editor').hidden;});
  const draw=()=>{const list=$('site-rule-list');list.replaceChildren();try{const rules=parse();if(!rules.length)list.append(el('p',l10n('polishEmptyRules'),{class:'hint'}));for(const rule of rules){const row=el('div',null,{class:'rule-row'}),edit=el('button',l10n('mic'),{type:'button'});row.append(el('span',rule.match),edit);edit.onclick=()=>show(rule);list.append(row);}}catch{/* The common validator reports malformed advanced JSON. */}};
  $('site-rule-new').onclick=()=>show();$('cancel-sites').addEventListener('click',()=>{close();draw();});
  $('site-rule-add').onclick=()=>{if($('site-rule-editor').hidden){$('save-sites').click();return;}try{const match=$('rule-match').value.trim();if(!parsePattern(match))throw Error();const rules=parse(),rule=rules.find(r=>r.match===match)||{match};for(const f of fields)rule[f]=$('rule-'+f).value;if(!rules.includes(rule))rules.push(rule);json.value=JSON.stringify(rules,null,2);json.dispatchEvent(new Event('input',{bubbles:true}));$('save-sites').click();}catch{$('status').textContent=l10n('mi3');}};
  return {draw,close};
}
