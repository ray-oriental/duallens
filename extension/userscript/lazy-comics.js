import { loadFeatures, syncFeatureLanguage, FEATURES_RESOURCE_ERROR } from './features-loader.js';
import { probeLocalOCR } from '../content/comics/capabilities.js';
import { createPanel } from '../content/comics/panel.js';
import { toast } from '../content/overlay.js';

// Keep the CSP failure panel available even when the page blocks verified resource evaluation.
export class ComicTranslator {
  constructor(options, {load=loadFeatures,probe=probeLocalOCR,report=()=>toast(FEATURES_RESOURCE_ERROR())}={}) {
    this.options=options;this.doc=options.doc || document;this.load=load;this.probe=probe;this.report=report;
    this.local=new Map();this.generation=0;
    this.doc.defaultView.addEventListener('pagehide',()=>this.restore());
  }
  get panels() {return this.controller?.panels || this.local;}
  start(automatic=false) {
    if(this.options.getSettings().comics?.enabled===false)return 0;
    syncFeatureLanguage();
    if(this.controller)return this.controller.start(automatic);
    if(this.loading)return 0;
    this.restore();this.loading=true;this.local.set(null,null);
    const generation=this.generation,url=this.doc.location.href;
    const alive=()=>generation===this.generation&&url===this.doc.location.href&&this.options.getSettings().comics?.enabled!==false;
    void this.probe(this.doc.defaultView).then(async capability=>{
      if(!alive())return;
      if(!capability.ok){
        const view=this.doc.defaultView;
        const element=[...this.doc.images].find(image=>{
          const r=image.getBoundingClientRect(),style=view.getComputedStyle(image);
          return !image.closest('dl-ui,dl-comic,[translate="no"],.notranslate,[aria-hidden="true"]')&&
            r.width>=Math.min(280,view.innerWidth*.65)&&r.height>=280&&r.bottom>0&&r.top<view.innerHeight&&r.right>0&&r.left<view.innerWidth&&
            style.visibility!=='hidden'&&Number(style.opacity)!==0;
        });
        if(!element)return;
        const panel=createPanel({element},{lang:this.options.getSettings().comics?.language || 'jpn',
          onRun:()=>this.start(),onClose:()=>this.restore(),onLanguages:lang=>this.options.platform.comics.languages(lang)});
        panel.setStatus(capability.reason,true);this.local.set(element,{panel});return;
      }
      const module=await this.load();
      if(!alive())return;
      this.controller=new module.ComicTranslator(this.options);this.controller.start(automatic);
    }).catch(()=>{if(alive())this.report();}).finally(()=>{
      if(generation===this.generation){this.loading=false;this.local.delete(null);}
    });
    return 0;
  }
  restore() {
    this.generation++;this.loading=false;this.controller?.restore();
    for(const entry of this.local.values())entry?.panel.destroy();
    this.local.clear();
  }
  state() {return this.controller?.state() || [...this.local.values()].filter(Boolean).map(entry=>({...entry.panel.state(),metrics:null}));}
}
