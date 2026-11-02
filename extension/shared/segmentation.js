// Lossless prose grouping; sentence rules also serve shared request splitting.
import {sentenceParts} from './batch.js';
export {sentenceParts};

// Roughly one desktop screen of prose: longer real paragraphs (Wikipedia's run to ~1,700) stay whole.
const LONG_BLOCK=2000;

export function proseParts(text,mode='paragraph') {
  if(mode==='sentence') return sentenceParts(text,{mergeShort:true});
  if(text.length<=LONG_BLOCK) return [text];
  const out=[];let group='';
  for(const sentence of sentenceParts(text)) {
    if(group && group.length+sentence.length>450) {out.push(group);group='';}
    group+=sentence;
    if(group.length>=250) {out.push(group);group='';}
  }
  if(group) {if(out.length && out.at(-1).length+group.length<=450)out[out.length-1]+=group;else out.push(group);}
  return out;
}

export function lineParts(text) {
  // Already separated paragraphs retain their boundaries and their internal author line breaks.
  if(/\n[ \t\r]*\n/.test(text)) {
    const parts=text.split(/(\n[ \t\r]*\n(?:[ \t\r]*\n)*)/),out=[];
    for(let i=0;i<parts.length;i+=2)if(parts[i]||parts[i+1])out.push(parts[i]+(parts[i+1]||''));
    return out;
  }
  const lines=text.match(/[^\n]*\n|[^\n]+$/g)||[text];
  if(lines.length<3 && text.length<160 && !/\n[ \t\r]*\n/.test(text)) return [text];
  const longest=lines.reduce((length,line)=>Math.max(length,line.trim().length),0);
  const out=[];let group='';
  const flush=()=> {
    if(!group)return;
    // Up to 50 characters of slack avoids creating an extra source row in a hard-wrapped
    // paragraph whose final sentence already ends at an author newline.
    if(group.length<=500) {out.push(group);group='';return;}
    let chunk='';
    for(const sentence of sentenceParts(group)) {
      if(chunk && chunk.length+sentence.length>450) {out.push(chunk);chunk='';}
      chunk+=sentence;
    }
    if(chunk)out.push(chunk);
    group='';
  };
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    const short=longest<48 || line.trim().length<Math.max(32,longest*.65);
    let offset=0;
    const end=/[.!?。！？…]["'”’」』）)\]】》〉]*\s*$/.test(line) &&
      (i===lines.length-1 || sentenceParts(line+lines[i+1].replace(/^\s+/,'')).some(part=>(offset+=part.length)===line.length));
    // A short line ending the current sentence is a wrap tail, not a verse/address line.
    if(!line.trim() || short && (!group || !end)) {
      flush();out.push(line);
    } else {
      group+=line;
      if(end)flush();
    }
  }
  flush();return out;
}
