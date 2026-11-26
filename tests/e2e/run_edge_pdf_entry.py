"""Isolated Edge PDF switch assertions; --chrome uses an independent Chrome profile.

Only repository PDFs, fixture-generated large files, loopback HTTP and mock translation.
Screenshots and redacted JSON stay in the E2E cache; temporary profiles are removed.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlsplit
import argparse
import base64
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import Error, TimeoutError as PlaywrightTimeoutError, sync_playwright


PROJECT = Path(__file__).resolve().parents[2]
CACHE = Path.home() / '.cache' / 'duallens-e2e'
CASES = [('open', '/open/paper.pdf'), ('cors', '/cors/paper.pdf'),
         ('noext', '/files/42/download'), ('query', '/view?id=42'),
         ('redirect', '/go/42'), ('auth', '/private/paper.pdf'),
         ('auth-noext', '/private/files/7'), ('gone', '/gone/paper.pdf'),
         ('big', '/big/paper.pdf'), ('sandboxed', '/sandboxed/paper.pdf')]
IDENTITY = """() => ({href:location.href,contentType:document.contentType,
  embed:!!document.querySelector('embed'),title:document.title})"""


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        self.pdf = (PROJECT / 'tests/fixtures/pdf-field-notebook.pdf').read_bytes()
        self.requests = []
        self.gone_reads = 0
        self.big = b''
        super().__init__(('127.0.0.1', 0), FixtureHandler)


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_HEAD(self):
        self.respond(False)

    def do_GET(self):
        self.respond(True)

    def respond(self, body):
        path = urlsplit(self.path).path
        # Only synthetic fixture authentication is inspected; never log headers.
        authenticated = 'session=ok' in self.headers.get('Cookie', '').split('; ')
        headers = {'Cache-Control': 'no-store'}
        if path == '/login':
            status, data = 200, b'<!doctype html><title>Fixture login</title>Fixture ready'
            headers.update({'Content-Type': 'text/html',
                            'Set-Cookie': 'session=ok; Path=/; SameSite=Lax'})
        elif path == '/go/42':
            status, data = 302, b''
            headers['Location'] = '/files/42/download'
        elif path in [urlsplit(route).path for _, route in CASES]:
            status = 403 if path.startswith('/private/') and not authenticated else 200
            if path == '/gone/paper.pdf' and body:
                self.server.gone_reads += 1
                if self.server.gone_reads > 1:
                    status = 410
            data = (self.server.big if path == '/big/paper.pdf' else self.server.pdf) if status == 200 else b'Fixture unavailable'
            headers['Content-Type'] = 'application/pdf' if status == 200 else 'text/plain'
            if path == '/sandboxed/paper.pdf':
                headers['Content-Security-Policy'] = 'sandbox'
            if path == '/cors/paper.pdf':
                headers['Access-Control-Allow-Origin'] = '*'
            if not path.endswith('.pdf'):
                headers['Content-Disposition'] = 'inline; filename="paper.pdf"'
        else:
            status, data = 404, b'Fixture not found'
            headers['Content-Type'] = 'text/plain'
        self.server.requests.append({'method': self.command, 'path': self.path,
                                     'status': status, 'authenticated': authenticated})
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if body:
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass


class Report:
    def __init__(self, out, root, origin):
        self.out, self.origin = out, origin
        self.rows = []
        self.observed = 0
        self.replacements = []
        for path, label in [(root, '<temporary>'), (PROJECT, '<checkout>'),
                            (CACHE, '<e2e-cache>'), (Path.home(), '<home>')]:
            for value in [str(path), path.as_posix(), path.as_uri()]:
                self.replacements.append((value, label))
                self.replacements.append((quote(value, safe=''), label))

    def clean(self, value):
        if isinstance(value, dict):
            return {k: self.clean(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.clean(v) for v in value]
        if isinstance(value, str):
            value = value.replace(self.origin, 'http://127.0.0.1:<port>')
            for original, label in self.replacements:
                value = re.sub(re.escape(original), lambda _: label, value, flags=re.I)
            # Browser diagnostics occasionally use escaped Windows paths.
            return re.sub(r'(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\n\"<>]*', '<path>', value)
        return value

    def emit(self, case, probe, ok, detail):
        row = self.clean({'case': case, 'probe': probe, 'ok': ok, 'detail': detail})
        self.rows.append(row)
        line = json.dumps(row, ensure_ascii=False, separators=(',', ':'))
        print(line, flush=True)
        with (self.out / 'probes.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(line + '\n')
        return row

    def save(self, name, value):
        (self.out / name).write_text(json.dumps(self.clean(value), ensure_ascii=False,
                                              indent=2) + '\n', encoding='utf-8')


class WorkerCDP:
    """Use the service worker's actual CDP Runtime, including console events."""
    def __init__(self, browser_cdp, pump, extension_id, target_id=None):
        self.cdp, self.pump = browser_cdp, pump
        self.responses, self.errors, self.sequence = {}, [], 0
        deadline = time.monotonic() + 15
        while True:
            targets = self.cdp.send('Target.getTargets')['targetInfos']
            workers = [t for t in targets if t['targetId'] == target_id] if target_id else [t for t in targets if t['type'] == 'service_worker' and
                       t['url'].startswith(f'chrome-extension://{extension_id}/')]
            if workers:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('extension service worker target unavailable')
            pump.wait_for_timeout(100)
        self.session = self.cdp.send('Target.attachToTarget', {
            'targetId': workers[0]['targetId'], 'flatten': False})['sessionId']
        self.cdp.on('Target.receivedMessageFromTarget', self.receive)
        self.send('Runtime.enable')
        self.send('Log.enable')

    def receive(self, event):
        if event.get('sessionId') != self.session:
            return
        message = json.loads(event['message'])
        if 'id' in message:
            self.responses[message['id']] = message
        elif message.get('method') == 'Runtime.consoleAPICalled':
            params = message['params']
            if params['type'] in ['error', 'warning']:
                self.errors.append({'type': params['type'], 'text': ' '.join(
                    str(arg.get('value', arg.get('description', ''))) for arg in params['args'])})
        elif message.get('method') == 'Runtime.exceptionThrown':
            self.errors.append(message['params']['exceptionDetails'])
        elif message.get('method') == 'Log.entryAdded':
            entry = message['params']['entry']
            if entry['level'] in ['error', 'warning']:
                self.errors.append(entry)

    def send(self, method, params=None):
        self.sequence += 1
        key = self.sequence
        self.cdp.send('Target.sendMessageToTarget', {'sessionId': self.session,
                      'message': json.dumps({'id': key, 'method': method, 'params': params or {}})})
        deadline = time.monotonic() + 40
        while key not in self.responses:
            if time.monotonic() >= deadline:
                raise TimeoutError('service worker CDP response timed out: ' + method)
            self.pump.wait_for_timeout(20)
        result = self.responses.pop(key)
        if 'error' in result:
            raise RuntimeError(json.dumps(result['error']))
        return result.get('result', {})

    def evaluate(self, expression):
        result = self.send('Runtime.evaluate', {'expression': expression,
                           'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            detail = result['exceptionDetails']
            raise RuntimeError(detail.get('exception', {}).get('description', detail['text']))
        return result.get('result', {}).get('value')

    def close(self):
        self.cdp.remove_listener('Target.receivedMessageFromTarget', self.receive)
        try:
            self.cdp.send('Target.detachFromTarget', {'sessionId': self.session})
        except Error:
            pass


class PrivateSource:
    """Observe an incognito native PDF target absent from Playwright's default context."""
    def __init__(self, session, cdp, pump, bridge, tab_id):
        self.session, self.cdp, self.pump, self.bridge, self.tab_id = session, cdp, pump, bridge, tab_id
        self.closed = False

    def evaluate(self, function):
        return self.session.evaluate('('+function+')()')

    @property
    def url(self):
        return self.evaluate('()=>location.href')

    def bring_to_front(self):
        self.bridge.evaluate('id=>chrome.tabs.update(id,{active:true})', self.tab_id)

    def wait_for_timeout(self, ms):
        self.pump.wait_for_timeout(ms)

    def is_closed(self):
        return self.closed

    def close(self):
        self.session.close()
        self.bridge.evaluate('id=>chrome.tabs.remove(id)', self.tab_id)
        self.closed = True


def outcome(sw, expression):
    try:
        return sw.evaluate("(async()=>{try{return {ok:true,detail:await (" + expression +
                           ")}}catch(e){return {ok:false,detail:{error:e.name+': '+e.message}}}})()")
    except (Error, RuntimeError, TimeoutError) as error:
        return {'ok': False, 'detail': {'error': str(error)}}


def inject(sw, tab_id, world, function):
    return outcome(sw, 'chrome.scripting.executeScript({target:{tabId:' + str(tab_id) +
                   ',frameIds:[0]},world:' + json.dumps(world) + ',func:' + function + '})')


def navigate(page, url):
    error = None
    try:
        page.goto(url, wait_until='commit', timeout=15000)
    except Error as exc:
        error = str(exc)
    page.wait_for_timeout(700)
    return error


def screenshot(page, path):
    page.bring_to_front()
    try:
        page.screenshot(path=str(path), timeout=10000)
    except PlaywrightTimeoutError:
        page.screenshot(path=str(path), timeout=10000)


def reader_state(page):
    return page.evaluate("""() => ({url:location.href,pages:document.querySelectorAll('.pdf-page').length,
      rendered:document.querySelectorAll('.pdf-page[data-rendered="true"]').length,
      text:[...document.querySelectorAll('#status,#local-notice,#source-permission')]
        .filter(e=>e.getClientRects().length).map(e=>e.innerText).join('\\n')})""")


def wait_value(page, expression, seconds=15):
    # Playwright 1.48 wait_for_function uses eval blocked by extension CSP.
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if page.evaluate(expression):
            return
        page.wait_for_timeout(50)
    raise TimeoutError('observation deadline exceeded')


def settle_reader(page):
    page.wait_for_load_state('domcontentloaded')
    predicate = """async () => {
      const {t}=await import('../shared/i18n.js');
      return !!document.querySelector('.pdf-page[data-rendered="true"]') ||
        !!document.querySelector('#status.error') ||
        !!document.querySelector('#local-notice:not([hidden])') ||
        document.querySelector('#status')?.textContent===t('m7j');
    }"""
    for attempt in range(2):
        try:
            wait_value(page, predicate)
            break
        except TimeoutError:
            if attempt:
                state = reader_state(page)
                state['observationTimeout'] = True
                return state
    return reader_state(page)


def run(p, root, out, chrome, server, report, variant="default"):
    ext = root / 'extension'
    shutil.copytree(PROJECT / 'extension', ext)
    worker_path = ext / 'background/service-worker.js'
    worker_source = worker_path.read_text(encoding='utf-8')
    # Resolve fetch at call time so the staging-only trace observes the fallback.
    worker_source = worker_source.replace('createPDFEntries(chrome);', 'createPDFEntries(chrome, (...args) => globalThis.fetch(...args));')
    worker_path.write_text(worker_source, encoding='utf-8')
    # Service workers prohibit dynamic import(). Expose the exported production
    # handler only in this isolated staging copy, without a release diagnostic API.
    with (ext / 'background/service-worker.js').open('a', encoding='utf-8') as stream:
        stream.write('''
globalThis.__pdfTestCommand = handleTabCommand;
globalThis.__pdfTestTrace = {stages:[],chunks:[],anonymousReads:0,loaders:0};
const testExecute = chrome.scripting.executeScript.bind(chrome.scripting);
chrome.scripting.executeScript = async options => {
  if (options.files?.includes('content/loader.js')) __pdfTestTrace.loaders++;
  if (__pdfTestTrace.denyRead && options.func?.name === 'stagePDFTab') throw Error('test injection refusal');
  const result = await testExecute(options);
  if (options.func?.name === 'stagePDFTab') __pdfTestTrace.stages.push(result[0]?.result);
  if (options.func?.name === 'takePDFTabChunk') __pdfTestTrace.chunks.push(options.args[2]);
  return result;
};
const testFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url,options) => {
  if (options?.credentials === 'omit' && !options?.method) __pdfTestTrace.anonymousReads++;
  return testFetch(url,options);
};
const testTranslate = translator.translate.bind(translator);
translator.translate = (request, options) => {
  (__pdfTestTrace.translations ||= []).push(request.incognito);
  return testTranslate(request, options);
};
for (const method of ['getMany','putMany']) {
  const original = cache[method].bind(cache);
  cache[method] = (...args) => {
    __pdfTestTrace[method] = (__pdfTestTrace[method] || 0) + 1;
    return original(...args);
  };
}
''')
    if variant == 'all-sites':
        manifest_path = ext / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        manifest['host_permissions'].append('<all_urls>')
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    if variant == 'cookies':
        preferences = root / 'profile/Default/Preferences'
        preferences.parent.mkdir(parents=True)
        preferences.write_text(json.dumps({'profile': {'cookie_controls_mode': 1}}), encoding='utf-8')
    pdf = root / '测试 目录' / 'Field Notebook.pdf'
    pdf.parent.mkdir()
    shutil.copyfile(PROJECT / 'tests/fixtures/pdf-field-notebook.pdf', pdf)
    try:
        ctx = p.chromium.launch_persistent_context(
            str(root / 'profile'), channel='chrome' if chrome else 'msedge', headless=False,
            ignore_default_args=['--disable-extensions'], viewport={'width': 1280, 'height': 900},
            args=['--headless=new', '--no-first-run', '--no-default-browser-check',
                  '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
                  '--disable-features=DisableLoadExtensionCommandLineSwitch',
                  '--disable-background-networking', '--disable-component-update', '--disable-sync',
                  '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1',
                  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                  f'--load-extension={ext}'])
    except Error as error:
        if 'not found' in str(error) or "doesn't exist" in str(error):
            report.emit('browser', 'installed', None, 'SKIP browser not installed')
            return 0, 1
        raise
    sw = None
    try:
        manager = ctx.pages[0]
        port = (root / 'profile/DevToolsActivePort').read_text().splitlines()[0]
        browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
        cdp = browser.new_browser_cdp_session()
        version = cdp.send('Browser.getVersion')
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/protocol', timeout=5) as response:
            protocol = json.load(response)
        methods = [c['name'] for d in protocol['domains'] if d['domain'] == 'Extensions'
                   for c in d.get('commands', [])]
        report.emit('browser', 'version', True, {'product': version['product'],
                    'userAgent': version['userAgent'], 'triggerAction': 'triggerAction' in methods,
                    'manifestChanges': ['host_permissions: <all_urls>'] if variant=='all-sites' else []})
        if not ctx.service_workers:
            try:
                ctx.wait_for_event('serviceworker', timeout=2000)
            except Error:
                cdp.send('Extensions.loadUnpacked', {'path': str(ext)})
        worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        extension_id = worker.url.split('/')[2]
        manager.goto('chrome://extensions/')
        manager.evaluate('()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})')

        def bridge_page():
            page = ctx.new_page()
            for attempt in range(20):
                try:
                    page.goto(f'chrome-extension://{extension_id}/ui/options.html')
                    break
                except Error:
                    if attempt == 19:
                        raise
                    manager.wait_for_timeout(100)
            page.evaluate("()=>chrome.storage.local.set({'ui.device':{onboarded:true,acked:[],upgradeNoticeSeen:true}})")
            return page

        bridge = bridge_page()
        sw = WorkerCDP(cdp, manager, extension_id)

        private_window = None
        if variant in ['private', 'on-click']:
            sw.close()
            configuration = {'extensionId': extension_id}
            configuration.update({'incognitoAccess': True} if variant == 'private' else {'hostAccess': 'ON_CLICK'})
            try:
                manager.evaluate('config=>chrome.developerPrivate.updateExtensionConfiguration(config)', configuration)
            except Error as error:
                if variant != 'on-click':
                    raise
                report.emit(variant, 'configuration', None, {'uncovered': str(error)})
                return 0, 3
            bridge = bridge_page()
            sw = WorkerCDP(cdp, manager, extension_id)
            info = manager.evaluate('id=>chrome.developerPrivate.getExtensionInfo(id)', extension_id)
            host_permissions = info.get('permissions', {}).get('runtimeHostPermissions')
            report.emit(variant, 'configuration', True, {'host':host_permissions,'incognito':info.get('incognitoAccess')})
            if variant=='on-click':
                assert host_permissions and host_permissions['hostAccess']=='ON_CLICK', info.get('permissions')
            if variant == 'private':
                private_window = bridge.evaluate('url=>chrome.windows.create({url,incognito:true})', report.origin+'/login')
                manager.wait_for_timeout(1000)
        if variant == 'cookies':
            settings_page = ctx.new_page()
            settings_page.goto('chrome://settings/')
            prefs = settings_page.evaluate('()=>new Promise(r=>chrome.settingsPrivate.getAllPrefs(r))')
            cookie = next(pref for pref in prefs if pref['key']=='profile.cookie_controls_mode')
            assert cookie['value'] == 1, cookie
            tracking = [pref for pref in prefs if 'tracking' in pref['key'].lower()]
            report.emit(variant, 'preferences', True, {'cookie':cookie,'tracking':tracking})
            strict = next((pref for pref in tracking if pref['key']=='enhanced_tracking_prevention.user_pref'), None)
            if not chrome and strict:
                settings_page.evaluate('key=>new Promise(r=>chrome.settingsPrivate.setPref(key,3,"",r))', strict['key'])
                value = settings_page.evaluate('key=>new Promise(r=>chrome.settingsPrivate.getPref(key,r))', strict['key'])
                assert value['value'] == 3, value
                report.emit(variant, 'strict-tracking', True, value)
            elif not chrome:
                report.emit(variant, 'strict-tracking', None, 'UN COVERED: no tracking_prevention preference exposed')
            settings_page.close()

        def source_page(route, auth=False):
            if private_window:
                created = bridge.evaluate('o=>chrome.tabs.create(o)', {'url':route,'windowId':private_window['id'],'active':True})
                manager.wait_for_timeout(900)
                target = next(t for t in cdp.send('Target.getTargets')['targetInfos'] if t['type']=='page' and t['url']==route)
                return PrivateSource(WorkerCDP(cdp,manager,extension_id,target['targetId']),cdp,manager,bridge,created['id']),created['id'],None
            page = ctx.new_page()
            if auth:
                navigate(page, report.origin + '/login')
            error = navigate(page, route)
            page.bring_to_front()
            tab_id = bridge.evaluate('async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].id')
            return page, tab_id, error

        def trigger(page):
            page.bring_to_front()
            targets = cdp.send('Target.getTargets', {'filter': [{'exclude': False}]})['targetInfos']
            tabs = [target for target in targets if target['type'] == 'tab' and target['url'] == page.url]
            if len(tabs) != 1:
                raise RuntimeError('could not uniquely identify the isolated browser tab target')
            if 'triggerAction' not in methods:
                raise RuntimeError('Extensions.triggerAction unavailable; cannot claim a real activeTab grant')
            cdp.send('Extensions.triggerAction', {'id': extension_id, 'targetId': tabs[0]['targetId']})

        # Fresh tab, before any toolbar action; no broad host grant in baseline.
        page, tab_id, _ = source_page(report.origin + '/open/paper.pdf')
        for world in ['ISOLATED', 'MAIN']:
            result = inject(sw, tab_id, world, IDENTITY)
            assert result['ok'] == (variant == 'all-sites'), result
            report.emit('open', 'inject-without-action-' + world, **result)
        page.close()

        # An incremental update adds a legal, uncompressed 40 MiB stream.
        original = server.pdf
        number = int(re.findall(rb'/Size\s+(\d+)', original)[-1])
        previous = int(re.findall(rb'startxref\s+(\d+)', original)[-1])
        payload = b'x' * (40 * 1024 * 1024)
        offset = len(original)
        stream = f'{number} 0 obj\n<< /Length {len(payload)} >>\nstream\n'.encode() + payload + b'\nendstream\nendobj\n'
        xref = offset + len(stream)
        server.big = original + stream + (f'xref\n{number} 1\n{offset:010} 00000 n \n'
            f'trailer\n<< /Size {number+1} /Root 1 0 R /Prev {previous} >>\nstartxref\n{xref}\n%%EOF\n').encode()
        (out / 'big-fixture.pdf').write_bytes(server.big)
        del payload, stream
        review = out.parent / 'review'
        review.mkdir(exist_ok=True)
        matrix = []
        bridge.evaluate("""async()=>{
          const {getDefaultSettingsStore}=await import('../shared/settings.js');
          await getDefaultSettingsStore().save({provider:{active:'mock'},translation:{mode:'llm',mt:{engine:'mock'}}});
        }""")
        if variant == 'settings':
            bridge.evaluate("""async()=>{const {getDefaultSettingsStore}=await import('../shared/settings.js');
              await getDefaultSettingsStore().save({displayMode:'translation-only',targetLang:'fr',translationColor:'blue'});}""")

        def assert_reader(page):
            page.wait_for_url(f'chrome-extension://{extension_id}/pdf/viewer.html*', timeout=45000)
            state = settle_reader(page)
            assert state['pages'] == 8 and state['rendered'] > 0, state
            return state

        def record_row(row):
            matrix.append(row)
            report.observed=len(matrix)
            report.save('matrix.json',matrix)
            report.emit(row['case'],'assertions',row['ok'],row)
            return row['ok']

        def matrix_case(case, route, auth=False, local=False, command=False):
            start_requests = len(server.requests)
            page, tab_id, navigation_error = source_page(route, auth)
            row = {'case': case, 'variant':variant, 'navigationError': navigation_error}
            source = page
            popup = None
            try:
                row['sourceTab'] = bridge.evaluate('async id=>{const t=await chrome.tabs.get(id);return {id:t.id,windowId:t.windowId,incognito:t.incognito,url:t.url}}',tab_id)
                def session_count():
                    return sw.evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('duallens-pdf-sessions',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('files').objectStore('files').count();q.onsuccess=()=>{db.close();resolve(q.result)}};r.onerror=()=>reject(r.error)})")
                row['sessionsBefore'] = session_count()
                assert page.evaluate('()=>document.contentType') == 'application/pdf'
                trigger(page)
                sw.evaluate('__pdfTestTrace={stages:[],chunks:[],anonymousReads:0,loaders:0,denyRead:'+('true' if case=='sandboxed-fallback' else 'false')+'}')
                row['status'] = bridge.evaluate("id=>chrome.runtime.sendMessage({type:'pdf-status',tabId:id})", tab_id)
                if case in ['auth','auth-noext']:
                    # Negative control reproduces the old anonymous download failure.
                    row['anonymousStatus'] = sw.evaluate('fetch('+json.dumps(route)+',{credentials:"omit"}).then(r=>r.status)')
                    assert row['anonymousStatus'] == 403
                    sw.evaluate('__pdfTestTrace.anonymousReads=0')
                if command:
                    row['entry'] = 'shared handler invocation; no native key/menu interaction'
                    row['click'] = sw.evaluate('__pdfTestCommand('+str(tab_id)+',{type:"command",name:"toggle-page"})')
                    if local and not row['status']['available']:
                        # A hidden file URL provides no PDF evidence to the worker. Keep
                        # the reviewed shortcut/menu boundary instead of forcing a switch.
                        assert row['click'] is None,row
                        row['original']=page.evaluate(IDENTITY)
                        assert row['original']['contentType']=='application/pdf',row
                        assert not any('/pdf/viewer.html' in candidate.url for candidate in ctx.pages),row
                        row['hiddenSourceKept']=True
                        row['ok']=True
                        return record_row(row)
                    assert row['click']['ok'], row
                else:
                    # Spanning popups belong to the source window in the browser UI. The
                    # headless document surrogate maps only its active-tab query accordingly.
                    if private_window:
                        popup = ctx.new_page()
                        popup.add_init_script('const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async q=>q.active&&q.currentWindow?[await chrome.tabs.get('+str(tab_id)+')]:query(q);')
                        popup.goto(f'chrome-extension://{extension_id}/ui/popup.html')
                    else:
                        with ctx.expect_page() as pending:
                            bridge.evaluate('()=>chrome.tabs.create({url:chrome.runtime.getURL("ui/popup.html"),active:false})')
                        popup = pending.value
                    popup.wait_for_load_state('domcontentloaded')
                    selector = '#pdf-local-open' if local and not row['status']['available'] else '#pdf-open'
                    popup.locator(selector).wait_for(timeout=20000)
                    row['popup'] = popup.evaluate("""()=>({open:!!document.querySelector('#pdf-open'),toggle:!!document.querySelector('#toggle'),
                      error:!!document.querySelector('#page-status .dl-error'),status:document.querySelector('#page-status')?.textContent})""")
                    if row['status']['available']:
                        assert row['popup']['open'] and not row['popup']['toggle'], row
                        assert not row['popup']['error'], row
                        assert popup.locator('#pdf-open').get_attribute('class') == 'dl-hero primary'
                        assert '受限' not in row['popup']['status'] and 'restricted' not in row['popup']['status'].lower()
                    if case == 'open':
                        popup.set_viewport_size({'width':360,'height':700})
                        for language in ['zh-CN','en']:
                            bridge.evaluate("""async language=>{const {getDefaultSettingsStore}=await import('../shared/settings.js');await getDefaultSettingsStore().save({uiLanguage:language});}""", language)
                            for theme in ['light','dark']:
                                popup.emulate_media(color_scheme=theme)
                                popup.wait_for_timeout(200)
                                screenshot(popup,review/f'{"chrome" if chrome else "edge"}-popup-{language}-{theme}.png')
                        bridge.evaluate("""async()=>{const {getDefaultSettingsStore}=await import('../shared/settings.js');await getDefaultSettingsStore().save({uiLanguage:'zh-CN'});}""")
                    popup.evaluate("""()=>{window.pdfResponses=[];const send=chrome.runtime.sendMessage.bind(chrome.runtime);
                      chrome.runtime.sendMessage=async(...args)=>{const value=await send(...args);
                        if(['pdf-open','pdf-open-local'].includes(args[0]?.type))pdfResponses.push(value);return value;};}""")
                    started=time.monotonic()
                    popup.click(selector)
                    wait_value(popup,'()=>pdfResponses.length>0',seconds=50)
                    row['click']=popup.evaluate('()=>pdfResponses.at(-1)')
                    row['switchMs']=round((time.monotonic()-started)*1000)
                new_reader = case == 'gone' or private_window
                if new_reader:
                    deadline = time.monotonic()+20
                    while not any('/pdf/viewer.html' in candidate.url for candidate in ctx.pages):
                        if time.monotonic()>deadline: raise TimeoutError('new reader deadline exceeded')
                        manager.wait_for_timeout(50)
                    page = next(candidate for candidate in ctx.pages if '/pdf/viewer.html' in candidate.url)
                    row['original'] = source.evaluate(IDENTITY)
                    assert row['original']['contentType']=='application/pdf',row
                    assert row['original']['href']==route,row
                page.wait_for_url(f'chrome-extension://{extension_id}/pdf/viewer.html*',timeout=45000)
                row['sameTab'] = bridge.evaluate('async id=>(await chrome.tabs.get(id)).url.includes("/pdf/viewer.html")',tab_id)
                row['transfer'] = sw.evaluate('__pdfTestTrace')
                assert row['sameTab'] == (not new_reader), row
                assert len([candidate for candidate in ctx.pages if '/pdf/viewer.html' in candidate.url]) == 1
                if not command: assert row['transfer']['loaders']==0
                if case in ['auth','noext']:
                    assert row['transfer']['anonymousReads']==0 and row['transfer']['chunks'], row
                if case == 'gone' or (local and not row['status']['available']):
                    page.locator('#local-choose').wait_for()
                    assert page.locator('#local-choose').get_attribute('class')=='primary'
                    if case=='gone':
                        assert 'notice=read-failed' in page.url and not row['click']['ok']
                        row['notice']=page.locator('#local-explanation').inner_text()
                        assert '没能读取' in row['notice']
                        for theme in ['light','dark']:
                            page.emulate_media(color_scheme=theme)
                            screenshot(page,review/f'{"chrome" if chrome else "edge"}-read-failed-{theme}.png')
                    with page.expect_file_chooser() as chooser:
                        page.click('#local-choose')
                    chooser.value.set_files(str(pdf))
                    wait_value(page,'()=>!!document.querySelector(".pdf-page[data-rendered=true]")',seconds=30)
                else:
                    assert row['click']['ok'],row
                row['reader']=assert_reader(page)
                row['readerIdentity']=page.evaluate('async()=>{const t=await chrome.tabs.getCurrent();return {inIncognitoContext:chrome.extension.inIncognitoContext,tab:{id:t.id,windowId:t.windowId,incognito:t.incognito}}}')
                row['sessionsOpened']=session_count()
                if private_window:
                    assert row['sessionsOpened']==row['sessionsBefore'],row
                    page.evaluate("""()=>{window.privateRequests=[];const connect=chrome.runtime.connect.bind(chrome.runtime);
                      chrome.runtime.connect=(...args)=>{const port=connect(...args),post=port.postMessage.bind(port);
                        port.postMessage=msg=>{if(msg.type==='translate')privateRequests.push(msg.incognito);return post(msg)};return port;};}""")
                    page.click('#translate')
                    wait_value(page,'()=>privateRequests.length>0',seconds=30)
                    wait_value(page,'()=>!!document.querySelector(".tb[data-stage=final],.rf-t")',seconds=30)
                    row['privateRequests']=page.evaluate('()=>privateRequests')
                    assert all(flag is True for flag in row['privateRequests']),row
                    assert session_count()==row['sessionsBefore'],row
                    row['privateWorker']=sw.evaluate('__pdfTestTrace')
                    assert row['privateWorker']['translations'] and all(row['privateWorker']['translations']),row
                    assert row['privateWorker'].get('getMany',0)==0 and row['privateWorker'].get('putMany',0)==0,row
                if variant=='settings':
                    row['settings']=page.evaluate("async()=>{const s=await (await import('../shared/settings.js')).getDefaultSettingsStore().load();return {view:document.querySelector('#mode').value,targetLang:s.targetLang,translationColor:s.translationColor}}")
                    assert row['settings']['view']=='translated',row
                    assert row['settings']['targetLang']=='fr',row
                    assert row['settings']['translationColor']=='blue',row
                if command:
                    wait_value(page,'()=>!!document.querySelector(".tb[data-stage=final],.rf-t")',seconds=30)
                    assert '?' not in page.url, page.url
                    row['autoTranslated']=True
                if case=='big':
                    row['bytes']=len(server.big)
                    assert len(row['transfer']['chunks'])==6
                    assert all(n==8*1024*1024 for n in row['transfer']['chunks'][:-1])
                    print(f'BIG PDF transfer: {len(server.big)} bytes, {row["switchMs"]} ms',flush=True)
                if case=='sandboxed-fallback': assert row['transfer']['anonymousReads']>=1
                # Refresh is exercised for all paths, including picker and the large file.
                page.reload(wait_until='domcontentloaded')
                if private_window:
                    wait_value(page,"async()=>document.querySelector('#status').textContent===(await import('../shared/i18n.js')).t('pdfSwitchPrivateRefresh')")
                    row['refresh']=reader_state(page)
                    assert row['refresh']['pages']==0 and session_count()==row['sessionsBefore'],row
                else:
                    row['refresh']=assert_reader(page)
                    if variant=='settings': assert page.locator('#mode').input_value()=='translated',row
                if command:
                    # The entry intent is consumed once; session restore must stay idle.
                    page.wait_for_timeout(1500)
                    row['refreshTranslation']=page.evaluate('''()=>({
                      restoreDisabled:document.querySelector('#restore').disabled,
                      translatedNodes:document.querySelectorAll('.tb[data-stage=final],.rf-t').length})''')
                    assert '?' not in page.url, page.url
                    assert row['refreshTranslation']=={'restoreDisabled':True,'translatedNodes':0},row
                if not private_window and not local and case not in ['gone','big'] and not command:
                    page.go_back(wait_until='commit')
                    page.wait_for_timeout(500)
                    assert page.evaluate('()=>document.contentType')=='application/pdf'
                    row['backNative']=True
                    page.go_forward(wait_until='domcontentloaded')
                    row['forward']=assert_reader(page)
                row['requests']=server.requests[start_requests:]
                # ActiveTab identification must not issue anonymous HEAD/Range probes.
                if case in ['open','noext','query','redirect','auth','auth-noext']:
                    assert not any(r['method']=='HEAD' for r in row['requests']),row
                row['ok']=True
            except (Error,RuntimeError,TimeoutError,AssertionError) as error:
                row['ok']=False
                row['error']=str(error)
                row['actualURL']=page.url
                row['actualTab']=bridge.evaluate('id=>chrome.tabs.get(id)',tab_id)
                if '/pdf/viewer.html' in page.url:
                    row['readerFailure']=reader_state(page)
            finally:
                for auxiliary in [popup,page,source]:
                    if auxiliary and not auxiliary.is_closed():auxiliary.close()
            return record_row(row)

        selected_cases=CASES if variant=='default' else [(case,route) for case,route in CASES if case in ['auth','noext','gone']]
        for case,route in selected_cases:
            # A timeout gets one independent retry before it is classified as failure.
            ok=matrix_case(case,report.origin+route,case.startswith('auth'))
            if not ok and any(word in matrix[-1].get('error','').lower() for word in ['timeout','deadline']):
                if case=='gone':server.gone_reads=0
                first=matrix.pop()
                ok=matrix_case(case,report.origin+route,case.startswith('auth'))
                matrix[-1]['firstTimeout']=first['error']
        for name in (['shortcut-handler','menu-handler'] if variant=='default' else []):
            matrix_case(name,report.origin+'/private/files/7',auth=True,command=True)
        if variant=='default': matrix_case('sandboxed-fallback',report.origin+'/sandboxed/paper.pdf')
        for allowed in ([False,True] if variant=='default' else []):
            sw.close();bridge.close()
            manager.evaluate('([id,fileAccess])=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,fileAccess})',[extension_id,allowed])
            bridge=bridge_page();sw=WorkerCDP(cdp,manager,extension_id)
            matrix_case('file-access-'+('on' if allowed else 'off'),pdf.as_uri(),local=True)
            matrix_case('file-command-'+('on' if allowed else 'off'),pdf.as_uri(),local=True,command=True)
        report.save('requests.json',server.requests)
        report.save('worker-diagnostics.json',sw.errors)
        failures=sum(not row['ok'] for row in matrix)
        return failures,0
    finally:
        if sw:
            sw.close()
        ctx.close()


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chrome', action='store_true')
    parser.add_argument('--variant', choices=['default','cookies','all-sites','on-click','private','settings'], help='Run only one settings variant; default runs the complete matrix')
    args = parser.parse_args()
    # Keep profiles in the dedicated cache even if an output override is supplied.
    base = Path(os.environ.get('DUALLENS_E2E_OUT', CACHE / 'edge-pdf-repro')).resolve()
    if not base.is_relative_to(CACHE.resolve()):
        parser.error('DUALLENS_E2E_OUT must be inside the dedicated E2E cache')
    out = base / ('chrome' if args.chrome else 'edge')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'probes.jsonl').write_text('', encoding='utf-8')
    server = FixtureServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    failures, skips = 1, 0
    try:
        failures, skips, observed = 0, 0, 0
        with sync_playwright() as p:
            for variant in ([args.variant] if args.variant else ['default','cookies','all-sites','on-click','private','settings']):
                variant_out = out / variant
                variant_out.mkdir(exist_ok=True)
                server.gone_reads = 0
                with tempfile.TemporaryDirectory(prefix='run-', dir=variant_out) as temporary:
                    report = Report(variant_out, Path(temporary), f'http://127.0.0.1:{server.server_port}')
                    try:
                        failed, skipped = run(p, Path(temporary), variant_out, args.chrome, server, report, variant)
                        failures += failed
                        skips += skipped
                    except Exception as error:
                        report.emit('harness', 'fatal', False, {'error': str(error)})
                        failures += 1
                    observed += report.observed
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    name = 'Chrome' if args.chrome else 'Edge'
    print(f'{name} PDF entry: {max(0,observed-failures)} PASS, {failures} FAIL, {skips} SKIP', flush=True)
    return int(bool(failures))


if __name__ == '__main__':
    raise SystemExit(main())
