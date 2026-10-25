"""Offline first-send gate and closed-shadow UI evidence, using the unchanged GM bundle."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from run_e2e import REPO, E2E_ROOT, start_fixtures, check
from run_userscript_e2e import STUB, command, click_shadow

OUT=Path(os.environ.get('DUALLENS_PAGE_ARTIFACTS',str(E2E_ROOT/'v1'/'page')))
LANGUAGE=os.environ.get('DUALLENS_PAGE_LANGUAGE','zh-CN')

def elements(page,selector):
    return page.evaluate('(s)=>__platformFixture.elements(s).length',selector)

def settings(page,patch):
    page.evaluate('(patch)=>__platformFixture.settings(patch)',patch)
    page.wait_for_timeout(200)

def shot(page,name):
    page.screenshot(path=str(OUT/(name+'.png')))

def run(pw,base,dark):
    ctx=pw.chromium.launch(headless=True).new_context(locale='zh-CN',viewport={'width':1100,'height':760},
        color_scheme='dark' if dark else 'light',reduced_motion='reduce')
    try:
        ctx.add_init_script(script=STUB+'\n'+(REPO/'dist'/'duallens.user.js').read_text(encoding='utf-8'))
        page=ctx.new_page();page.goto(base+'/article.html')
        page.wait_for_function("__platformFixture.hasCommand('翻译此页 / 显示原文')")
        theme='dark' if dark else 'light'
        page.evaluate('(dark)=>{document.body.style.background=dark?"#131316":"white";document.body.style.color=dark?"#ececf1":"#1c1c21";}',dark)
        page.wait_for_function("__platformFixture.elements('.ball').length===1")
        settings(page,{'uiLanguage':LANGUAGE})
        settings(page,{'floatBall':{'autoHide':False}})
        page.wait_for_timeout(2700)
        check(elements(page,'.ball.tucked')==0,'autoHide=false was not delivered to ball')
        settings(page,{'floatBall':{'autoHide':True}})
        shot(page,theme+'-ball-idle')
        page.wait_for_timeout(2700)
        check(elements(page,'.ball.tucked')==1,'auto-hide did not tuck the ball')
        shot(page,theme+'-ball-tucked')
        check(page.evaluate("__platformFixture.elements('.ball')[0].getBoundingClientRect().width")==36,'desktop ball is not 36px')
        page.mouse.move(1080,450);page.wait_for_timeout(100)
        check(elements(page,'.ball.tucked')==0,'nearby pointer failed to reveal ball')
        shot(page,theme+'-ball-hover')
        # The remote address is routed through the fixture's fake GM transport.
        profile={'id':'remote','kind':'openai','name':'Fixture AI','baseUrl':'https://consent.duallens.invalid/v1','model':'test',
            'maxItems':20,'maxChars':4000,'concurrency':2,'timeoutMs':5000,'fallbackModels':[]}
        settings(page,{'provider':{'active':'remote','chain':[],'profiles':[profile]},'translation':{'mode':'llm','mt':{'engine':'mock'}}})
        original=page.locator('body').inner_html()
        command(page,'翻译此页 / 显示原文')
        page.wait_for_function("__platformFixture.elements('.confirm').length===1")
        check(page.evaluate('__platformFixture.calls.length')==0,'text sent before confirmation')
        check(page.evaluate("document.querySelector('dl-ui').shadowRoot===null"),'UI root is open')
        check(page.locator('dl-t,dl-o,dl-w,dl-r').count()==0,'paragraph progress appeared before consent')
        shot(page,theme+'-confirmation')
        click_shadow(page,'.confirm .primary')
        page.wait_for_function("document.querySelector('#p-plain dl-t')?.textContent.includes('【译】')")
        check(elements(page,'.confirm')==0,'card did not close')
        check(page.evaluate('__platformFixture.calls.length')>0,'continuation sent no request')
        check('llm:https://consent.duallens.invalid' in page.evaluate("__platformFixture.data('duallens:local')['ui.device'].acked"),'ack not device-local')
        shot(page,theme+'-ball-busy')
        page.wait_for_function("__platformFixture.elements('.ball.busy').length===0")
        shot(page,theme+'-ball-translated')
        command(page,'翻译此页 / 显示原文');page.wait_for_function("!document.querySelector('dl-t')")
        command(page,'翻译此页 / 显示原文');page.wait_for_function("document.querySelector('#p-plain dl-t')")
        check(elements(page,'.confirm')==0,'same destination prompted twice')
        command(page,'翻译此页 / 显示原文');page.wait_for_function("!document.querySelector('dl-t')")
        # Selection icon/card and the explicit close-feature path.
        page.evaluate("()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#p-intro'));const s=getSelection();s.removeAllRanges();s.addRange(r);}")
        page.mouse.up()
        page.wait_for_function("__platformFixture.elements('.icon.show').length===1")
        shot(page,theme+'-selection-icon');click_shadow(page,'.icon.show')
        page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.includes('【译】'))")
        shot(page,theme+'-selection-card')
        # One-line failure uses a real failed request and a retry button.
        profile['model']=''
        settings(page,{'provider':{'profiles':[profile]}})
        before_menu=page.evaluate("__platformFixture.elements('.card')[0].getBoundingClientRect().height")
        click_shadow(page,'.card .tool[aria-expanded]')
        check(page.evaluate("__platformFixture.elements('.card')[0].getBoundingClientRect().height")==before_menu,'More expanded the translation card')
        shot(page,theme+'-selection-more')
        click_shadow(page,'.selection-menu>button:nth-child(2)');click_shadow(page,'.services .retry')
        page.wait_for_function("__platformFixture.elements('.dst.err').length===1")
        shot(page,theme+'-error')
        check(page.evaluate("value=>__platformFixture.elements('.dst.err')[0].textContent.includes(value)",'重试' if LANGUAGE=='zh-CN' else 'Retry'),'error has no retry')
        page.keyboard.press('Escape')
        profile['baseUrl']='https://other.duallens.invalid/v1';profile['model']='test'
        settings(page,{'provider':{'profiles':[profile]}})
        original=page.locator('#p-plain').inner_html()
        before=page.evaluate('__platformFixture.calls.length');command(page,'翻译此页 / 显示原文')
        page.wait_for_function("__platformFixture.elements('.confirm').length===1")
        click_shadow(page,'.confirm .close');page.wait_for_timeout(400)
        check(page.evaluate('__platformFixture.calls.length')==before,'close sent a translation')
        check(page.locator('dl-t,dl-o,dl-w,dl-r').count()==0,'close left progress placeholders')
        check(page.locator('#p-plain').inner_html()==original,'close changed original DOM')
        page.wait_for_timeout(16500)
        check(elements(page,'.confirm')==0,'dismissed consent reopened on automatic retry')
        check(page.evaluate('__platformFixture.calls.length')==before,'automatic retry sent cancelled text')
        command(page,'翻译此页 / 显示原文')
        page.wait_for_function("__platformFixture.elements('.confirm').length===1")
        click_shadow(page,'.confirm .actions button:not(.primary)')
        page.wait_for_function("__platformFixture.elements('[data-group=ai]').some(e=>!e.hidden)")
        check(page.evaluate('__platformFixture.calls.length')==before,'changing service sent waiting text')
        page.keyboard.press('Escape')
        profile['baseUrl']='http://127.0.0.1:11434/v1'
        settings(page,{'provider':{'profiles':[profile]}})
        command(page,'翻译此页 / 显示原文')
        page.wait_for_function("document.querySelector('#p-plain dl-t')?.textContent.includes('【译】')")
        check(elements(page,'.confirm')==0,'loopback service prompted')
        # All animations are disabled in every overlay, including pending status.
        check(page.evaluate("__platformFixture.elements('*').every(e=>getComputedStyle(e).animationName==='none')"),'reduced motion has animation')
        return theme+': blocked before consent, continued/remembered, close cancels, UI screenshots and reduced motion'
    finally:
        ctx.browser.close()

def main():
    OUT.mkdir(parents=True,exist_ok=True);server,base=start_fixtures();passed=0
    try:
        with sync_playwright() as pw:
            for dark in [False,True]:
                print('PASS page_ui '+run(pw,base,dark),flush=True);passed+=1
    finally:
        server.shutdown()
        print(f'SUMMARY page_ui total=2 PASS={passed} FAIL={2-passed} SKIP=0',flush=True)
    return int(passed!=2)

if __name__=='__main__':raise SystemExit(main())
