import { t as l10n } from '../shared/i18n.js';
// One translation controller per page.

import {siteRuleFor} from '../shared/settings.js';
import {PRIORITY,ERR} from '../shared/protocol.js';
import {parseMarkup} from '../shared/markup.js';
import {looksLikeTarget,normalizeLang,sameLanguage} from '../shared/lang.js';
import {iterateRuns,runsOf,blockContainerOf} from './walker.js';
import {serializeRun,isTranslatable,isShortText,buildFragment,textFragment} from './serialize.js';
import * as inj from './injector.js';
import {TranslateClient} from './client.js';
import {IdleSlices} from './idle.js';
import {LazyObserver,MutationWatcher,RouteWatcher} from './observer.js';
import {joinSelectors,debounce} from './util.js';
import {escapeText} from '../shared/markup.js';
import {measurePresentation,measureColor} from './presentation.js';
import {uiTranslation} from '../shared/ui-glossary.js';
import {metadataTranslation} from '../shared/metadata.js';
import {FrameRoots} from './frames.js';
import {withSendConfirmation} from './confirmation.js';

const MAX_REQUEST_ITEMS=50;
const CHURN_LIMIT=12; // re-translations of one host within a minute before we leave it alone

export class PageTranslator {
  constructor({getSettings,onChange,platform,getContext,onActiveChange,canRequest=()=>true}) {
    platform=withSendConfirmation(platform,getSettings);
    platform.onDecline=()=>this.stop();
    this.platform=platform;
    this.canRequest=canRequest;
    this.getContext=getContext || (()=>({title:document.title,host:location.hostname,url:location.href}));
    this.slices=new IdleSlices();
    this.getSettings=getSettings;
    this.onChange=onChange ||(()=> {});
    this.onActiveChange=onActiveChange ||(()=> {});
    this.units=new Map(); // id -> unit
    this.registry=new WeakMap(); // first node -> unit (dedupe across rescans)
    this.attributes=new WeakMap();
    this.byHost=new Map(); // host -> Set<unit>
    this.churn=new WeakMap(); // host -> { n, t0 }
    this.client=new TranslateClient(platform);
    this.lazy=new LazyObserver((u,pr,top)=> this.#enqueue(u,pr,top));
    this.watch=new MutationWatcher((batch)=> this.#onMutations(batch));
    this.route=new RouteWatcher(()=> this.#onRoute());
    this.active=false;
    this.refresh=()=>{if(this.active){this.#prime();this.lazy.scroll();}};
    this.queue=[];
    this.flushTimer=0;
    this.seq=0;
    this.emit=debounce(()=> this.onChange(),60);
    this.onRouteDebounced=debounce(()=> {if(this.active) this.retranslate();},400);

    inj.setWriteGuard((fn)=> this.watch.guard(fn));
    this.retryHandler=(e)=> {
      // Retry markers live in the page's DOM, so the page could click them itself; act on real input only.
      if(!e.isTrusted) return;
      const r=e.target && e.target.closest ? e.target.closest('dl-r'):null;
      if(!r) return;
      if(e.type==='keydown' && e.key !=='Enter' && e.key !==' ') return;
      e.preventDefault();
      e.stopPropagation();
      const t=r.closest('dl-t');
      if(t) this.retry(t.getAttribute('data-dl-id'));
    };
    document.addEventListener('click',this.retryHandler,true);
    document.addEventListener('keydown',this.retryHandler,true);
    this.frames=new FrameRoots({css:platform.contentCSS || '',
      added:doc=>{
        this.watch.start(doc);this.lazy.addDocument(doc);
        doc.addEventListener('click',this.retryHandler,true);doc.addEventListener('keydown',this.retryHandler,true);
        this.#prime(doc);
        for(const root of this.#roots(doc))this.#scan(root);
      },
      removed:doc=>{
        this.watch.removeDocument(doc);this.lazy.removeDocument(doc);
        doc.removeEventListener('click',this.retryHandler,true);doc.removeEventListener('keydown',this.retryHandler,true);
        inj.write(()=>{for(const u of [...this.units.values()])if(doc.nodeType===9 ? u.host.ownerDocument===doc : doc.contains(u.first))this.#drop(u);});
      },changed:()=>this.lazy.scroll()});
  }


  get s() {
    return this.getSettings();
  }

  get siteCustom() {
    return siteRuleFor(this.s,this.#context().host).custom;
  }

  get style() {
    return this.siteCustom?.style || this.s.style;
  }

  #exclude() {
    return joinSelectors(this.siteCustom?.exclude);
  }

  #roots(doc=document) {
    const include=joinSelectors(this.siteCustom?.include);
    if(include) {
      const all=[...doc.querySelectorAll(include)];
      return all.filter((el)=> !all.some((o)=> o !==el && o.contains(el)));
    }
    return [doc.body || doc];
  }

  #context() {
    return this.getContext();
  }


  isActive() {
    return this.active;
  }

  setPaused(paused) {
    const was=this.paused;this.paused=paused;
    if(paused){this.route.stop();return;}
    if(!this.active)return;
    if(was){this.route.start();for(const u of this.units.values())if(u.state==='idle')this.lazy.watch(u);}
    this.lazy.scroll();
    if(this.queue.length && !this.flushTimer)this.flushTimer=setTimeout(()=>this.#flush(),this.s.lazy.batchDelayMs);
  }

  start() {
    if(this.active) return;
    this.activation = new AbortController();
    this.active=true;
    const signal=this.activation.signal;
    void this.platform.confirmSend({purpose:'page'},signal).then(ok=>{
      if(!ok){if(!signal.aborted)this.stop();return;}
      if(!signal.aborted&&this.active)this.#begin();
    });
    this.onActiveChange();
  }

  #begin() {
    this.lazy.setMargin(this.s.lazy.rootMarginPx);
    this.watch.start();
    this.frames.start();
    this.route.start();
    document.addEventListener('yt-navigate-finish',this.refresh);
    this.#prime();
    for(const root of this.#roots()) this.#scan(root);
    this.emit();
    this.onActiveChange();
  }

  #prime(doc=document) {
    const roots=this.#roots(doc),view=(doc.ownerDocument || doc).defaultView;
    // Prime visible blocks before the document-order scan. A novel can have thousands of
    // offscreen nodes ahead of its scrolled reader; translated chrome must not move the reader
    // out of the lazy window before it has even been discovered. Hit testing is bounded to 12
    // points and uses the same range-aware scanner/dedupe, rather than scanning the whole DOM twice.
    const visible=new Set();
    for(const y of [.12,.35,.6,.85]) for(const x of [.2,.5,.8]) {
      for(const el of doc.elementsFromPoint(view.innerWidth*x,view.innerHeight*y)) {
        if(el.closest('dl-ui,dl-t,dl-o,dl-w')) continue;
        const block=blockContainerOf(el);
        if(block===doc.body || block===doc.documentElement || !roots.some(r=> r.contains(block))) continue;
        visible.add(block); break;
      }
    }
    for(const block of visible) if(![...visible].some(other=> other !==block && block.contains(other))) this.#scan(block);
  }

  stop() {
    const was=this.active;
    this.active=false;
    this.activation?.abort();
    this.slices.cancel();
    clearTimeout(this.flushTimer);
    this.flushTimer=0;
    this.queue.length=0;
    this.client.cancelAll();
    this.onRouteDebounced.cancel();
    this.frames.stop();
    this.watch.stop();
    this.route.stop();
    document.removeEventListener('yt-navigate-finish',this.refresh);
    this.lazy.disconnect();
    inj.write(()=> {
      for(const u of this.units.values()) {u.dead=true; inj.restore(u);}
    });
    this.units.clear();
    this.byHost.clear();
    this.registry=new WeakMap();
    this.attributes=new WeakMap();
    this.emit();
    if(was)this.onActiveChange();
  }

  toggle() {
    if(this.active) this.stop();
    else this.start();
  }

  retranslate() {
    const was=this.active;
    this.stop();
    if(was) this.start();
  }

  setMargin(px) {
    if(this.active) this.lazy.setMargin(px);
  }

  destroy() {
    this.stop();
    this.client.dispose();
    document.removeEventListener('click',this.retryHandler,true);
    document.removeEventListener('keydown',this.retryHandler,true);
  }


  setDisplayMode(mode) {
    inj.write(()=> {
      for(const u of this.units.values()) inj.setMode(u,mode);
    });
    this.lazy.scroll();
  }

  setStyle(style) {
    inj.write(()=> {
      for(const u of this.units.values()) inj.setStyle(u,style);
    });
  }

  getState() {
    let pending=0;
    let failed=0;
    let done=0;
    let total=0;
    let refining=0; // showing a machine-translation draft; the LLM result is still on its way
    for(const u of this.units.values()) {
      if(u.state==='skip') continue;
      total++;
      if(u.state==='queued' || u.state==='pending') pending++;
      else if(u.state==='error') failed++;
      else if(u.state==='done') {
        done++;
        if(u.stage==='draft') refining++;
      }
    }
    return {translated:this.active,mode:this.s.displayMode,units:total,pending,failed,done,refining};
  }


  #known=(host,first)=> this.registry.has(first);

  #scan(root,shallow=false) {
    if(root.getRootNode()!==document && !this.frames.entries.has(root.getRootNode()))return;
    const include=joinSelectors(this.siteCustom?.include);
    // inside an include-limited site, an arbitrary added node only counts when it lies in scope
    if(include && !shallow && !root.closest?.(include)) {
      for(const m of root.querySelectorAll(include)) this.#scanOne(m,false);
      return;
    }
    this.#scanOne(root,shallow);
  }

  #scanOne(root,shallow) {
    const opts={minChars:this.s.translateShortText===false ? this.s.minChars:1,exclude:this.#exclude(),known:this.#known,
      attributeKnown:(el,key)=> this.attributes.get(el)?.has(key),shallow};
    this.slices.run(iterateRuns(root,opts),(run)=> {
      if(run && this.active && run.host.isConnected && (run.first.getRootNode()===document || this.frames.entries.has(run.first.getRootNode())) &&(run.attribute ? !this.attributes.get(run.host)?.has(run.attribute):!this.#known(run.host,run.first))) this.#addUnit(run);
    });
  }

  #addUnit(run,{watch=true}={}) {
    const unit={
      id:String(++this.seq),
      host:run.host,
      first:run.first,
      last:run.last,
      tail:run.tail,
      whole:run.whole,
      paragraph:run.paragraph,
      metadata:run.metadata,
      attribute:run.attribute,
      source:run.source,
      originalAttribute:run.attribute ? run.host.getAttribute(run.attribute):null,
      state:'idle', // idle | queued | pending | done | error | skip
      lang:this.s.targetLang,
      plain:'',
      src:'',
      els:null,
      translated:null,
      stage:null, // 'draft' while a machine-translation draft awaits the LLM result, then 'final'
      priority:PRIORITY.NEAR,
      top:0,
      tEl:null,
      oEl:null,
      wEl:null,
      hover:false,
      peek:false,
    };
    this.units.set(unit.id,unit);
    if(unit.attribute) {
      let attrs=this.attributes.get(unit.host);
      if(!attrs) this.attributes.set(unit.host,attrs=new Map());
      attrs.set(unit.attribute,unit);
    } else this.registry.set(unit.first,unit);
    let set=this.byHost.get(unit.host);
    if(!set) this.byHost.set(unit.host,(set=new Set()));
    set.add(unit);
    if(watch) this.lazy.watch(unit);
    return unit;
  }

  #drop(unit) {
    this.lazy.unwatch(unit);
    this.units.delete(unit.id);
    if(unit.attribute) this.attributes.get(unit.host)?.delete(unit.attribute);
    else this.registry.delete(unit.first);
    const set=this.byHost.get(unit.host);
    if(set) {
      set.delete(unit);
      if(!set.size) this.byHost.delete(unit.host);
    }
    unit.dead=true;
    inj.restore(unit);
  }


  #enqueue(unit,priority,top,immediate=false) {
    if(this.paused)return;
    if(unit.state !=='idle' || unit.dead) return;
    if(!this.active && !unit.hover) return;
    unit.state='queued';
    unit.priority=priority;
    unit.top=top;
    this.queue.push(unit);
    if(immediate) {
      clearTimeout(this.flushTimer);
      this.flushTimer=0;
      this.#flush();
    } else if(!this.flushTimer) {
      this.flushTimer=setTimeout(()=> this.#flush(),this.s.lazy.batchDelayMs);
    }
  }

  async #flush() {
    this.flushTimer=0;
    if(this.paused || !this.canRequest())return;
    const batch=this.queue.splice(0).filter((u)=> u.state==='queued' && !u.dead);
    if(!batch.length) return;
    const s=this.s;
    const exclude=this.#exclude();

    // read phase: no DOM writes until every unit has been measured
    const ready=[];
    for(const u of batch) {
      await this.slices.yield();
      if(u.dead || this.units.get(u.id) !==u) continue;
      if(!inj.intact(u)) {
        this.#drop(u);
        continue;
      }
      const r=u.attribute ? {plain:u.source.trim(),text:escapeText(u.source.trim()),els:[]}:serializeRun(u.first,u.last,{exclude});
      u.plain=r.plain;
      u.src=r.text;
      u.els=r.els;
      if(!isTranslatable(r.plain,s.translateShortText===false ? s.minChars:1) ||
          (s.translateShortText===false && isShortText(r.plain))) {
        this.#skip(u);
        continue;
      }
      u.flexHost=/flex|grid/.test(getComputedStyle(u.host).display);
      u.presentation=u.attribute ? 'replace':measurePresentation(u,s.inlineMaxChars);
      u.translationColor=u.attribute ? null:measureColor(u.host);
      ready.push(u);
    }

    const skipFlags=await Promise.all(ready.map((u)=> this.#alreadyTarget(u.plain,s,u)));
    const send=[];
    ready.forEach((u,i)=> {
      if(u.dead || this.units.get(u.id) !==u || u.state !=='queued') return;
      if(skipFlags[i]) this.#skip(u);
      else {
        const local=!s.glossary?.length&&(u.metadata?metadataTranslation(u.src,s.targetLang):uiTranslation(u.plain,s.targetLang));
        if(u.metadata&&local===u.src)return this.#skip(u);
        if(local &&(s.sourceLang==='auto'||/^en(?:-|$)/.test(s.sourceLang))) this.#apply(u,u.metadata?local:escapeText(local),'final','dictionary');
        else send.push(u);
      }
    });
    if(send.length) {
      inj.write(()=> {
        for(const u of send) {
          u.state='pending';
          inj.markPending(u);
        }
      });
      this.#dispatch(send);
    }
    this.emit();
  }

  #skip(unit) {
    unit.state='skip';
    this.lazy.unwatch(unit);
  }

  async #alreadyTarget(plain,s,unit) {
    if(s.sourceLang==='auto') unit.from=looksLikeTarget(plain,'ja')?'ja':'auto';
    if(looksLikeTarget(plain,s.targetLang)) return true;
    if(plain.length < 24) return false;
    let timer;
    const det=await Promise.race([Promise.resolve().then(()=>this.platform.detectLanguage(plain.slice(0,400))).catch(()=>null),new Promise(r=>timer=setTimeout(()=>r(null),50))]);clearTimeout(timer);
    const top=det && det.reliable && det.lang;
    if(!top) return false;
    const pct=det.percentage ?? 100;
    // Browser language guesses can be wrong or unsupported by the chosen engine
    // (e.g. an English video title guessed as co). Keep automatic source detection
    // at the service; retain the script-based Japanese hint initialized above.
    if(pct >=70 && sameLanguage(normalizeLang(top),s.targetLang)) return true;
    if(s.sourceLang && s.sourceLang !=='auto' && pct >=80 && !sameLanguage(normalizeLang(top),s.sourceLang)) {
      return true;
    }
    return false;
  }

  #dispatch(units) {
    if(this.paused || !this.canRequest()) {
      for(const u of units)if(!u.dead){u.state='queued';this.queue.push(u);}
      return;
    }
    const s=this.s;
    const byPriority=new Map();
    for(const u of units) {
      const key=JSON.stringify([u.priority,u.from||'auto',u.hover?'hover':'page']);
      if(!byPriority.has(key)) byPriority.set(key,[]);
      byPriority.get(key).push(u);
    }
    for(const [key,list] of byPriority) {
      const [priority,from,purpose]=JSON.parse(key);
      list.sort((a,b)=> a.top - b.top);
      for(let i=0; i < list.length; i +=MAX_REQUEST_ITEMS) {
        const chunk=list.slice(i,i + MAX_REQUEST_ITEMS);
        const items=chunk.map(u=>({id:u.id,text:u.src,refine:!u.attribute&&!u.layoutFacts?.interactive&&!u.layoutFacts?.metadata&&!u.host.closest('nav,label,summary,[role="navigation"]')&&(!u.host.closest('header')||!!u.layoutFacts?.title)}));
        // draft: machine translation may answer first (stage 'draft'); the LLM result then replaces it in place.
        const reqId=this.client.request(
          {items,priority,to:s.targetLang,from:s.sourceLang==='auto'?from:s.sourceLang||'auto',context:this.#context(),draft:true,purpose},
          {onResults:(results)=> this.#onResults(results),onDone:()=> this.emit()},
        );
        for(const u of chunk) u.reqId=reqId;
      }
    }
  }

  #onResults(results) {
    const apply=(r)=> inj.write(()=> {
      const u=this.units.get(r.id);
      // A unit showing a draft still accepts its final result (or the news that none will come).
      if(!u || u.dead ||(u.state !=='pending' && !(u.state==='done' && u.stage==='draft'))) return;
      if(!inj.intact(u)) {this.#drop(u); return;}
      if(r.error) {
        if(u.stage==='draft') this.#settleDraft(u); // refinement failed: the draft stays, quietly
        else this.#fail(u,r.error);
      } else this.#apply(u,r.text,r.stage==='draft' ? 'draft':'final',r.engine || 'llm');
    });
    this.slices.run(results[Symbol.iterator](),(r)=> {apply(r); this.emit();});
  }

  #fail(unit,error) {
    unit.state='error';
    unit.error=error;
    inj.markError(unit,error && error.message);
    if(error?.code!=='CANCELLED'&&(unit.retryCount||0)<2){unit.retryCount=(unit.retryCount||0)+1;setTimeout(()=>{if(!unit.dead&&this.active&&unit.state==='error'){unit.state='idle';this.lazy.watch(unit);}},error?.code===ERR.RATE_LIMITED?60000:16000);}
  }

  // The LLM stage gave up on a unit that already shows its machine-translation draft: the draft stays.
  #settleDraft(unit) {
    unit.stage='final';
    unit.refined=false;
    inj.setStage(unit,'final');
  }

  #apply(unit,text,stage='final',engine='llm') {
    const parsed=parseMarkup(text,{maxG:unit.els.length,maxX:unit.els.length});
    const fragment=parsed.ok ? buildFragment(parsed.nodes,unit.els):textFragment(parsed.plain);
    const outPlain=(fragment.textContent || '').replace(/\s+/g,' ').trim();
    if(!outPlain) {
      // An empty draft is ignored; an empty final result keeps an existing draft instead of failing the unit.
      if(stage==='draft') return;
      if(unit.stage==='draft') this.#settleDraft(unit);
      else this.#fail(unit,{code:ERR.PARSE,get message(){return l10n('m4a');}});
      return;
    }
    if(unit.translated===text && unit.tEl) {
      unit.stage=stage;
      unit.engine=engine;
      unit.state='done';
      inj.setStage(unit,stage,engine);
      this.#refreshColor(unit);
      return;
    }
    unit.translated=text;
    unit.state='done';
    unit.stage=stage;
    unit.engine=engine;
    if(outPlain.normalize('NFKC').replace(/\s+/g,'').toLowerCase()===unit.plain.normalize('NFKC').replace(/\s+/g,'').toLowerCase()) {
      inj.showNothing(unit); // the model returned the source unchanged
      return;
    }
    inj.showTranslation(unit,fragment,{
      mode:this.s.displayMode,
      style:this.style,
      inlineMaxChars:this.s.inlineMaxChars,
      stage,
      engine,
    });
    this.#refreshColor(unit);
    this.lazy.scroll();
  }

  #refreshColor(unit) {
    if(unit.attribute || !unit.tEl)return;
    // Themes can change while waiting; layout adaptation can also change inherited table colours.
    const color=measureColor(unit.host);
    if(color)inj.write(()=>{unit.translationColor=color;unit.tEl.style.setProperty('--dl-fg',color);});
  }

