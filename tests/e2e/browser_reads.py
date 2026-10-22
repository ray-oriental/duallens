"""Read-only browser probes shared by offline layout fixtures."""
import time
from playwright.sync_api import Error as BrowserError

def read(page,operation,seconds=15):
    """Retry only reads across a document replacement; never replay commands/clicks."""
    end=time.monotonic()+seconds
    while True:
        try:return operation()
        except BrowserError as error:
            if page.is_closed() or time.monotonic()>=end or not any(word in str(error).lower() for word in
              ('execution context was destroyed','cannot find context','navigation','not attached')):raise
            page.wait_for_timeout(100)

def reader_snapshot(page):
    return read(page,lambda:page.evaluate('''()=>{
      const visible=r=>r.width>0 && r.height>0 && r.top<innerHeight && r.bottom>0;
      const spans=[...document.querySelectorAll('p > span.text-count')];
      const pairs=spans.filter(el=>el.textContent.trim().length>3 && visible(el.getBoundingClientRect())).map(el=>{
        let translation=null;
        for(let n=el.nextSibling;n;n=n.nextSibling){
          if(n.nodeType!==1)continue;
          if(n.matches('dl-t')){translation=n;break;}
          if(n.matches('span.text-count') && n.textContent.trim())break;
        }
        return {done:translation?.matches('[data-dl-state=done]')||false,text:translation?.textContent||''};
      });
      return {url:location.href,pairs,total:document.querySelectorAll('p:has(span.text-count) dl-t[data-dl-state=done]').length,
        aligned:[...document.querySelectorAll('p:has(span.text-count) dl-t')].every(t=>{
          const p=t.parentElement.getBoundingClientRect(),r=t.getBoundingClientRect();return r.left>=p.left-2 && r.right<=p.right+2;
        })};
    }'''))

