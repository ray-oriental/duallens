export function comicSites(values) {
  if(!Array.isArray(values) || values.length>50) throw new Error('漫画站点名单最多 50 项');
  const domain=value=> {
    if(typeof value!=='string') throw new Error('漫画站点域名无效');
    const site=value.trim().toLowerCase();
    if(site.length>253 || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(site) || site.includes('..')) throw new Error('漫画站点请填写域名或 *.example.com，不含协议、端口或路径');
    return site;
  };
  const sites=values.map(value=> {
    if(typeof value==='string') return domain(value);
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('漫画站点无效');
    const host=domain(value.host), entry={host};
    if(value.imageHosts!==undefined || value.referer!==undefined) {
      if(!Array.isArray(value.imageHosts) || !value.imageHosts.length || value.imageHosts.length>8) throw new Error('图片 CDN 域名最多 8 项');
      entry.imageHosts=[...new Set(value.imageHosts.map(domain))];
      if(entry.imageHosts.some(h=>h.startsWith('*.'))) throw new Error('图片 CDN 请填写具体域名');
      const url=new URL(value.referer);
      if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname!=='/' || !matches(url.hostname,host)) throw new Error('Referer 必须是该漫画站点的 HTTP(S) 根地址');
      entry.referer=url.href;
    }
    return entry;
  });
  return [...new Map(sites.map(site=>[typeof site==='string'?site:site.host,site])).values()];
}
const matches=(host,site)=>site.startsWith('*.') ? host===site.slice(2) || host.endsWith('.'+site.slice(2)) : host===site;
// Public compatibility metadata; removing the site removes its image policy too.
export function comicSiteEntries(values) {
  return comicSites(values).map(value=> {
    const entry=typeof value==='string'?{host:value}:value;
    const host=entry.host.replace(/^\*\./,'');
    return !entry.imageHosts && (host==='pixiv.net' || host.endsWith('.pixiv.net')) ?
      {...entry,imageHosts:['i.pximg.net'],referer:'https://www.pixiv.net/'}:entry;
  });
}
export function comicSiteMatches(host,sites) {
  return comicSiteEntries(sites).some(site=>matches(host.toLowerCase(),site.host));
}
export function canvasMatches(settings) {
  if(settings.comics?.enabled===false) return [];
  return comicSiteEntries(settings.comics?.canvasSites || []).flatMap(site=>['https://'+site.host+'/*','http://'+site.host+'/*']);
}
export function imageReferer(settings,pageURL,imageURL) {
  if(settings.comics?.enabled===false) return '';
  const page=new URL(pageURL), image=new URL(imageURL);
  if(![page,image].every(u=>['http:','https:'].includes(u.protocol) && !u.username && !u.password)) return '';
  return comicSiteEntries(settings.comics?.canvasSites || []).find(site=>matches(page.hostname,site.host) &&
    site.imageHosts?.some(host=>matches(image.hostname,'*.'+host)))?.referer || '';
}
