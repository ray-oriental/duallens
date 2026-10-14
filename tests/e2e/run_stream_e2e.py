"""Offline streaming/restore regression with the real extension and unchanged GM bundle."""
import copy
import json
from pathlib import Path
import sys
import threading
import uuid

import run_e2e as e2e
import run_userscript_e2e as gm_e2e

sys.path.insert(0, str(e2e.REPO))
from gateway import duallens_gateway as gateway


GM_STREAM = r"""
window.fixtureStreamFinished=0;
window.GM_xmlhttpRequest=req=>{
  const payload=JSON.parse(req.data);
  const input=JSON.parse(payload.messages.find(m=>m.role==='user').content.split('<input>')[1].split('</input>')[0]);
  const event=text=>'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n';
  const values=input.t.map(t=>'【译】'+t);
  const response={status:200,responseHeaders:'Content-Type: text/event-stream',responseText:''};
  let stopped=false;
  const first=setTimeout(()=>{
    if(stopped)return;
    response.responseText=event('{"t":['+JSON.stringify(values[0]));
    if(window.fixtureProgress) {req.onprogress(response);req.onreadystatechange(response);}
  },30);
  const last=setTimeout(()=>{
    if(stopped)return;
    response.responseText+=event(values.slice(1).map(t=>','+JSON.stringify(t)).join('')+']}')+'data: [DONE]\n\n';
    window.fixtureStreamFinished++;req.onload(response);
  },800);
  return {abort(){stopped=true;clearTimeout(first);clearTimeout(last);req.onabort?.();}};
};
"""


def native(pw, extension, base, run):
    release = threading.Event()
    config = copy.deepcopy(gateway.DEFAULTS)
    def stream(url, body, *args, **kwargs):
        values = json.loads(body['messages'][-1]['content'].split('<input>')[1].split('</input>')[0])['t']
        yield gateway.stream_event(body['model'], '{"t":[' + json.dumps('【译】' + values[0], ensure_ascii=False))
        release.wait(5)
        yield gateway.stream_event(body['model'], ''.join(',' + json.dumps('【译】' + t, ensure_ascii=False) for t in values[1:]) + ']}', 'stop')
    service = gateway.Gateway(run / 'gateway-state', config, stream_request=stream)
    server = gateway.make_server(0, service)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    session = e2e.Session(pw, extension, base, 'stream')
    try:
        session.start()
        profile = {**e2e.GATEWAY_PROFILE, 'baseUrl': f'http://127.0.0.1:{server.server_port}/v1'}
        session.settings({'cache': {'enabled': False}, 'provider': {'active': 'gateway', 'profiles': [profile], 'chain': []}})
        session.open('article.html')
        before = session.js('document.body.outerHTML')
        session.command('toggle-page')
        session.wait_js('!!document.querySelector(\'dl-t[data-dl-state="done"]\')')
        e2e.check(not release.is_set(), 'first result waited for batch completion')
        session.command('toggle-page')
        e2e.check(session.js('document.body.outerHTML') == before, 'stream restore changed DOM')
        release.set(); session.page.wait_for_timeout(900)
        e2e.check(session.js('document.body.outerHTML') == before, 'late stream changed restored DOM')
    finally:
        release.set(); session.close(); server.shutdown(); server.server_close()


def userscript(pw, base, progress):
    profile = e2e.E2E_ROOT / ('profile-stream-gm-' + uuid.uuid4().hex[:8])
    context = pw.chromium.launch_persistent_context(str(profile), headless=True)
    try:
        # Fixture-only transport, then the unchanged release artifact.
        context.add_init_script(script=gm_e2e.STUB + GM_STREAM + f'window.fixtureProgress={str(progress).lower()};')
        context.add_init_script(path=str(e2e.REPO / 'dist/duallens.user.js'))
        page = context.new_page(); page.set_default_timeout(15000)
        gm_e2e.ready(page, base)
        page.evaluate("""() => __platformFixture.settings({cache:{enabled:false},provider:{active:'stream',chain:[],profiles:[{
          id:'stream',kind:'openai',baseUrl:'https://mock.invalid/v1',model:'mock',maxItems:20,maxChars:4000,concurrency:2,timeoutMs:3000
        }]}})""")
        page.wait_for_timeout(100)
        before = page.evaluate('document.body.outerHTML')
        gm_e2e.command(page, '翻译 / 恢复当前页面')
        page.wait_for_function('!!document.querySelector(\'dl-t[data-dl-state="done"]\')')
        finished = page.evaluate('fixtureStreamFinished')
        e2e.check(finished == 0 if progress else finished > 0, 'GM progress/fallback timing is incorrect')
        gm_e2e.command(page, '翻译 / 恢复当前页面')
        page.wait_for_timeout(1000)
        e2e.check(page.evaluate('document.body.outerHTML') == before, 'GM restore/late progress changed DOM')
    finally:
        context.close(); e2e.remove_runtime_dir(profile)


def main():
    run = e2e.E2E_ROOT / ('run-stream-' + uuid.uuid4().hex[:8]); run.mkdir(parents=True)
    server, base = e2e.start_fixtures()
    try:
        extension, missing = e2e.stage_extension(run); e2e.check(not missing, str(missing))
        with e2e.sync_playwright() as pw:
            native(pw, extension, base, run); print('PASS stream_extension: early SSE render, cancel and exact restore', flush=True)
            userscript(pw, base, True); print('PASS stream_userscript: early GM progress, cancel and exact restore', flush=True)
            userscript(pw, base, False); print('PASS stream_userscript_fallback: onload-only response and exact restore', flush=True)
    finally:
        server.shutdown(); server.server_close(); e2e.remove_runtime_dir(run)
    print('SUMMARY streaming total=3 PASS=3 FAIL=0 SKIP=0 mock-only')
    return 0


if __name__ == '__main__': raise SystemExit(main())
