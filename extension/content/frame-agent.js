// Extension-only child-frame entry: no interaction modules, commands, auto-start or UI.
import {PageTranslator} from './controller.js';
import {settingsEqual} from '../platform/settings-store.js';
import {parentOwnsDocument} from './frames.js';

export function startFrameAgent(platform) {
  if(parentOwnsDocument()) return;
  let snapshot=null, visible=false, running=false, disposed=false, root=null, translator=null, observedAt=0;
  const stop=()=>{if(translator?.isActive())translator.stop();};
  const observer=new IntersectionObserver(entries=>{
    // A short document can be <100px tall inside a large frame. Size is the frame viewport,
    // while intersection only answers visibility (including clipping by cross-origin ancestors).
    visible=entries.some(e=>e.isIntersecting && e.intersectionRect.width>0 && e.intersectionRect.height>0);
    observedAt=Date.now();
    if(!visible)stop();
  });
  const tick=async()=>{
    if(running || disposed)return;
    running=true;
    try {
      if(root!==document.documentElement){observer.disconnect();root=document.documentElement;visible=false;if(root)observer.observe(root);}
      // Chromium can suspend rendering (and IO callbacks) for display:none child frames.
      // Renew the observation and expire old visibility instead of trusting a stale true value.
      if(Date.now()-observedAt>1000)visible=false;
      if(root){observer.unobserve(root);observer.observe(root);}
      if(!visible || innerWidth<200 || innerHeight<100 || parentOwnsDocument()){stop();return;}
      const next=await platform.frameSnapshot();
      if(disposed)return;
      const changed=snapshot && (!settingsEqual(snapshot.settings,next?.settings)||!settingsEqual(snapshot.context,next?.context));
      snapshot=next;
      if(!next?.active || !visible) stop();
      else {
        translator ||=new PageTranslator({platform,getSettings:()=>snapshot.settings,getContext:()=>snapshot.context});
        if(changed)translator.retranslate();
        translator.start();
      }
    } catch {stop();} finally {running=false;}
  };
  const timer=setInterval(()=>{void tick();},400);
  void tick();
  window.addEventListener('pagehide',event=>{
    if(event.persisted){stop();return;}
    disposed=true;clearInterval(timer);observer.disconnect();translator?.destroy();
  });
}
