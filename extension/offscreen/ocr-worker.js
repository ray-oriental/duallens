// First-party adapter. The unmodified upstream worker only sees verified local traineddata.
const nativeFetch = self.fetch.bind(self);
self.fetch = async function(url, options) {
  const u = new URL(typeof url === 'string' ? url : url.url, self.location.href);
  const prefix = new URL('./languages/', self.location.href);
  if (u.origin === prefix.origin && u.pathname.startsWith(prefix.pathname)) {
    const lang = u.pathname.slice(prefix.pathname.length).replace(/\.traineddata$/, '');
    if (!['eng','jpn','jpn_vert','kor'].includes(lang)) throw new Error('Unknown OCR language');
    const db = await new Promise((resolve,reject) => {
      const req = indexedDB.open('duallens-ocr-languages',1);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('Missing language cache'));
    });
    try {
      const record = await new Promise((resolve,reject) => {
        const req = db.transaction('languages').objectStore('languages').get(lang);
        req.onsuccess = () => resolve(req.result); req.onerror = reject;
      });
      if (!record) throw new Error('Missing verified language');
      return new Response(record.data, { status: 200 });
    } finally { db.close(); }
  }
  // No upstream/CDN code fallback and no arbitrary network inside the OCR worker.
  if (u.origin !== self.location.origin) throw new Error('Remote OCR runtime disabled');
  return nativeFetch(url,options);
};
importScripts('../vendor/tesseract/worker.min.js');
