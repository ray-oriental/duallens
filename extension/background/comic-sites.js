import { canvasMatches } from '../content/comics/sites.js';
export const CANVAS_SCRIPT_ID='duallens-comic-canvas';
export function createCanvasRegistry(api,getSettings) {
  let pending=Promise.resolve();
  return { sync() {
    const task=pending.then(async()=> {
      const matches=canvasMatches(await getSettings());
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
