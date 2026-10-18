export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const invalid = () => { throw new Error('字幕格式无效：请使用有效的 SRT / VTT 时间轴'); };
// Strip cue styling before decoding, so escaped literal angle brackets stay text.
export function subtitleText(text) {
  return String(text).replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (code[0] !== '#') return named[code.toLowerCase()];
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  }).trim();
}
function timestamp(value, format) {
  const match = value.match(format === 'srt' ? /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/ : /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return invalid();
  const ms = ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
  if (!Number.isSafeInteger(ms)) return invalid();
  return ms;
}
export function parseSubtitles(text, format = 'vtt') {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SUBTITLE_BYTES) throw new Error('字幕文件不能超过 2 MB');
  if (!['srt', 'vtt'].includes(format)) return invalid();
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[\t ]*\n+/);
  if (format === 'vtt' && !/^WEBVTT(?:[\t ]|$)/.test(blocks[0]?.split('\n')[0])) return invalid();
  const cues = [];
  for (const block of blocks) {
    if (format === 'vtt' && /^(?:WEBVTT(?:[\t ]|$)|NOTE(?:[\t \n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue;
    const lines = block.split('\n');
    if (!lines[0].includes('-->')) lines.shift();
    const match = lines.shift()?.match(/^(\S+)\s+-->\s+(\S+)(?:[\t ]+.*)?$/);
    if (!match) return invalid();
    const start = timestamp(match[1], format), end = timestamp(match[2], format), source = subtitleText(lines.join('\n'));
    if (end <= start || !source || cues.length >= 10000) return invalid();
    cues.push({ start, end, text: source, translation: null });
  }
  if (!cues.length) return invalid();
  return cues.sort((a, b) => a.start - b.start).map((cue, i) => ({ ...cue, id: `subtitle-${i}` }));
}
export function serializeSubtitles(cues, format = 'srt') {
  if (!['srt', 'vtt'].includes(format)) return invalid();
  const time = ms => {
    if (!Number.isSafeInteger(ms) || ms < 0) return invalid();
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`;
  };
  const plain = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n?/g, '\n').replace(/\n(?:[\t ]*\n)+/g, '\n');
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + cues.map((cue, i) => {
    if (cue.end <= cue.start) return invalid();
    return `${i + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${plain(cue.text)}${cue.translation == null ? '' : '\n' + plain(cue.translation)}\n`;
  }).join('\n');
}
