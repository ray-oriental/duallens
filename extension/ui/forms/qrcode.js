import { qrcodegen } from './qrcodegen.js';

export function drawQRCode(canvas, text) {
  let qr;
  try { qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.LOW); }
  catch { throw new Error('配置超出单个二维码容量；请复制加密文本或传输加密文件'); }
  const scale = 4, border = 4, size = (qr.size + border * 2) * scale;
  canvas.width = canvas.height = size;
  canvas.style.width = '100%'; canvas.style.maxWidth = size + 'px'; canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
  return qr;
}