  retry(id) {
    const u=this.units.get(id);
    if(!u || u.state !=='error') return;
    u.state='pending';
    u.priority=PRIORITY.VISIBLE;
    inj.markPending(u);
    this.#dispatch([u]);
    this.emit();
  }


  #allowChurn(host) {
    const now=Date.now();
    let c=this.churn.get(host);
    if(!c || now - c.t0 > 60000) c={n:0,t0:now};
    c.n++;
    this.churn.set(host,c);
    return c.n <=CHURN_LIMIT;
  }

  #sweepStale() {
    for(const u of [...this.units.values()]) {
      if(!inj.intact(u)) this.#drop(u);
    }
  }

  #onMutations({added,dirty,layout=[]}) {
    if(!this.active) return;
    this.frames.update();
    const rescan=new Set();
    const handled=new Set();
    inj.write(()=>{for(const el of layout)if(el.isConnected){for(const u of this.units.values())if(el.contains(u.host))inj.refit(u,this.s.displayMode);rescan.add(el);}});

    for(const el of dirty) {
      if(!el.isConnected) continue;
      if(el.nodeType===11){for(const u of [...this.units.values()])if(el.contains(u.first))this.#drop(u);rescan.add(el);continue;}
      // Inline form controls belong to an ancestor block for text runs, but their visible
      // attributes have independent identity. Invalidate those before the block-level rescan.
      const attrs=this.attributes.get(el);
      if(attrs?.size) {
        for(const u of [...attrs.values()]) this.#drop(u);
        rescan.add(el);
      }
      const container=blockContainerOf(el);
      if(handled.has(container)) continue;
      handled.add(container);
      const set=this.byHost.get(container);
      if(!set) {
        rescan.add(container);
        continue;
      }
      // These records came from the page (our writes were drained by guard()). Rescan the
      // full container, including siblings inserted beyond the old first..last source range.
      if(this.#allowChurn(container)) {
        for(const u of [...set]) this.#drop(u);
        rescan.add(container);
      }
    }

    this.#sweepStale();
    for(const a of added) {
      if(!a.isConnected) continue;
      const container=blockContainerOf(a);
      if(!handled.has(container)) rescan.add(container);
    }
    for(const root of rescan) {
      if(root.isConnected) this.#scan(root);
    }
    this.emit();
  }

  #onRoute() {
    if(this.active) this.onRouteDebounced();
  }

  #locate(el) {
    let child=null;
    for(let a=el; a && a !==document.documentElement; child=a,a=a.parentElement) {
      const set=this.byHost.get(a);
      if(!set) continue;
      for(const u of set) {
        if(u.whole || !child || this.#covers(u,child)) return u;
      }
    }
    return null;
  }

  #covers(unit,child) {
    if(child===unit.tEl || child===unit.oEl || child===unit.wEl) return true;
    for(const n of inj.nodesOf(unit)) {
      if(n===child) return true;
    }
    return false;
  }

  #create(el) {
    const container=blockContainerOf(el);
    const runs=runsOf(container,{minChars:this.s.translateShortText===false ? this.s.minChars:1,exclude:this.#exclude(),
      attributeKnown:(el,key)=> this.attributes.get(el)?.has(key)});
    if(!runs.length) return null;
    let child=null;
    for(let a=el; a && a !==container; child=a,a=a.parentElement);
    let pick=null;
    for(const run of runs) {
      if(run.whole || !child) {
        pick=run;
        break;
      }
      for(let n=run.first; n; n=n.nextSibling) {
        if(n===child) {
          pick=run;
          break;
        }
        if(n===run.last) break;
      }
      if(pick) break;
    }
    if(!pick) return null;
    return this.#addUnit(pick,{watch:false});
  }

  hoverToggle(el,mode='toggle') {
    if(!el || !el.closest || el.closest('dl-ui')) return null;
    const t=el.closest('dl-t');
    let u=t ? this.units.get(t.getAttribute('data-dl-id')):this.#locate(el);
    if(!u && mode !=='collapse') u=this.#create(el);
    if(!u) return null;
    if(u.state==='error' && mode !=='collapse') {this.retry(u.id); return 'translating';}
    if(u.state==='done' || u.state==='pending' || u.state==='error') {
      if(mode==='translate') return null;
      if(u.hover) {
        this.#drop(u);
        this.emit();
        return 'collapsed';
      }
      if(mode==='collapse') return null;
      inj.setPeek(u,!u.peek);
      return u.peek ? 'peek-on':'peek-off';
    }
    if(mode !=='collapse' &&(u.state==='idle' || u.state==='skip')) {
      u.state='idle';
      u.hover=true;
      this.#enqueue(u,PRIORITY.VISIBLE,0,true);
      return 'translating';
    }
    return null;
  }
}
