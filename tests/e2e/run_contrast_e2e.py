"""Offline end-to-end contrast recovery for low-contrast webpage metadata."""
import json
import os
from pathlib import Path
import uuid
from run_e2e import Session,REPO,E2E_ROOT,stage_extension,start_fixtures,remove_runtime_dir,check,sync_playwright

OUT=Path(os.environ.get('DUALLENS_CONTRAST_ARTIFACTS',str(E2E_ROOT/'v1'/'coverage-r6'/'contrast')))


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    run=E2E_ROOT/('run-contrast-'+uuid.uuid4().hex[:8]);run.mkdir()
    ext,missing=stage_extension(run);check(not missing,'missing extension assets')
    server,base=start_fixtures();metrics=[]
    try:
        with sync_playwright() as pw:
            h=Session(pw,ext,base,'contrast')
            try:
                h.start();h.settings({'style':'muted','translation':{'mode':'mt','mt':{'engine':'mock','fallback':False}},
                    **{f:{'enabled':False} for f in ['floatBall','selection','hover','input','comics','subtitles']}})
                for theme in ['light','dark']:
                    h.open('article.html?contrast='+theme);h.page.emulate_media(color_scheme=theme)
                    h.page.evaluate("""()=>{
                      const section=document.createElement('section');section.id='contrast-fixture';
                      for(const [name,fg,bg] of [['metadata','#828282','#f6f6ef'],['dark','#5a5a5a','#646464'],['invisible','#ffffff','#ffffff']]){
                        const p=document.createElement('p');p.id='contrast-'+name;p.className='subtext';
                        p.style.cssText=`color:${fg};background:${bg};padding:12px`;
                        p.textContent='42 points by fixture 2 hours ago';section.append(p);
                      }
                      document.body.prepend(section);
                    }""")
                    original=h.page.locator('#contrast-fixture').evaluate('e=>e.outerHTML')
                    h.command('toggle-page')
                    h.page.wait_for_function("document.querySelectorAll('#contrast-fixture dl-t[data-dl-state=done]').length===3")
                    result=h.page.evaluate("""()=>{
                      const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
                      return [...document.querySelectorAll('#contrast-fixture p')].map(p=>{
                        const t=p.querySelector('dl-t'),rgb=s=>s.match(/[\\d.]+/g).map(Number).slice(0,3),bg=rgb(getComputedStyle(p).backgroundColor),fg=rgb(getComputedStyle(t).color),source=rgb(getComputedStyle(p).color);
                        const ratio=c=>(Math.max(luminance(c),luminance(bg))+.05)/(Math.min(luminance(c),luminance(bg))+.05);
                        return {id:p.id,sourceRatio:ratio(source),translationRatio:ratio(fg),source,fg,bg};
                      });
                    }""")
                    for row in result:
                        check(row['sourceRatio']<4.5,'fixture does not reproduce low source contrast')
                        check(row['translationRatio']>=4.5,'inserted translation has insufficient contrast: '+str(row))
                    h.page.screenshot(path=str(OUT/(theme+'.png')),caret='initial')
                    h.command('toggle-page');h.page.wait_for_function("!document.querySelector('#contrast-fixture dl-t')")
                    check(h.page.locator('#contrast-fixture').evaluate('e=>e.outerHTML')==original,'source DOM/style changed')
                    metrics.append({'theme':theme,'items':result})
                    print('PASS contrast '+theme+': original colours preserved, inserted text >=4.5, exact restore',flush=True)
            finally:h.close()
        (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2),'utf-8')
        print('CONTRAST E2E: 2 passed, 0 failed',flush=True)
    finally:server.shutdown();remove_runtime_dir(run)


if __name__=='__main__':main()
