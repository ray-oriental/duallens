"""Shared mock-only URL-rule acceptance for MV3 and the unchanged userscript bundle."""
def rules():
    return {'always': [], 'never': [], 'custom': [
        {'match': '127.0.0.1/articles/*', 'page': 'always', 'hover': 'off', 'include': '#p-plain'},
        {'match': '127.0.0.1/mail/*', 'page': 'never', 'selection': 'off', 'hover': 'off', 'input': 'off'},
    ]}


def exercise(page, toggle, input_command):
    original = page.evaluate('document.body.outerHTML')
    page.wait_for_timeout(1200)
    assert page.locator('dl-t').count() == 0, 'never route translated automatically'
    assert page.locator('dl-ui').count() == 0, 'never route showed floating button'
    page.locator('#p-hover').hover()
    page.keyboard.down('Shift'); page.wait_for_timeout(650); page.keyboard.up('Shift')
    if page.evaluate("matchMedia('(pointer:coarse)').matches"):
        page.locator('#p-hover').dispatch_event('pointerdown', {'pointerType':'touch','isPrimary':True,'pointerId':1})
        page.wait_for_timeout(650)
        page.locator('#p-hover').dispatch_event('pointerup', {'pointerType':'touch','isPrimary':True,'pointerId':1})
    page.locator('#p-plain').click(click_count=3)
    page.locator('#ta').focus()
    before = page.locator('#ta').input_value()
    page.keyboard.press('Space');page.keyboard.press('Space');page.keyboard.press('Space')
    page.wait_for_timeout(400)
    assert page.locator('dl-t,dl-ui').count() == 0, 'disabled feature produced UI or translation'
    assert not page.locator('#ta').input_value().startswith('【译】'), 'disabled passive input translated'
    page.locator('#ta').fill('An explicit input command remains available.')
    input_command()
    page.wait_for_function("document.querySelector('#ta').value.startsWith('【译】')")
    page.keyboard.press('Escape')
    # Restore the editable and its value attribute before checking full document restoration.
    page.locator('#ta').fill(before)
    toggle()
    page.wait_for_function("document.querySelector('#p-plain dl-t[data-dl-state=done]')")
    toggle(); page.wait_for_function("!document.querySelector('dl-t')")
    assert page.evaluate('document.body.outerHTML') == original, 'never/manual restore changed DOM'
    # Navigation runs in the host page, independently of extension isolated-world history wrappers.
    page.evaluate("history.pushState({}, '', '/articles/x?ignored=1')")
    page.wait_for_function("document.querySelector('#p-plain dl-t[data-dl-state=done]')")
    page.wait_for_timeout(500)
    assert page.locator('#p-hover dl-t').count() == 0, 'path CSS selector rule was ignored'
    page.locator('#p-hover').hover()
    page.keyboard.down('Shift'); page.wait_for_timeout(650); page.keyboard.up('Shift')
    assert page.locator('#p-hover dl-t').count() == 0, 'disabled hover translated on article route'
    page.evaluate("history.pushState({}, '', '/mail/x')")
    page.wait_for_function("!document.querySelector('dl-t,dl-ui')")
    assert page.evaluate('document.body.outerHTML') == original, 'SPA never transition failed exact restore'
    page.evaluate('history.back()')
    page.wait_for_function("location.pathname==='/articles/x' && document.querySelector('#p-plain dl-t[data-dl-state=done]')")
    page.evaluate('history.forward()')
    page.wait_for_function("location.pathname==='/mail/x' && !document.querySelector('dl-t,dl-ui')")
    assert page.evaluate('document.body.outerHTML') == original, 'popstate restore failed'


def extension_case(h):
    h.settings({'siteRules': rules()})
    h.open('mail/x/')
    h.wait_state(lambda s: s['dormant'], 10, 'path never rule applied')
    exercise(h.page, lambda: h.command('toggle-page'), lambda: h.command('translate-input'))
    # Full document navigation must also start the article rule without a command.
    h.open('articles/x/')
    h.wait_units(['#p-plain'])
    popup = h.ctx.new_page()
    # A tab-opened popup is otherwise its own active tab. Resolve the actual fixture tab.
    popup.add_init_script(f"chrome.tabs.query = async () => [await chrome.tabs.get({h.tab_id})]")
    popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
    popup.locator('#onboard-skip, #site-mode').first.wait_for(state='attached')
    if popup.locator('#onboard-skip').count():
        popup.click('#onboard-skip')
    popup.locator('#site-mode').wait_for(state='attached')
    popup.wait_for_function("document.querySelector('#site-mode')?.value==='always'")
    popup.locator('#site-path').check()
    popup.select_option('#site-mode', 'never')
    h.wait_state(lambda s: s['dormant'], 10, 'popup path rule applied')
    assert popup.locator('#site-mode').input_value() == 'never'
    assert popup.locator('#toggle').is_enabled(), 'never popup blocked manual translation'
    popup.click('#toggle'); h.wait_units(['#p-plain'])
    popup.close()


def userscript_case(page, base):
    from run_userscript_e2e import ready, command, click_shadow
    ready(page, base, 'mail/x/')
    page.evaluate('r => __platformFixture.settings({siteRules:r})', rules())
    page.wait_for_function("!__platformFixture.rect('.ball')")
    exercise(page, lambda: command(page, '翻译 / 恢复当前页面'), lambda: command(page, '翻译当前输入框'))
    # The same visual editor must save paths and all feature flags on a narrow mobile panel.
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('#rule-match').length===1")
    page.evaluate("__platformFixture.elements('nav a[href=\"#sites\"]')[0].click()")
    click_shadow(page, '#site-rule-new')
    page.evaluate("""() => {
      for (const [field,value] of Object.entries({match:'127.0.0.1/mail/*',page:'never',selection:'off',hover:'off',input:'off'})) {
        const input=__platformFixture.elements('#rule-'+field)[0];
        input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }""")
    saves = page.evaluate("Number(__platformFixture.elements('#saved-toast')[0].dataset.count||0)")
    click_shadow(page, '#site-rule-add')
    page.wait_for_function(f"Number(__platformFixture.elements('#saved-toast')[0].dataset.count||0)>{saves}")
    assert page.evaluate("__platformFixture.elements('#status').every(e=>e.textContent==='')"), 'site rule save reported an error'
    saved=page.evaluate("__platformFixture.data('duallens:local')['settings.sites'].siteRules")
    assert saved == rules(), 'mobile editor changed path or feature fields'
    page.keyboard.press('Escape')
    # A real document navigation starts with fresh GM settings, then applies the same path policy.
    ready(page, base, 'articles/x/')
    page.evaluate('r => __platformFixture.settings({siteRules:r})', rules())
    page.wait_for_function("document.querySelector('#p-plain dl-t[data-dl-state=done]')")
    return {'paths': 2, 'pushState': True, 'popstate': True, 'manual_never': True, 'hover_off': True, 'editor': True}
