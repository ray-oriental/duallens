#!/usr/bin/env python3
"""Opt-in real-extension performance probe, excluded from CI.

Run with the documented Playwright venv/browser cache. Default: deterministic local
mock gateway. --allow-real --model sjtu/deepseek-chat (or ollama/qwen3:4b) uses
existing machine-local configuration in memory, without modifying its gateway or
scheduled task. --variant before stages HEAD's gateway and extension; after uses
this worktree. Reports contain timings/counters only, outside the repository.
"""
from __future__ import annotations
import argparse
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/e2e'))
sys.path.insert(0, str(ROOT))
import run_e2e as e2e
from gateway import duallens_gateway as current


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        paragraphs = ''.join(f'<p id="perf-{i}">Section {i}: ' +
            'Browser translation should preserve the meaning and formatting of a page. '
            'Streaming lets readers begin before the whole article finishes. '
            'A smaller first batch helps fill the visible screen promptly.</p>' for i in range(18))
        body = ('<!doctype html><html lang="en"><title>DualLens public benchmark</title>'
            '<style>body{max-width:750px;margin:24px;font:18px/1.6 sans-serif}p{margin:20px 0}</style>' + paragraphs).encode()
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--variant', choices=['before', 'after'], default='after')
    parser.add_argument('--baseline-ref', default='HEAD')
    parser.add_argument('--allow-real', action='store_true')
    parser.add_argument('--model', choices=['sjtu/deepseek-chat', 'ollama/qwen3:4b'], default='ollama/qwen3:4b')
    parser.add_argument('--sjtu-budget', type=int, default=6, choices=range(1, 21))
    parser.add_argument('--timeout', type=int, default=300)
    opts = parser.parse_args()
    e2e.E2E_ROOT.mkdir(parents=True, exist_ok=True)
    run = e2e.E2E_ROOT / ('run-perf-' + uuid.uuid4().hex[:8]); run.mkdir()
    gateway_server = fixture_server = session = None
    report = {'variant': opts.variant, 'mode': 'real' if opts.allow_real else 'mock',
              'model': opts.model, 'sjtu_calls': 0, 'status': 'failed'}
    safe_model = opts.model.replace('/', '-').replace(':', '-')
    report_path = e2e.E2E_ROOT / ('perf-' + report['mode'] + '-' + opts.variant + '-' + safe_model + '.json')
    try:
        source, module = ROOT / 'extension', current
        if opts.variant == 'before':
            # git archive contains only tracked public source, never profiles/config.
            archive = subprocess.run(['git', 'archive', '--format=zip', opts.baseline_ref, 'extension', 'gateway'],
                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
            baseline = run / 'baseline'; baseline.mkdir()
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                for name in z.namelist():
                    if not (baseline / name).resolve().is_relative_to(baseline.resolve()):
                        raise ValueError('Unsafe archive member')
                z.extractall(baseline)
            source = baseline / 'extension'
            spec = importlib.util.spec_from_file_location('perf_baseline_gateway', baseline / 'gateway/duallens_gateway.py')
            module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        config = current.config_load() if opts.allow_real else copy.deepcopy(module.DEFAULTS)
        if not opts.allow_real:
            config['sjtu']['enabled'] = False
        # This source-owned process is isolated from the installed gateway.
        backend = opts.model.split('/')[0]
        if opts.allow_real and not config[backend].get('enabled'):
            raise RuntimeError('Selected backend is disabled in machine-local configuration')
        actual_request = module.loopback_request
        lock = threading.Lock()
        def count(url):
            if not opts.allow_real or url != config['sjtu']['url'].rstrip('/') + '/v1/chat/completions': return
            with lock:
                if report['sjtu_calls'] >= opts.sjtu_budget:
                    raise module.GatewayError(429, 'daily_limit', 'Benchmark SJTU budget reached', 600)
                report['sjtu_calls'] += 1
        def request(url, body=None, headers=None, timeout=120):
            count(url)
            if opts.allow_real: return actual_request(url, body, headers, timeout)
            values = json.loads(body['messages'][-1]['content'].split('<input>')[1].split('</input>')[0])['t']
            time.sleep(.25 + len(values) * .1)
            return module.completion(body['model'], json.dumps({'t': ['【译】' + v for v in values]}, ensure_ascii=False))
        gateway = module.Gateway(run / 'gateway-state', config=config, request=request)
        if hasattr(gateway, 'stream_request'):
            actual_stream = gateway.stream_request
            def stream(url, body, headers=None, timeout=45):
                count(url)
                if opts.allow_real:
                    yield from actual_stream(url, body, headers, timeout); return
                values = json.loads(body['messages'][-1]['content'].split('<input>')[1].split('</input>')[0])['t']
                time.sleep(.25)
                yield current.stream_event(body['model'], '{"t":[')
                for i, value in enumerate(values):
                    time.sleep(.1)
                    yield current.stream_event(body['model'], (',' if i else '') + json.dumps('【译】' + value, ensure_ascii=False))
                yield current.stream_event(body['model'], ']}', 'stop')
            gateway.stream_request = stream
        gateway_server = module.make_server(0, gateway)
        fixture_server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        for server in (gateway_server, fixture_server):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        extension, missing = e2e.stage_extension(run, source); e2e.check(not missing, str(missing))
        with e2e.sync_playwright() as pw:
            session = e2e.Session(pw, extension, f'http://127.0.0.1:{fixture_server.server_port}', 'perf')
            session.start()
            model = opts.model if opts.allow_real else 'ollama/qwen3:4b'
            # The real SJTU chain uses only currently advertised Hermes models.
            models = gateway.models()['data'] if opts.allow_real and backend == 'sjtu' else []
            chain = [model] + [m['id'] for m in models if m['id'].startswith('hermes/')][:1]
            if backend == 'sjtu': chain += ['ollama/qwen3:4b']
            profile = {**e2e.GATEWAY_PROFILE, 'baseUrl': f'http://127.0.0.1:{gateway_server.server_port}/v1',
                'model': model, 'maxItems': 20, 'maxChars': 4000, 'timeoutMs': 45000, 'fallbackModels': chain[1:]}
            session.settings({'cache': {'enabled': False}, 'provider': {'active': 'gateway',
                'profiles': [profile], 'chain': [{'profileId': 'gateway', 'model': m} for m in chain]}})
            session.open('article.html')
            session.js('''() => {
              window.perfVisible = [...document.querySelectorAll('p')].filter(p => { const r=p.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight; }).map(p=>p.id);
              window.perfTimes = { first:null, viewport:null, full:null };
              const ready = p => !!p.querySelector('dl-t[data-dl-state="done"]');
              window.perfObserver = new MutationObserver(() => {
                const ms=performance.now()-window.perfStart;
                if(window.perfTimes.first===null && document.querySelector('dl-t[data-dl-state="done"]')) window.perfTimes.first=ms;
                if(window.perfTimes.viewport===null && perfVisible.every(id=>ready(document.getElementById(id)))) window.perfTimes.viewport=ms;
                if(window.perfTimes.full===null && [...document.querySelectorAll('p')].every(ready)) window.perfTimes.full=ms;
              });
              perfObserver.observe(document.body,{subtree:true,childList:true,attributes:true});
              window.perfStart=performance.now();
            }''')
            session.command('toggle-page')
            session.wait_js('perfTimes.viewport !== null', timeout=opts.timeout, what='viewport translation')
            # Scroll only after the first viewport completes; record full wall time.
            for index in range(18):
                session.js('(i) => document.getElementById("perf-"+i).scrollIntoView()', index)
                session.wait_js('(i) => !!document.getElementById("perf-"+i).querySelector(\'dl-t[data-dl-state="done"]\')',
                    timeout=opts.timeout, arg=index, what='paragraph translation')
            report.update(session.js('perfTimes'))
            report['status'] = 'success'
            # Wait for [DONE]/cache validation before closing the isolated gateway.
            session.page.wait_for_timeout(300)
            if gateway.metadata_path.exists():
                report['requests'] = [{k: row[k] for k in ('model', 'elapsed_ms', 'status')}
                    for row in map(json.loads, gateway.metadata_path.read_text(encoding='utf-8').splitlines())]
            session.close(); session = None
    except Exception as exc:
        # Never include raw upstream error messages, source text or config.
        report['error_type'] = type(exc).__name__
    finally:
        if session:
            try: report['timings_before_failure'] = session.js('perfTimes')
            except Exception: pass
        if session: session.close()
        for server in (gateway_server, fixture_server):
            if server: server.shutdown(); server.server_close()
        e2e.remove_runtime_dir(run)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        history = report_path.with_name(report_path.stem + '-' + run.name.removeprefix('run-perf-') + '.json')
        history.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PERF ' + json.dumps(report, ensure_ascii=False))
    return int(report['status'] != 'success')


if __name__ == '__main__': raise SystemExit(main())
