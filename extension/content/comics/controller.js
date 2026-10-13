import { discoverImages } from './discovery.js';
import { cleanRegions, readingOrder } from './order.js';
import { createPanel } from './panel.js';
import { comicSiteMatches } from './sites.js';
export class ComicTranslator {
  constructor({ platform,getSettings,doc=globalThis.document }) {
    this.platform=platform;this.getSettings=getSettings;this.doc=doc;this.panels=new Map();this.requests=new Set();this.generation=0;
    this.service=platform.translator();
    this.leave=()=>this.restore();doc.defaultView.addEventListener('pagehide',this.leave);
    this.navigationURL=doc.location.href;
  }
  start() {
    if(this.getSettings().comics?.enabled===false) return 0;
    if(this.navigationURL!==this.doc.location.href) this.restore();
    this.navigationURL=this.doc.location.href;
    const records=[];
    if(this.platform.kind==='extension') {
      for(const element of this.doc.querySelectorAll('canvas')) {
        const receive=(event)=> {
          try {
            if(typeof event.detail!=='string' || event.detail.length>65536) return;
            const slices=JSON.parse(event.detail);
            if(Array.isArray(slices)&&slices.length<=64) records.push({ element,slices });
          } catch { /* Page metadata is untrusted. */ }
        };
        element.addEventListener('duallens-comic-source',receive);
        element.dispatchEvent(new Event('duallens-comic-query',{ bubbles:true }));
        element.removeEventListener('duallens-comic-source',receive);
      }
    }
    const candidates=discoverImages(this.doc,{ onlyImg:this.platform.kind!=='extension',canvasRecords:records });
    if(candidates.length && !this.navigationTimer) this.navigationTimer=setInterval(()=> {
      if(this.navigationURL!==this.doc.location.href) this.restore();
      else for(const entry of this.panels.values()) if(!entry.candidate.element.isConnected) this.close(entry);
    },1000);
    for(const candidate of candidates) {
      if(this.panels.has(candidate.element)) continue;
      const from=this.getSettings().sourceLang;
      const lang=this.getSettings().comics?.language || ({ ja:'jpn',ko:'kor',en:'eng' }[from]) || 'jpn';
      const entry={ candidate,panel:null,version:0 };
      entry.panel=createPanel(candidate,{ lang,onRun:()=>this.run(entry),onClose:()=>this.close(entry),
        onEnableCanvas:this.doc.location.hostname && ['http:','https:'].includes(this.doc.location.protocol) && !comicSiteMatches(this.doc.location.hostname,this.getSettings().comics.canvasSites) ? async()=> {
          const current=await this.platform.settingsStore.load();
          await this.platform.settingsStore.save({comics:{canvasSites:[...current.comics.canvasSites,this.doc.location.hostname]}});
          const result=await this.platform.comics?.syncSites?.();
          return !result || result.ok;
        } : null,
        onLanguages:(language)=>this.platform.comics?.languages(language) || Promise.resolve({ ok:false,error:{message:'此平台暂不支持语言包管理'} }) });
      this.panels.set(candidate.element,entry);
      // Explicit page command runs only the bounded visible set and one upcoming image.
      void this.run(entry);
    }
    return candidates.length;
  }
  async run(entry) {
    if(entry.running) return;
    entry.running=true; const version=++entry.version;const generation=this.generation;
    const alive=()=>generation===this.generation&&entry.version===version&&entry.panel.host.isConnected&&this.navigationURL===this.doc.location.href;
    const { panel,candidate }=entry;panel.busy(true);panel.setStatus('本机下载与识别中…');
    try {
      if(!this.platform.comics?.recognize) throw new Error('此页无法本地识别');
      const recognized=await this.platform.comics.recognize({ url:candidate.url,slices:candidate.slices,width:candidate.width,height:candidate.height,lang:panel.lang() });
      if(!alive()) return;
      if(!recognized.ok) throw new Error(recognized.error?.message || '此页无法本地识别');
      const ordered=readingOrder(cleanRegions(recognized.regions,panel.lang()),{ lang:panel.lang(),width:recognized.width,height:recognized.height });
      panel.render(ordered.regions,ordered.uncertain);entry.metrics=recognized.metrics;
      if(!ordered.regions.length) return;
      const byID=new Map(ordered.regions.map((r,i)=>[String(i),r]));
      const req=this.service.translateBatch({ items:ordered.regions.map((r,i)=>({id:String(i),text:r.text})),
        to:this.getSettings().targetLang,from:({ jpn:'ja',jpn_vert:'ja',kor:'ko',eng:'en' })[panel.lang()],priority:0,
        context:{ title:'',host:'',url:'' } },(results)=> {
        if(!alive()) return;
        for(const result of results) byID.get(result.id)?.show(result.error?'文字翻译失败':result.text,!!result.error);
      });
      entry.request=req;this.requests.add(req);
      await req.done;this.requests.delete(req);
    } catch(error) { if(alive()) panel.setStatus(error.message,true); }
    finally { entry.running=false;if(alive()) panel.busy(false); }
  }
  close(entry) {
    entry.version++;entry.request?.cancel();this.requests.delete(entry.request);entry.panel.destroy();this.panels.delete(entry.candidate.element);
    if(!this.panels.size) {clearInterval(this.navigationTimer);this.navigationTimer=null;}
  }
  restore() {
    clearInterval(this.navigationTimer);this.navigationTimer=null;
    this.generation++;for(const request of this.requests) request.cancel();this.requests.clear();
    for(const entry of this.panels.values()) entry.panel.destroy();this.panels.clear();
  }
  state() { return [...this.panels.values()].map((entry)=>({ ...entry.panel.state(),metrics:entry.metrics || null })); }
}
