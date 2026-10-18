// Extension-only child entry: one startup snapshot, then pushes. No polling or interaction UI.
import {PageTranslator} from './controller.js';
import {settingsEqual} from '../platform/settings-store.js';
import {parentOwnsDocument} from './frames.js';

export function startFrameAgent(platform) {
  if(parentOwnsDocument())return;
  let snapshot=null,visible=false,root=null,translator=null,disposed=false,pushed=false;
  const stop=()=>{if(translator?.isActive())translator.stop();};
  const canRequest=()=>visible && !document.hidden && !!root?.getBoundingClientRect().width && innerWidth>=200 && innerHeight>=100;
  const reconcile=()=>{
    if(disposed || !snapshot?.active){stop();return;}
    if(!canRequest()){translator?.setPaused(true);return;}
    translator ||=new PageTranslator({platform,getSettings:()=>snapshot.settings,getContext:()=>snapshot.context,canRequest});
    translator.start();
    translator.setPaused(false);
  };
  const receive=next=>{
    if(disposed)return;
    const modeOnly=snapshot?.settings && next?.settings && settingsEqual({...snapshot.settings,displayMode:next.settings.displayMode},next.settings) && settingsEqual(snapshot.context,next.context);
    const changed=snapshot && !modeOnly && (!settingsEqual(snapshot.settings,next?.settings)||!settingsEqual(snapshot.context,next?.context));
    if(changed)stop();
    snapshot=next;
    if(modeOnly)translator?.setDisplayMode(next.settings.displayMode);
    reconcile();
  };
  const io=new IntersectionObserver(entries=>{
    visible=entries.some(e=>e.isIntersecting && e.intersectionRect.width>0 && e.intersectionRect.height>0);
    reconcile();
  });
  const refresh=()=>{
    if(root!==document.documentElement){io.disconnect();ro.disconnect();root=document.documentElement;}
    visible=false;translator?.setPaused(true);
    if(root){io.unobserve(root);io.observe(root);ro.observe(root);}
  };
  const ro=new ResizeObserver(entries=>{
    if(entries.some(e=>e.contentRect.width===0 || e.contentRect.height===0)){visible=false;translator?.setPaused(true);}
    else {visible=false;io.unobserve(root);io.observe(root);}
  });
  const mo=new MutationObserver(()=>{if(root!==document.documentElement)refresh();});
  mo.observe(document,{childList:true});
  const remove=platform.onMessage((msg)=>{
    if(msg?.type==='frame-state'){pushed=true;receive(msg.state);}return false;
  });
  const snapshotOnce=()=>{pushed=false;void platform.frameSnapshot().then(next=>{if(!pushed)receive(next);}).catch(()=>receive(null));};
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('resize',refresh);
  window.addEventListener('pageshow',event=>{if(event.persisted){refresh();snapshotOnce();}});
  window.addEventListener('pagehide',event=>{
    stop();
    if(!event.persisted){disposed=true;remove();io.disconnect();ro.disconnect();mo.disconnect();translator?.destroy();}
  });
  refresh();snapshotOnce();
}
