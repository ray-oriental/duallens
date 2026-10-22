export function createFrameHandlers(api) {
  return {
    // Sender tab/frame identity is browser supplied. Ignore page-supplied target ids.
    async 'frame-snapshot'(_msg,sender) {
      if(sender.tab?.id==null || !Number.isInteger(sender.frameId) || sender.frameId<=0)return {active:false};
      try {return await api.tabs.sendMessage(sender.tab.id,{type:'frame-top-state'},{frameId:0}) || {active:false};}
      catch {return {active:false};}
    },
    async 'frame-publish'(msg,sender) {
      if(sender.tab?.id==null || sender.frameId!==0)return {ok:false};
      const {active,settings,context,confirmedDestinations}=msg.state || {};
      if(typeof active!=='boolean' || !settings || !context)return {ok:false};
      // Broadcast has no frameId option. Only child agents consume frame-state; top ignores it.
      const acked=Array.isArray(confirmedDestinations)?confirmedDestinations.filter(id=>typeof id==='string'):[];
      try {await api.tabs.sendMessage(sender.tab.id,{type:'frame-state',state:{active,settings,context,confirmedDestinations:acked}});} catch { /* no child listeners */ }
      return {ok:true};
    },
  };
}
