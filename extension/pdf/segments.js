// Original coordinate segmentation. PDF coordinates are unscaled, bottom-up.
// Return paragraphs {text,x,y,width,height,lines}; lines have the same geometry.
// Complex/rotated/RTL layouts are conservatively isolated, not reconstructed.
const MATH_SYMBOL = /[=+\u2212\u00d7\u00f7\u2200-\u22ff\u27c0-\u27ef\u0370-\u03ff_^]/u;
const WORDS = /[A-Za-z]{2,}/g;

export function formulaLine(text) {
  const words = text.match(WORDS) || [];
  const prose = words.filter(word => !/^(?:sin|cos|tan|log|ln|exp|lim|det|dim|ker|span|rank|mod|max|min)$/i.test(word));
  const tokens = text.match(/[A-Za-z]|[\u0370-\u03ff]|\d+|[=+\u2212\u00d7\u00f7\u2200-\u22ff_^]/gu) || [];
  return (!prose.length && tokens.length > 0) ||
    (prose.length <= 1 && tokens.length >= 5 && MATH_SYMBOL.test(text));
}

// Preserve mathematical islands, including variables inside ordinary prose, as atomic text.
// No TeX/HTML interpretation, and no formula is reconstructed from a model response.
function mathPart(text,start,end,scripts=[]) {
  const part={type:'math',text:text.slice(start,end)};
  const ranges=scripts.filter(range=>range.start>=start&&range.end<=end);
  if(ranges.length) {
    part.runs=[];let offset=start;
    for(const range of ranges) {
      if(range.start>offset) part.runs.push({text:text.slice(offset,range.start)});
      part.runs.push({text:text.slice(range.start,range.end),script:range.script});offset=range.end;
    }
    if(offset<end) part.runs.push({text:text.slice(offset,end)});
  }
  return part;
}

export function mathParts(text,scripts=[]) {
  const pattern = /\b(?:sin|cos|tan|log|ln|exp|lim|det|dim|ker)\b|\b[A-Za-z](?:_\w+|\d+)?\b|\d+(?:\.\d+)?|[\u0370-\u03ff\u2070-\u209f=+\u2212\u00d7\u00f7\u2200-\u22ff\u27c0-\u27ef_^()[\]{}|<>/]+/gu;
  const matches = [...text.matchAll(pattern)];
  const islands = [];
  for (const match of matches) {
    const last = islands.at(-1);
    const end = match.index + match[0].length;
    if (last && /^[\s,.;:]*$/.test(text.slice(last.end, match.index))) {
      last.end = end; last.tokens++;
    } else islands.push({ start: match.index, end, tokens: 1 });
  }
  const parts = [];
  let offset = 0;
  for (const island of islands) {
    const value = text.slice(island.start, island.end);
    if (/^[aAI]$/.test(value) && island.tokens === 1) continue;
    if (island.start > offset) parts.push({ type: 'text', text: text.slice(offset, island.start) });
    parts.push(mathPart(text,island.start,island.end,scripts)); offset = island.end;
  }
  if (offset < text.length) parts.push({ type: 'text', text: text.slice(offset) });
  return parts;
}

