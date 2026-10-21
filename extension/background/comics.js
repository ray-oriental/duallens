import { t as l10n } from '../shared/i18n.js';
const MAX_BYTES = 16*1024*1024;
export async function fetchImage(url, pageUrl, fetchImpl = fetch) {
  const image = new URL(url), page = new URL(pageUrl);
  if (![image,page].every((u) => ['http:','https:'].includes(u.protocol) && !u.username && !u.password)) throw new Error(l10n('m3'));
  const res = await fetchImpl(image.href, { referrer: page.href, credentials: 'omit', redirect: 'error', cache:'no-store', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(l10n('m4', [res.status]));
  const mime = (res.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(mime)) throw new Error(l10n('m5'));
  const reader = res.body.getReader(), parts = []; let size = 0;
  for (;;) {
    const { value,done } = await reader.read(); if (done) break;
    size += value.length;
    if (size>MAX_BYTES) { await reader.cancel(); throw new Error(l10n('m6')); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let pos = 0;
  for (const p of parts) { bytes.set(p,pos); pos+=p.length; }
  let raw=''; for (let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return { base64:btoa(raw), mime };
}
const TEXT = { permission: l10n('m7') };
export function createComicHandlers(api) {
  async function permittedImage(url, pageUrl) {
    const image = new URL(url), page = new URL(pageUrl);
    // activeTab covers the initiating page origin; other image origins require an explicit grant.
    if (image.origin !== page.origin && !(await api.permissions.contains({origins:[image.origin+'/*']}))) {
      throw new Error(TEXT.permission);
    }
    return fetchImage(url, pageUrl);
  }
  let creating;
  let active=0;
  const waiting=[];
  const schedule=(task)=>new Promise((resolve,reject)=> {
    if(waiting.length>=16) { reject(new Error(l10n('m8')));return; }
    waiting.push({task,resolve,reject});drain();
  });
  const drain=()=> {
    while(active<2 && waiting.length) {
      const {task,resolve,reject}=waiting.shift();active++;
      Promise.resolve().then(task).then(resolve,reject).finally(()=> {active--;drain();});
    }
  };
  async function offscreen() {
    if (creating) return creating;
    creating = (async () => {
      const contexts = await api.runtime.getContexts({ contextTypes:['OFFSCREEN_DOCUMENT'] });
      if (!contexts.length) await api.offscreen.createDocument({ url:'offscreen/ocr.html', reasons:['WORKERS'], justification:'Decode current comic images and recognize text locally without uploading pixels' });
      // createDocument may resolve before the document's script registers its listener.
      for (let attempt=0;attempt<60;attempt++) {
        try {
          const reply=await api.runtime.sendMessage({ target:'comics-offscreen',type:'comic-offscreen-ready' });
          if(reply?.ok) return;
        } catch { /* Document is still loading its bundled runtime. */ }
        await new Promise((resolve)=>setTimeout(resolve,50));
      }
      throw new Error(l10n('m9'));
    })().finally(() => { creating=null; });
    return creating;
  }
  async function send(msg) { await offscreen(); return api.runtime.sendMessage({ ...msg,target:'comics-offscreen' }); }
  return {
    async 'comic-ocr'(msg,sender) {
      if (!sender.tab || sender.frameId !== 0 || !['jpn','jpn_vert','kor','eng'].includes(msg.lang)) throw new Error(l10n('ma'));
      return schedule(async()=> {
      // Referrer is derived from the sender, never trusted from an unprivileged payload.
      const pageUrl = sender.url || sender.tab.url;
      if (msg.slices?.length) {
        if (msg.slices.length > 64 || !(msg.width>0 && msg.height>0 && msg.width*msg.height<=24e6)) throw new Error(l10n('mb'));
        const urls = [...new Set(msg.slices.map((s) => s.url))];
        if (urls.length>4) throw new Error(l10n('mc'));
        const slices = msg.slices.map((s) => {
          if(s.unsupported) throw new Error(l10n('md'));
          if (![2,4,8].includes(s.args?.length) || !s.args.every(Number.isFinite) || (s.crop && (s.crop.length!==4 || !s.crop.every(Number.isFinite)))) throw new Error(l10n('me'));
          if(s.transform && (s.transform.length!==6 || !s.transform.every(Number.isFinite))) throw new Error(l10n('mf'));
          return { args:s.args,crop:s.crop,transform:s.transform,index:urls.indexOf(s.url) };
        });
        const images=[];
        for (const url of urls) images.push(await permittedImage(url,pageUrl));
        return send({ type:'comic-ocr-local',images,slices,width:msg.width,height:msg.height,lang:msg.lang });
      }
      return send({ type:'comic-ocr-local',...await permittedImage(msg.url,pageUrl),lang:msg.lang });
      });
    },
    'comic-languages-list': () => send({ type:'comic-languages-list' }),
    'comic-languages-delete': (msg) => send({ type:'comic-languages-delete',lang:msg.lang }),
  };
}
