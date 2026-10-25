// Original minimal image-only PDF writer. All offsets and stream lengths are bytes.
const encode = value => new TextEncoder().encode(value);
const positive = value => Number.isFinite(value) && value > 0 && value <= 30000;
const number = value => String(Math.round(value * 1000) / 1000);
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

export class PdfImageWriter {
  constructor() { this.objects = [null, null]; this.pages = []; this.bytes = 0; this.closed = false; }
  object(parts) {
    const bytes = parts.map(part => typeof part === 'string' ? encode(part) : part);
    const size = bytes.reduce((sum, part) => sum + part.byteLength, 0);
    if (this.bytes + size > MAX_EXPORT_BYTES) throw new RangeError('PDF export exceeds 256 MiB');
    this.bytes += size; this.objects.push(bytes); return this.objects.length;
  }
  addPage({ width, height, images }) {
    if (this.closed) throw new Error('PDF writer closed');
    if (!positive(width) || !positive(height) || !Array.isArray(images) || !images.length || images.length > 2)
      throw new RangeError('Invalid PDF page');
    const refs = [], commands = [];
    for (const image of images) {
      const { jpeg, width: w, height: h, x = 0, y = 0, drawWidth = width, drawHeight = height } = image;
      if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || jpeg[0] !== 255 || jpeg[1] !== 216 ||
          !Number.isInteger(w) || !Number.isInteger(h) || !positive(w) || !positive(h) ||
          !positive(drawWidth) || !positive(drawHeight) || !Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x + drawWidth > width + .01 || y + drawHeight > height + .01)
        throw new RangeError('Invalid PDF image');
      const id = this.object([`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
      const name = `Im${refs.length}`; refs.push(`/${name} ${id} 0 R`);
      commands.push(`q ${number(drawWidth)} 0 0 ${number(drawHeight)} ${number(x)} ${number(y)} cm /${name} Do Q`);
    }
    const content = encode(commands.join('\n'));
    const stream = this.object([`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    this.pages.push(this.object([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(width)} ${number(height)}] /Resources << /XObject << ${refs.join(' ')} >> >> /Contents ${stream} 0 R >>`]));
  }
  finish() {
    if (this.closed || !this.pages.length) throw new Error('PDF writer empty or closed');
    this.objects[0] = [encode('<< /Type /Catalog /Pages 2 0 R >>')];
    this.objects[1] = [encode(`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(id => `${id} 0 R`).join(' ')}] >>`)];
    const parts = [encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')], offsets = [0];
    let offset = parts[0].length;
    this.objects.forEach((object, index) => {
      offsets.push(offset);
      const chunks = [encode(`${index + 1} 0 obj\n`), ...object, encode('\nendobj\n')];
      for (const chunk of chunks) { parts.push(chunk); offset += chunk.length; }
    });
    const xref = offset;
    parts.push(encode(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const blob = new Blob(parts, { type: 'application/pdf' });
    this.discard(); return blob;
  }
  discard() { this.objects = []; this.pages = []; this.bytes = 0; this.closed = true; }
}
