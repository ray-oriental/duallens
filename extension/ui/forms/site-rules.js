import { t as l10n } from '../../shared/i18n.js';
import { parsePattern } from '../../shared/site-pattern.js';
import { element } from '../components.js';
export function mountSiteRules(root,{save,notice}) {
  const $=id=>root.querySelector('#'+id),json=$('customRules'),fields=['page','selection','hover','input'];
  let editing=null;
  const parse=()=>JSON.parse(json.value||'[]'),el=(tag,text,attrs)=>element(root.ownerDocument,tag,text,attrs);
  const show=rule=>{editing=rule?.match??null;$('rule-match').value=rule?.match||'';for(const field of fields)$('rule-'+field).value=rule?.[field]||'default';$('site-rule-editor').hidden=false;$('site-actions').hidden=false;$('site-rule-new').hidden=true;$('site-rule-delete').hidden=editing===null;$('rule-match').focus();};
  const advanced=$('site-rule-list').parentElement.querySelector('details');
  const close=()=>{editing=null;$('site-rule-editor').hidden=true;$('site-rule-new').hidden=false;$('site-rule-delete').hidden=true;$('site-actions').hidden=!advanced.open;};
  advanced.addEventListener('toggle',()=>{$('site-actions').hidden=!advanced.open&&$('site-rule-editor').hidden;});
  const draw=()=>{const list=$('site-rule-list');list.replaceChildren();try{const rules=parse();if(!rules.length)list.append(el('p',l10n('polishEmptyRules'),{class:'hint'}));for(const rule of rules){const row=el('div',null,{class:'rule-row'}),edit=el('button',l10n('mic'),{type:'button'});row.append(el('span',rule.match),edit);edit.onclick=()=>show(rule);list.append(row);}}catch{/* The common validator reports malformed advanced JSON. */}};
  $('site-rule-new').onclick=()=>show();$('cancel-sites').addEventListener('click',()=>{close();draw();});
  const stage=(rules,button)=>{json.value=JSON.stringify(rules,null,2);json.dispatchEvent(new Event('input',{bubbles:true}));void save(button);};
  $('site-rule-add').onclick=()=>{if($('site-rule-editor').hidden){void save($('site-rule-add'));return;}try{const match=$('rule-match').value.trim();if(!parsePattern(match))throw Error();const rules=parse(),rule=rules.find(r=>r.match===(editing??match))||{match};if(rules.some(r=>r!==rule&&r.match===match))throw Error();rule.match=match;for(const f of fields)rule[f]=$('rule-'+f).value;if(!rules.includes(rule))rules.push(rule);stage(rules,$('site-rule-add'));}catch{notice(l10n('mi3'),true);}};
  $('site-rule-delete').onclick=()=>{try{if(editing!==null)stage(parse().filter(rule=>rule.match!==editing),$('site-rule-delete'));}catch{notice(l10n('mi3'),true);}};
  return {draw,close};
}
