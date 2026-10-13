import base64
import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock

from gateway import duallens_gateway as g

TOKEN = 'A' * 43  # Deliberately fake; all storage is temporary.

class PairingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.config = copy.deepcopy(g.DEFAULTS)
        self.home.joinpath('remote_token').write_text(TOKEN, encoding='ascii')
        self.gateway = g.Gateway(self.home, self.config, request=lambda *a, **kw: g.completion('mock', 'ok'))
        self.server = g.make_server(0, self.gateway)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def call(self, method='GET', path='/health', headers=None, body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        conn.request(method, path, body, headers or {})
        response = conn.getresponse()
        status, headers, raw = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return status, headers, raw

    def remote(self):
        # Actual test socket remains loopback. Construction tests inspect the Tailscale bind separately.
        self.server.remote = True
        self.server.allowed_hosts = {'100.100.2.3:18791', 'computer.tail-test.ts.net:18791'}

    def auth(self, **headers):
        return {'Host': '100.100.2.3:18791', 'Authorization': 'Bearer ' + TOKEN, **headers}

    def test_remote_defaults_disabled_and_bind_exact_tailnet_only(self):
        self.assertFalse(g.DEFAULTS['remote']['enabled'])
        with self.assertRaises(ValueError):
            g.make_remote_server(self.gateway)
        self.config['remote']['enabled'] = True
        for address in ('0.0.0.0', '192.168.1.2', '127.0.0.1', '::', '::1', '100.63.255.255', '100.128.0.0'):
            with self.subTest(address=address), self.assertRaises(ValueError):
                g.make_remote_server(self.gateway, lambda: (address, ''))
        with patch.object(g, 'ThreadingHTTPServer') as server:
            g.make_remote_server(self.gateway, lambda: ('100.100.2.3', 'computer.tail-test.ts.net'))
            server.assert_called_once_with(('100.100.2.3', 18791), g.Handler)
            self.assertEqual(server.return_value.allowed_hosts, {'100.100.2.3:18791', 'computer.tail-test.ts.net:18791'})
        self.home.joinpath('remote_token').unlink()
        with self.assertRaisesRegex(ValueError, 'pair'):
            g.make_remote_server(self.gateway, lambda: ('100.100.2.3', ''))

    def test_remote_auth_every_route_and_method(self):
        self.remote()
        for method, path in [('GET', '/health'), ('GET', '/v1/models'), ('POST', '/v1/chat/completions'), ('OPTIONS', '/health'), ('DELETE', '/health'), ('UNKNOWN', '/health')]:
            self.assertEqual(self.call(method, path, {'Host': '100.100.2.3:18791'})[0], 401)
        self.assertEqual(self.call(headers=self.auth())[0], 200)
        self.assertEqual(self.call(headers=self.auth(Authorization='Bearer wrong'))[0], 401)
        self.assertEqual(self.call(path='/v1/models', headers=self.auth())[0], 200)
        self.assertEqual(self.call(path='/private', headers=self.auth())[0], 404)

    def test_exact_remote_host_and_magicdns(self):
        self.remote()
        for host in ('evil.example', '100.100.2.3', '100.100.2.3:18790', '127.0.0.1:18791', 'other.tail-test.ts.net:18791'):
            self.assertEqual(self.call(headers=self.auth(Host=host))[0], 403)
        self.assertEqual(self.call(headers=self.auth(Host='computer.tail-test.ts.net:18791'))[0], 200)

    def test_auth_failure_window_cooldown_and_per_ip(self):
        with patch.object(g.time, 'monotonic', return_value=100):
            for _ in range(10):
                with self.assertRaises(g.GatewayError) as error:
                    self.gateway.authenticate('100.100.1.1', ['Bearer wrong'], True)
                self.assertEqual(error.exception.status, 401)
            with self.assertRaises(g.GatewayError) as error:
                self.gateway.authenticate('100.100.1.1', [], True)
            self.assertEqual((error.exception.status, error.exception.retry_after), (429, 600))
            with self.assertRaises(g.GatewayError):
                self.gateway.authenticate('100.100.1.1', ['Bearer ' + TOKEN], True)
            self.assertTrue(self.gateway.authenticate('100.100.1.2', ['Bearer ' + TOKEN], True))
        with patch.object(g.time, 'monotonic', return_value=701):
            self.assertTrue(self.gateway.authenticate('100.100.1.1', ['Bearer ' + TOKEN], True))
        # More than 60 seconds apart must not accumulate towards the threshold.
        for t in range(0, 1000, 61):
            with patch.object(g.time, 'monotonic', return_value=t), self.assertRaises(g.GatewayError) as error:
                self.gateway.authenticate('100.100.1.3', [], True)
            self.assertEqual(error.exception.status, 401)

    def test_wrong_token_http_rate_limit(self):
        self.remote()
        for _ in range(10):
            self.assertEqual(self.call(headers=self.auth(Authorization='Bearer wrong'))[0], 401)
        status, headers, _ = self.call(headers=self.auth(Authorization='Bearer wrong'))
        self.assertEqual(status, 429)
        self.assertEqual(headers['Retry-After'], '600')

    def test_success_does_not_erase_failed_attempts_and_duplicate_headers_fail(self):
        with patch.object(g.time, 'monotonic', return_value=100):
            for _ in range(10):
                with self.assertRaises(g.GatewayError):
                    self.gateway.authenticate('100.100.1.1', ['Bearer wrong'], True)
                self.assertTrue(self.gateway.authenticate('100.100.1.1', ['Bearer ' + TOKEN], True))
            with self.assertRaises(g.GatewayError) as error:
                self.gateway.authenticate('100.100.1.1', ['Bearer wrong'], True)
            self.assertEqual(error.exception.status, 429)
            with self.assertRaises(g.GatewayError) as error:
                self.gateway.authenticate('100.100.1.2', ['Bearer ' + TOKEN, 'Bearer ' + TOKEN], True)
            self.assertEqual(error.exception.status, 401)

    def test_usb_token_bypasses_origin_but_never_host(self):
        headers = {'Authorization': 'Bearer ' + TOKEN, 'Origin': 'https://example.test'}
        self.assertEqual(self.call(headers=headers)[0], 200)
        self.assertEqual(self.call(headers={**headers, 'Host': 'evil.test'})[0], 403)
        self.assertEqual(self.call(headers={'Origin': 'https://example.test'})[0], 403)
        self.assertEqual(self.call(headers={'Origin': 'https://example.test', 'Authorization': 'Bearer wrong'})[0], 401)
        # Loopback requests without a token retain their old rules even while paired clients cool down.
        self.gateway.auth_failures['127.0.0.1'] = ([], g.time.monotonic() + 600)
        self.assertEqual(self.call()[0], 200)

    def test_remote_body_limit_and_metadata_privacy(self):
        self.remote()
        status, _, _ = self.call('POST', '/v1/chat/completions', self.auth(**{'Content-Type': 'application/json'}),
                                json.dumps({'model': 'ollama/qwen3:4b', 'messages': [{'role': 'user', 'content': 'PRIVATE_SENTINEL'}]}))
        self.assertEqual(status, 200)
        logs = self.gateway.metadata_path.read_text()
        self.assertNotIn(TOKEN, logs)
        self.assertNotIn('PRIVATE_SENTINEL', logs)
        self.assertEqual(self.call('POST', '/v1/chat/completions', self.auth(**{'Content-Type': 'application/json', 'Content-Length': str(g.MAX_BODY + 1)}))[0], 413)

    def test_pair_rotation_qr_and_no_other_secret_files(self):
        output = []
        discover = lambda: ('100.100.2.3', '')
        text = g.pair(self.home, config=self.config, discover=discover, output=output.append)
        payload = json.loads(base64.urlsafe_b64decode(text.split(':', 2)[2] + '==='))
        self.assertEqual(payload['token'], TOKEN)
        self.assertEqual(payload['urls'], ['http://127.0.0.1:18790/v1', 'http://100.100.2.3:18791/v1'])
        self.assertTrue(any('██' in row for row in output))
        g.pair(self.home, True, self.config, discover, output.append)
        self.assertNotEqual(g.read_remote_token(self.home), TOKEN)
        self.assertEqual({p.name for p in self.home.iterdir()}, {'remote_token'})
        with self.assertRaises(g.GatewayError):
            self.gateway.authenticate('100.100.2.2', ['Bearer ' + TOKEN], True)

    def test_setup_status_probe_no_credentials_and_explicit_optin(self):
        answers = iter(['y', '', 'yes', 'n', 'n'])
        states = dict.fromkeys(('sjtu', 'hermes', 'ollama', 'claude', 'codex'), True)
        output = []
        g.setup(self.home, lambda question: next(answers), output.append, lambda conf: states)
        conf = g.config_load(self.home)
        self.assertTrue(conf['sjtu']['enabled'])
        self.assertFalse(conf['hermes']['enabled'])
        self.assertFalse(conf['remote']['enabled'])
        with patch.object(g, 'read_remote_token', side_effect=AssertionError('status read token')):
            g.status(self.home, output.append, lambda conf: states, lambda: ('100.100.2.3', ''))
        self.assertNotIn(TOKEN, '\n'.join(output))
        calls = []
        def probe(url, **kw):
            calls.append((url, kw)); return {}
        with patch.object(g.shutil, 'which', return_value=None), patch.object(Path, 'is_file', return_value=False):
            found = g.backend_status(conf, probe)
        self.assertEqual(len(calls), 3)
        self.assertTrue(found['sjtu'])
        self.assertFalse(found['claude'])
        self.assertTrue(all('headers' not in kw for _, kw in calls))
        conf['remote']['enabled'] = True
        self.home.joinpath('gateway.json').write_text(json.dumps(conf), encoding='utf-8')
        with patch.object(g, 'read_remote_token', side_effect=AssertionError('status read token')):
            g.status(self.home, output.append, lambda conf: states, lambda: ('100.100.2.3', ''), lambda ip, port: True)
        self.assertIn('TCP reachable', output[-1])

    def test_listener_probe_is_tcp_only_and_never_arbitrary_network(self):
        with patch.object(g.socket, 'create_connection') as connect:
            self.assertFalse(g.listener_reachable('192.168.1.2', 18791))
            connect.assert_not_called()
            self.assertTrue(g.listener_reachable('100.100.2.3', 18791))
            connect.assert_called_once_with(('100.100.2.3', 18791), timeout=2)

    def test_tailscale_cli_discovery_and_invalid_output(self):
        with patch.object(g.shutil, 'which', return_value='tailscale'), patch.object(g.subprocess, 'run') as run:
            run.side_effect = [Mock(returncode=0, stdout='100.100.2.3\n'), Mock(returncode=0, stdout='{"Self":{"DNSName":"pc.tail-test.ts.net."}}')]
            self.assertEqual(g.tailscale_identity(), ('100.100.2.3', 'pc.tail-test.ts.net'))
            self.assertEqual(run.call_args_list[0].args[0], ['tailscale', 'ip', '-4'])
            run.side_effect = [Mock(returncode=0, stdout='0.0.0.0\n')]
            with self.assertRaises(ValueError):
                g.tailscale_identity()
