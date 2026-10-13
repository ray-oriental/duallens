// MAIN world, original implementation. WeakMaps preserve the page's DOM and collect no pixels.
(() => {
  const key=Symbol.for("duallens.comic.canvas.hook");
  if(window[key]) return;
  window[key]=true;
  const images = new WeakMap();
  const canvases = new WeakMap();
  const source = (image) => images.get(image) || (image instanceof HTMLImageElement ? { url: image.currentSrc || image.src } : canvases.get(image));
  const originalBitmap = window.createImageBitmap;
  if (originalBitmap) window.createImageBitmap = function(image, ...args) {
    const src = source(image);
    return originalBitmap.call(this, image, ...args).then((bitmap) => {
      if (src?.url) images.set(bitmap, { ...src, crop: args.length >= 4 ? [args[0]+(src.crop?.[0]||0),args[1]+(src.crop?.[1]||0),args[2],args[3]] : src.crop });
      return bitmap;
    });
  };
  for (const Type of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
    if (!Type) continue;
    const draw = Type.prototype.drawImage;
    Type.prototype.drawImage = function(image, ...args) {
      const result = draw.call(this, image, ...args);
      try {
      const src = source(image);
      if (src?.url && /^https?:/.test(src.url)) {
        const old = canvases.get(this.canvas)?.slices || [];
        const matrix=this.getTransform();
        const transform=[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f];
        canvases.set(this.canvas, { url: src.url, slices: [...old.slice(-63), { url: src.url, crop: src.crop, args, transform, unsupported:old.length>=64 || !!src.slices || this.globalAlpha!==1 || this.globalCompositeOperation!=='source-over',iw: image.naturalWidth || image.width, ih: image.naturalHeight || image.height }] });
      }
      } catch { /* Observing metadata must never change the page's native draw behavior. */ }
      return result;
    };
  }
  for (const Type of [window.CanvasRenderingContext2D,window.OffscreenCanvasRenderingContext2D]) {
    if(!Type) continue;
    const clear=Type.prototype.clearRect;
    Type.prototype.clearRect=function(x,y,width,height) {
      const result=clear.call(this,x,y,width,height);
      if(x<=0 && y<=0 && width>=this.canvas.width && height>=this.canvas.height) canvases.delete(this.canvas);
      return result;
    };
  }
  if (window.OffscreenCanvas) {
    const transfer = OffscreenCanvas.prototype.transferToImageBitmap;
    OffscreenCanvas.prototype.transferToImageBitmap = function(...args) {
      const src = canvases.get(this); const bitmap = transfer.apply(this,args);
      if (src) images.set(bitmap,src);
      return bitmap;
    };
  }
  // The bridge provides only bounded source metadata. No network requests are made here.
  document.addEventListener('duallens-comic-query', (event) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const record = canvases.get(event.target);
    if (record) event.target.dispatchEvent(new CustomEvent('duallens-comic-source', { detail: JSON.stringify(record.slices) }));
  });
})();
