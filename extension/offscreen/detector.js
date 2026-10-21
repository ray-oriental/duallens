import { t as l10n } from '../shared/i18n.js';
// Lightweight connected-ink baseline for high-contrast lettering, not an artwork/panel model.
// Caller supplies a bounded downsampled raster. No pixels leave the OCR document.
export function detectTextRegions({ data,width,height }, { vertical = false } = {}) {
  if (width*height > 1e6) throw new Error(l10n('m68'));
  const mask = new Uint8Array(width*height);
  for (let i=0;i<mask.length;i++) {
    const j=i*4;
    mask[i] = data[j+3] > 127 && (data[j]*.299+data[j+1]*.587+data[j+2]*.114) < 155 ? 1 : 0;
  }
  const queue = new Uint32Array(mask.length), parts=[];
  for (let start=0;start<mask.length;start++) {
    if (!mask[start]) continue;
    let head=0,tail=1,x0=width,y0=height,x1=0,y1=0; queue[0]=start;mask[start]=0;
    while(head<tail) {
      const point=queue[head++],x=point%width,y=Math.floor(point/width);
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);
      const visit=(next)=> { if(mask[next]) {mask[next]=0;queue[tail++]=next;} };
      if(x>0) visit(point-1);if(x+1<width) visit(point+1);if(y>0) visit(point-width);if(y+1<height) visit(point+width);
    }
    // Discard connected panel frames, large artwork and single-pixel dust.
    if(tail>=3 && x1-x0<width*.35 && y1-y0<height*.35) parts.push({ x0,y0,x1,y1 });
    if(parts.length>2000) return []; // fail safely on dense artwork; use OCR's sparse segmentation.
  }
  if(!parts.length) return [];
  const sizes=parts.map((p)=>Math.max(p.x1-p.x0,p.y1-p.y0)).sort((a,b)=>a-b);
  const em=Math.max(4,sizes[Math.floor(sizes.length*.75)]);
  const parent=parts.map((_,i)=>i);
  const find=(i)=> { while(parent[i]!==i) {parent[i]=parent[parent[i]];i=parent[i];}return i; };
  const gap=(a0,a1,b0,b1)=>Math.max(0,Math.max(a0,b0)-Math.min(a1,b1));
  for(let i=0;i<parts.length;i++) for(let j=i+1;j<parts.length;j++) {
    const a=parts[i],b=parts[j];
    const dx=gap(a.x0,a.x1,b.x0,b.x1),dy=gap(a.y0,a.y1,b.y0,b.y1);
    if(vertical ? dx<=em*.3 && dy<=em*1.35 : dy<=em*.3 && dx<=em*1.35) parent[find(j)]=find(i);
  }
  const groups=new Map();
  parts.forEach((p,i)=> {
    const key=find(i),g=groups.get(key);
    if(g) {g.x0=Math.min(g.x0,p.x0);g.y0=Math.min(g.y0,p.y0);g.x1=Math.max(g.x1,p.x1);g.y1=Math.max(g.y1,p.y1);g.count++;}
    else groups.set(key,{...p,count:1});
  });
  const pad=Math.max(4,em*.2);
  return [...groups.values()].filter((r)=>r.count>=2 && (vertical?r.y1-r.y0:r.x1-r.x0)>=em*1.1)
    .slice(0,40).map((r)=>({x0:Math.max(0,r.x0-pad)/width,y0:Math.max(0,r.y0-pad)/height,
      x1:Math.min(width,r.x1+pad)/width,y1:Math.min(height,r.y1+pad)/height}));
}
