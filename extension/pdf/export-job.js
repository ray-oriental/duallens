// Wait for terminal translation states, with prompt cancellation and a bounded timeout.
export function abortable(promise, signal) {
  return new Promise((resolve,reject) => {
    const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Cancelled','AbortError'));};
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
export function waitForTranslations(session, ids, signal, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const started = Date.now(); let timer;
    const finish = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const poll = () => {
      if (signal?.aborted) return abort();
      const entries = ids.map(id => session.get(id));
      if (entries.some(entry => entry?.state === 'error')) return finish(new Error('translation'));
      if (entries.every(entry => ['skip', 'final'].includes(entry?.state))) return finish();
      if (Date.now() - started > timeoutMs) return finish(new Error('translation'));
      timer = setTimeout(poll, 40);
    };
    signal?.addEventListener('abort', abort, { once: true }); poll();
  });
}

// Nothing is downloaded until all selected pages have been translated and encoded.
export async function runExport({ pages, writer, render, download, signal, progress = () => {} }) {
  const check = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  try {
    for (let i = 0; i < pages.length; i++) {
      check(); progress('translate', i + 1, pages.length);
      const page = await render(pages[i], signal);
      check(); writer.addPage(page);
    }
    check(); progress('generate');
    // Allow the cancel button to run before assembling the final Blob.
    await new Promise(resolve => setTimeout(resolve, 0)); check();
    const blob = writer.finish(); check(); await download(blob);
  } finally { writer.discard(); }
}
