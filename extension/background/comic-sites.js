import { canvasMatches, comicSiteEntries } from '../content/comics/sites.js';
export const CANVAS_SCRIPT_ID='duallens-comic-canvas';
export const IMAGE_RULE_BASE=10000;
export const IMAGE_RULE_LIMIT=400; // 50 sites, at most 8 CDN hosts each.
export function imageRefererRules(settings,extensionId) {
  if(!/^[a-p]{32}$/.test(extensionId)) throw new Error('扩展身份无效');
  if(settings.comics?.enabled===false) return [];
  const hosts=new Map();
  for(const site of comicSiteEntries(settings.comics?.canvasSites || [])) {
    for(const host of site.imageHosts || []) {
      if(hosts.has(host) && hosts.get(host)!==site.referer) throw new Error('图片 CDN 的 Referer 配置冲突');
      hosts.set(host,site.referer);
    }
  }
  return [...hosts].sort(([a],[b])=>a.localeCompare(b)).map(([host,referer],index)=>({
    id:IMAGE_RULE_BASE+index,priority:1,
    action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:referer}]},
    condition:{urlFilter:'||'+host+'^',requestDomains:[host],initiatorDomains:[extensionId],resourceTypes:['xmlhttprequest','other']},
  }));
}
export function createImageRegistry(api,getSettings) {
  let pending=Promise.resolve();
  return {sync() {
    const task=pending.then(async()=> {
      const candidates=imageRefererRules(await getSettings(),api.runtime.id);
      const addRules=[];
      for(const rule of candidates) {
        const host=rule.condition.requestDomains[0];
        if(await api.permissions.contains({origins:[`https://${host}/*`]})) addRules.push(rule);
      }
      const dnr=api.declarativeNetRequest;
      if(!dnr) return {ok:false,error:{code:'unsupported',message:'此浏览器无法设置图片 Referer'}};
      const current=(await dnr.getSessionRules()).filter(rule=>rule.id>=IMAGE_RULE_BASE && rule.id<IMAGE_RULE_BASE+IMAGE_RULE_LIMIT);
      if(JSON.stringify(current)!==JSON.stringify(addRules)) await dnr.updateSessionRules({removeRuleIds:current.map(rule=>rule.id),addRules});
      return {ok:true};
    });
    pending=task.catch(()=>{});return task;
  }};
}
export function createCanvasRegistry(api,getSettings) {
  let pending=Promise.resolve();
  return { sync() {
    const task=pending.then(async()=> {
      const candidates=canvasMatches(await getSettings());
      const matches=[];
      for(const pattern of candidates) if(await api.permissions.contains({origins:[pattern]})) matches.push(pattern);
      const [current]=await api.scripting.getRegisteredContentScripts({ids:[CANVAS_SCRIPT_ID]});
      if(!matches.length) {
        if(current) await api.scripting.unregisterContentScripts({ids:[CANVAS_SCRIPT_ID]});
      } else if(!current || JSON.stringify([...current.matches].sort())!==JSON.stringify([...matches].sort())) {
        const script={id:CANVAS_SCRIPT_ID,matches,js:['content/comics/canvas-hook.js'],world:'MAIN',runAt:'document_start',allFrames:false,persistAcrossSessions:true};
        if(current) await api.scripting.updateContentScripts([script]);
        else await api.scripting.registerContentScripts([script]);
      }
      return {ok:true,sites:(await getSettings()).comics.canvasSites};
    });
    pending=task.catch(()=>{});return task;
  }};
}
