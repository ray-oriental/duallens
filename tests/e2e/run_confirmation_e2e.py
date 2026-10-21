"""Offline mobile consent: viewport bounds, unchanged page width, no premature HTTP."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from run_e2e import REPO, E2E_ROOT, start_fixtures, check
from run_userscript_e2e import STUB, command, click_shadow

OUT = Path(os.environ.get('DUALLENS_CONFIRMATION_ARTIFACTS', str(E2E_ROOT/'v1'/'consent')))


def bounds(page, baseline):
    result = page.evaluate("""()=>{
      const box=__platformFixture.elements('.confirm')[0],button=box.querySelector('.primary');
      return {box:box.getBoundingClientRect().toJSON(),button:button.getBoundingClientRect().toJSON(),
        width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,
        fixed:getComputedStyle(box).position,details:box.querySelector('details').open};
    }""")
    check(result['fixed']=='fixed', 'card is not fixed')
    for name in ['box', 'button']:
        r=result[name]
        check(r['left']>=16 and r['right']<=result['width']-16 and r['top']>=0 and r['bottom']<=result['height'], f'{name} outside viewport: {result}')
    check(abs(result['box']['width']-min(360,result['width']-32))<1, 'incorrect card width')
    check(result['scroll']==baseline, f'card expanded webpage: {result}')
    check(page.evaluate('__platformFixture.calls.length')==0, 'HTTP before consent')
    check(page.locator('dl-t,dl-o,dl-w,dl-r').count()==0, 'progress before consent')
    return result


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    server,base=start_fixtures();metrics=[]
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            try:
                for locale in ['en-US','zh-CN']:
                    menu_label=json.loads((REPO/'extension/_locales'/('en' if locale=='en-US' else 'zh_CN')/'messages.json').read_text('utf-8'))['m56']['message']
                    for width,height in [(375,812),(320,640)]:
                        # Include fractional desktop device scaling used by screenshot capture.
                        ctx=browser.new_context(locale=locale,viewport={'width':width,'height':height},is_mobile=True,has_touch=True,device_scale_factor=1.5)
                        try:
                            ctx.add_init_script(STUB+'\n'+(REPO/'dist/duallens.user.js').read_text('utf-8'))
                            page=ctx.new_page();page.goto(base+'/article.html?confirmation='+locale)
                            page.wait_for_function("__platformFixture.hasCommand('DualLens')")
                            page.evaluate("__platformFixture.settings({translation:{mode:'mt',mt:{engine:'microsoft',fallback:true}},floatBall:{enabled:false}})")
                            page.wait_for_timeout(300)
                            original=page.locator('body').inner_html();baseline=page.evaluate('document.documentElement.scrollWidth')
                            command(page, menu_label)
                            page.wait_for_function("__platformFixture.elements('.confirm').length===1")
                            result=bounds(page,baseline);check(not result['details'],'details start expanded')
                            # Privacy: focus rests on the dialog, so Enter/Space cannot consent until a button is tabbed to.
                            check(page.evaluate("()=>{const c=__platformFixture.elements('.confirm')[0];return c.matches(':focus')&&c.getAttribute('role')==='dialog'&&c.querySelector('#'+c.getAttribute('aria-labelledby'))===c.firstElementChild}"),'focus is not on the labelled dialog')
                            page.keyboard.press('Enter');page.keyboard.press('Space');page.wait_for_timeout(150)
                            check(page.evaluate('__platformFixture.calls.length')==0 and page.evaluate("__platformFixture.elements('.confirm').length")==1,'Enter/Space consented without a focused button')
                            page.keyboard.press('Tab')
                            check(page.evaluate("__platformFixture.elements('.confirm summary:focus,.confirm button:focus').length")==1,'Tab did not reach a control inside the dialog')
                            text=page.evaluate("__platformFixture.elements('.confirm>p')[0].textContent")
                            expected=("DualLens will use Microsoft's free translator. Text on this page will be sent to Microsoft, and to Google if Microsoft fails." if locale=='en-US' else '将使用微软免费翻译，本页文字会发送给微软；失败时改用谷歌。')
                            check(text==expected, 'unexpected consent copy: '+text)
                            for theme in ['light','dark']:
                                page.emulate_media(color_scheme=theme)
                                page.screenshot(caret='initial',path=str(OUT/f'{locale}-{width}-{theme}-confirmation.png'))
                            click_shadow(page,'.confirm summary');bounds(page,baseline)
                            check('clients5.google.com' in page.evaluate("__platformFixture.elements('.confirm details')[0].textContent"),'missing destination details')
                            page.screenshot(caret='initial',path=str(OUT/f'{locale}-{width}-details.png'))
                            page.evaluate("__platformFixture.elements('.confirm details p')[0].textContent += ('\\nhost.example').repeat(100)")
                            bounds(page,baseline)
                            click_shadow(page,'.confirm .close');page.wait_for_timeout(200)
                            after=page.locator('body').inner_html()
                            check(after==original,'cancel changed original DOM')
                            check(page.evaluate('document.documentElement.scrollWidth')==baseline,'cancel changed page width')
                            # The same host also constrains a long notice; isolation must not depend on popover support.
                            page.evaluate("()=>{HTMLElement.prototype.showPopover=()=>{throw Error('unsupported fixture')}}")
                            command(page, menu_label)
                            page.wait_for_function("__platformFixture.elements('.confirm').length===1")
                            bounds(page,baseline)
                            click_shadow(page,'.confirm .primary')
                            page.wait_for_function("document.querySelector('dl-t[data-dl-state=done]')")
                            check(page.evaluate('__platformFixture.calls.length')>0,'confirmation did not release HTTP')
                            metrics.append({'locale':locale,'width':width,**result})
                            print(f'PASS consent {locale} {width}x{height}: fixed bounds, details, zero pre-consent HTTP, exact cancel restore, confirmed retry',flush=True)
                        finally:ctx.close()
            finally:browser.close()
        (OUT/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),'utf-8')
        print('CONFIRMATION E2E: 4 passed, 0 failed',flush=True)
    finally:server.shutdown()


if __name__=='__main__':main()