export function segmentTextItems(items = [], { pageHeight = 0 } = {}) {
  const rows = [];
  const isolated = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) ||
        !Number.isFinite(item.width) || item.width < 0) continue;
    const height = Math.abs(item.height) || Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
    if (!Number.isFinite(height) || height <= 0) continue;
    const line = { text: item.str.replace(/\s+/g, ' '), x: t[4], y: t[5], width: item.width, height };
    if (item.dir === 'rtl' || Math.abs(t[1]) > .01 || Math.abs(t[2]) > .01) {
      isolated.push({ ...line, text: line.text.trim(), lines: [line] });
    } else rows.push(line);
  }
  rows.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of rows) {
    const line = lines.slice(-12).reverse().find(line => {
      const gap=Math.max(item.x-(line.x+line.width),line.x-(item.x+item.width),0),h=Math.max(item.height,line.height);
      const sameBaseline=Math.abs(item.y-line.y)<=Math.min(item.height,line.height)*.35;
      const small=item.height<line.height?item.text:line.fragments.map(fragment=>fragment.text).join('');
      const script=small.trim().length<=8 && !/[A-Za-z]{2,}/.test(small) &&
        Math.min(item.height,line.height)<h*.85 && Math.abs(item.y-line.y)<=h*.8;
      return (sameBaseline||script) && gap<=h*2;
    });
    if (line) {
      line.fragments.push(item);
      const right=Math.max(line.x+line.width,item.x+item.width);
      line.x=Math.min(line.x,item.x);line.width=right-line.x;
      if(item.height>line.height) {line.height=item.height;line.y=item.y;}
    } else lines.push({ ...item,fragments:[item] });
  }
  // A raised glyph may arrive before the baseline, whose later spans are initially too far
  // away to join. Attach these orphans after the complete baseline width is known.
  const attached=new Set();
  for(const line of lines) {
    const label=line.fragments.map(fragment=>fragment.text).join('').trim();
    if(label.length>8 || /[A-Za-z]{2,}/.test(label)) continue;
    const target=lines.filter(other=>other!==line&&!attached.has(other)&&line.height<other.height*.85 &&
      Math.abs(line.y-other.y)<=other.height*.8 &&
      Math.max(line.x-(other.x+other.width),other.x-(line.x+line.width),0)<=other.height)
      .sort((a,b)=>Math.abs(a.y-line.y)-Math.abs(b.y-line.y))[0];
    if(target) {target.fragments.push(...line.fragments);attached.add(line);}
  }
  for(let i=lines.length-1;i>=0;i--) if(attached.has(lines[i])) lines.splice(i,1);
  for(const line of lines) {
    let text='';let previous;line.scriptRanges=[];
    for(const fragment of line.fragments.sort((a,b)=>a.x-b.x)) {
      const gap=previous?fragment.x-(previous.x+previous.width):0;
      const separator=previous && gap>line.height*.12 && !/\s$/.test(text) && !/^\s|^[,.;:!?)]/.test(fragment.text)?' ':'';
      text+=separator;
      if(fragment.height<line.height*.85 && Math.abs(fragment.y-line.y)>line.height*.1) {
        line.scriptRanges.push({start:text.length,end:text.length+fragment.text.length,script:fragment.y>line.y?'sup':'sub'});
      }
      text+=fragment.text;previous=fragment;
    }
    const trim=text.length-text.trimStart().length;
    line.scriptRanges=line.scriptRanges.map(range=>({...range,start:range.start-trim,end:range.end-trim}));
    line.text=text.trim();
  }
  lines.sort((a,b)=>b.y-a.y||a.x-b.x);
  // Separate non-overlapping horizontal bands (columns). A full-width heading
  // may bridge columns; ambiguous reading order deliberately remains row-major.
  const columns = [];
  for (const line of lines) {
    let col = columns.find(c => Math.min(c.right, line.x + line.width) - Math.max(c.left, line.x) > 0);
    if (!col) columns.push(col = { left: line.x, right: line.x + line.width, lines: [] });
    col.left = Math.min(col.left, line.x); col.right = Math.max(col.right, line.x + line.width);
    col.lines.push(line);
  }
  columns.sort((a, b) => a.left - b.left);
  const paragraphs = [];
  for (const col of columns) {
    let paragraph;
    let previous;
    for (const line of col.lines) {
      line.text = line.text.trim();
      line.kind = formulaLine(line.text) ? 'formula' : 'prose';
      const toc=/^\d+(?:\.\d+)*\s+\p{L}/u.test(line.text) && /(?:\.\s*){4,}/.test(line.text);
      // PDF page margins are in unscaled points. Restrict suppression to marginal text/page labels.
      const pageLabel=/^\s*(?:page\s+)?\d+\s*$/i.test(line.text);
      if (pageHeight && (line.y > pageHeight - 70 || line.y < 36 ||
          (pageLabel && (line.y > pageHeight*.88 || line.y < pageHeight*.12)))) line.kind = 'margin';
      const h = Math.max(line.height, previous?.height || 0);
      const newParagraph = !previous || previous.y - line.y > h * 2.4 || previous.y <= line.y ||
        Math.abs(line.x - previous.x) > h * 1.2 || col.right - (previous.x + previous.width) > 130 ||
        Math.abs(line.height - previous.height) > h * .3 || line.kind !== previous.kind || line.kind !== 'prose' || toc || previous.toc;
      if (newParagraph) {
        paragraph = { ...line, lines: [line],scriptRanges:[...line.scriptRanges] };
        paragraphs.push(paragraph);
      } else {
        const offset=paragraph.text.length+1;
        paragraph.scriptRanges.push(...line.scriptRanges.map(range=>({...range,start:range.start+offset,end:range.end+offset})));
        paragraph.text += ' ' + line.text;
        const right = Math.max(paragraph.x + paragraph.width, line.x + line.width);
        paragraph.x = Math.min(paragraph.x, line.x);
        paragraph.width = right - paragraph.x;
        paragraph.height = paragraph.y - line.y + line.height;
        paragraph.lines.push(line);
      }
      line.toc=toc;previous = line;
    }
  }
  for (const paragraph of paragraphs) paragraph.parts = paragraph.kind === 'prose' ? mathParts(paragraph.text,paragraph.scriptRanges) : [mathPart(paragraph.text,0,paragraph.text.length,paragraph.scriptRanges)];
  for (const paragraph of isolated) { paragraph.kind = 'formula'; paragraph.parts = [{type:'math',text:paragraph.text}]; }
  // Without columns, preserve vertical position of isolated items too.
  if (columns.length <= 1) return [...paragraphs, ...isolated].sort((a, b) => b.y - a.y || a.x - b.x);
  return [...paragraphs, ...isolated];
}
