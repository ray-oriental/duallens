export function createFrameHandlers(api) {
  return {
    // Sender tab/frame identity is browser supplied. Ignore page-supplied target ids.
    async 'frame-snapshot'(_msg,sender) {
      if(sender.tab?.id==null || !Number.isInteger(sender.frameId) || sender.frameId<=0)return {active:false};
      try {return await api.tabs.sendMessage(sender.tab.id,{type:'frame-top-state'},{frameId:0}) || {active:false};}
      catch {return {active:false};}
    },
  };
}
