export function pdfURL(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(u.protocol) || u.username || u.password) return '';
    return u.href;
  } catch { return ''; }
}
