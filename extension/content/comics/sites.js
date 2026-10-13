export function comicSites(values) {
  if(!Array.isArray(values) || values.length>50) throw new Error('漫画站点名单最多 50 项');
  const sites=values.map(value=>String(value).trim().toLowerCase());
  if(sites.some(site=>site.length>253 || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(site) || site.includes('..'))) throw new Error('漫画站点请填写域名或 *.example.com，不含协议、端口或路径');
  return [...new Set(sites)];
}
export function comicSiteMatches(host,sites) {
  return comicSites(sites).some(site=>site.startsWith('*.') ? host===site.slice(2) || host.endsWith('.'+site.slice(2)) : host===site);
}
export function canvasMatches(settings) {
  if(settings.comics?.enabled===false) return [];
  return comicSites(settings.comics?.canvasSites || []).flatMap(site=>['https://'+site+'/*','http://'+site+'/*']);
}
