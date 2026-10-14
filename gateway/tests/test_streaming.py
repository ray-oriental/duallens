import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from gateway.duallens_gateway import (DEFAULTS, Gateway, GatewayError, completion,
    loopback_stream, make_server, manifest_version, stream_event)


class StreamingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        config = copy.deepcopy(DEFAULTS)
        config['hermes']['enabled'] = True
        self.calls = []
        def request(url, body=None, headers=None, timeout=120):
            self.calls.append((url, body, timeout))
            if url.endswith('/models'):
                return {'data': [{'id': 'upstage/solar-mini4:free'}, {'id': 'paid-model'}]}
            return completion('upstream', 'fallback')
        self.g = Gateway(Path(self.temp.name), config, request=request,
            stream_request=lambda *a, **kw: iter([stream_event('upstream', '{"t":["你好"]}', 'stop')]))
        self.server = make_server(0, self.g)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.temp.cleanup()

    def call(self, model='ollama/qwen3:4b', headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        conn.request('POST', '/v1/chat/completions', json.dumps({'model': model, 'stream': True,
            'messages': [{'role': 'user', 'content': 'PRIVATE_SENTINEL'}]}),
            {'Content-Type': 'application/json', **(headers or {})})
        return conn, conn.getresponse()

    def test_sse_forwarding_and_privacy(self):
        conn, response = self.call(headers={'Origin': 'chrome-extension://' + 'a' * 32})
        self.assertEqual(response.status, 200)
        self.assertIn('text/event-stream', response.getheader('Content-Type'))
        self.assertEqual(response.getheader('Access-Control-Allow-Origin'), 'chrome-extension://' + 'a' * 32)
        wire = response.read().decode(); conn.close()
        self.assertIn('ollama/qwen3:4b', wire); self.assertTrue(wire.endswith('data: [DONE]\n\n'))
        self.assertNotIn('PRIVATE_SENTINEL', self.g.metadata_path.read_text())
        self.assertTrue(self.g.limits['ollama'].acquire(blocking=False))
        self.g.limits['ollama'].release()

    def test_cli_converted_without_streaming_cli(self):
        self.g.config['claude']['enabled'] = True
        with patch.object(self.g, 'cli', return_value='answer'):
            conn, response = self.call('claude/haiku')
            wire = response.read().decode(); conn.close()
        self.assertIn('answer', wire); self.assertIn('[DONE]', wire)

    def test_errors_before_headers_keep_status_and_after_headers_have_no_done(self):
        def broken(*args, **kw):
            raise GatewayError(404, 'model_not_found', 'missing')
            yield
        self.g.stream_request = broken
        conn, response = self.call()
        self.assertEqual(response.status, 404); response.read(); conn.close()
        self.assertGreater(self.g.cooldown['ollama/qwen3:4b'] - time.monotonic(), 1790)
        self.g.cooldown.clear()
        def interrupted(*args, **kw):
            yield stream_event('upstream', 'first')
            raise GatewayError(502, 'upstream_error', 'PRIVATE_SENTINEL')
        self.g.stream_request = interrupted
        conn, response = self.call(); wire = response.read().decode(); conn.close()
        self.assertIn('first', wire); self.assertIn('Gateway stream failed', wire)
        self.assertNotIn('[DONE]', wire); self.assertNotIn('PRIVATE_SENTINEL', wire)

    def test_hermes_catalog_is_allowlist_intersection_cached_ten_minutes(self):
        for _ in range(2):
            ids = [m['id'] for m in self.g.models()['data'] if m['owned_by'] == 'hermes']
            self.assertEqual(ids, ['hermes/upstage/solar-mini4:free'])
        self.assertEqual(len(self.calls), 1)
        self.assertGreater(self.g.hermes_catalog[0] - time.monotonic(), 590)

    def test_health_version_comes_from_manifest(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        conn.request('GET', '/health'); response = conn.getresponse()
        self.assertEqual(json.loads(response.read())['version'], manifest_version()); conn.close()

    def test_model_advertised_by_stale_proxy_catalog_is_hidden_after_a_real_404(self):
        model = 'hermes/upstage/solar-mini4:free'
        self.assertIn(model, [m['id'] for m in self.g.models()['data']])
        def missing(*args, **kw):
            raise GatewayError(404, 'model_not_found', 'missing')
            yield
        self.g.stream_request = missing
        conn, response = self.call(model); self.assertEqual(response.status, 404); response.read(); conn.close()
        self.assertNotIn(model, [m['id'] for m in self.g.models()['data']])
        self.assertIn(model.split('/', 1)[1], self.g.config['hermes']['models'])

    def test_real_transport_reads_sse_before_upstream_finishes_and_json_fallback(self):
        release = threading.Event()
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"first"}}]}\n\n'); self.wfile.flush()
                release.wait(2)
                self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        try:
            stream = loopback_stream(f'http://127.0.0.1:{upstream.server_port}/v1/chat/completions', {'model': 'test'})
            self.assertEqual(next(stream)['choices'][0]['delta']['content'], 'first')
            self.assertFalse(release.is_set())
            release.set(); self.assertEqual(list(stream), [])
        finally:
            release.set(); upstream.shutdown(); upstream.server_close()

    def test_sjtu_idle_timeout_is_45_seconds(self):
        self.g.config['sjtu']['enabled'] = True
        def request(url, *args, **kw): return {'calls': 0}
        self.g.request = request
        timeouts = []
        def stream(*args, **kw): timeouts.append(kw['timeout']); yield stream_event('test', 'ok')
        self.g.stream_request = stream
        with patch.object(Path, 'read_text', return_value='{"proxy_token":"test-not-real"}'):
            self.g.chat({'model': 'sjtu/deepseek-chat', 'stream': True,
                'messages': [{'role': 'user', 'content': 'test'}]}, on_chunk=lambda _: None)
        self.assertEqual(timeouts, [45])


if __name__ == '__main__': unittest.main()
