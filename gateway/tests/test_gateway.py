import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from gateway.duallens_gateway import DEFAULTS, Gateway, GatewayError, completion, local_url, make_server, proxy_environment

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []
        self.config = copy.deepcopy(DEFAULTS)
        for backend in ("sjtu", "hermes", "ollama", "claude", "codex"):
            self.config[backend]["enabled"] = True
        def request(url, body=None, headers=None, timeout=120):
            self.calls.append((url, body, headers))
            if url.endswith("/ledger"):
                return {"calls": 0, "paused_for": 0}
            return completion("upstream", '{"t":["你好"]}')
        self.g = Gateway(Path(self.temp.name), self.config, request)
        self.server = make_server(0, self.g)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()
    def call(self, method="GET", path="/health", payload=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        h = {"Content-Type": "application/json", **(headers or {})}
        conn.request(method, path, json.dumps(payload) if payload is not None else None, h)
        resp = conn.getresponse()
        data = resp.read()
        result = resp.status, dict(resp.getheaders()), json.loads(data) if data else None
        conn.close()
        return result
    def payload(self, model="ollama/qwen3:4b"):
        return {"model": model, "messages": [{"role": "user", "content": "PRIVATE_SENTINEL"}], "max_tokens": 200}
    def test_health_and_models(self):
        self.assertTrue(self.call()[2]["ok"])
        ids = [m["id"] for m in self.call(path="/v1/models")[2]["data"]]
        self.assertIn("sjtu/deepseek-chat", ids)
        self.assertIn("codex/default", ids)
    def test_rebinding_host_denied(self):
        self.assertEqual(self.call(headers={"Host": "evil.example"})[0], 403)
    def test_browser_origins_denied(self):
        for origin in ["https://evil.example", "null", "chrome-extension://wrong"]:
            self.assertEqual(self.call(headers={"Origin": origin})[0], 403)
    def test_extension_origin_and_optional_allowlist(self):
        origin = "chrome-extension://" + "a" * 32
        status, headers, _ = self.call(headers={"Origin": origin})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
        self.g.config["allowed_origins"] = ["chrome-extension://" + "b" * 32]
        self.assertEqual(self.call(headers={"Origin": origin})[0], 403)

    def test_multiple_explicit_extension_origins_are_allowed(self):
        dev = "chrome-extension://" + "a" * 32
        store = "chrome-extension://" + "b" * 32
        self.g.config["allowed_origins"] = [dev, store]
        self.assertEqual(self.call(headers={"Origin": dev})[0], 200)
        self.assertEqual(self.call(headers={"Origin": store})[0], 200)

    def test_config_rejects_wildcard_or_web_origin(self):
        from gateway.duallens_gateway import config_load
        for value in [["*"], ["https://example.test"], ["chrome-extension://" + "a" * 31]]:
            with tempfile.TemporaryDirectory() as tmp:
                Path(tmp, "gateway.json").write_text(json.dumps({"allowed_origins": value}), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "allowed_origins"):
                    config_load(Path(tmp))
    def test_preflight(self):
        self.assertEqual(self.call("OPTIONS", headers={"Origin": "chrome-extension://" + "a"*32,
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})[0], 204)
        self.assertEqual(self.call("OPTIONS", headers={"Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST"})[0], 403)
    def test_simple_form_csrf_denied(self):
        self.assertEqual(self.call("POST", "/v1/chat/completions", self.payload(),
                                   {"Content-Type": "text/plain"})[0], 415)
    def test_model_and_payload_validation(self):
        for model in ["hermes/paid-model", "claude/../../cmd", "sjtu/deepseek-reasoner", "evil/model"]:
            self.assertEqual(self.call("POST", "/v1/chat/completions", self.payload(model))[0], 400)
        for invalid in [True, 0, "300", 99999]:
            p = self.payload();p["max_tokens"] = invalid
            self.assertEqual(self.call("POST", "/v1/chat/completions", p)[0], 400)
    def test_invalid_stream_and_multimodal_denied(self):
        p = self.payload();p["stream"] = "yes"
        self.assertEqual(self.call("POST", "/v1/chat/completions", p)[0], 400)
        p = self.payload();p["messages"][0]["content"] = [{"type": "image"}]
        self.assertEqual(self.call("POST", "/v1/chat/completions", p)[0], 400)
    def test_body_limit(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        conn.putrequest("POST", "/v1/chat/completions")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(1024 * 1024 + 1))
        conn.endheaders()
        response = conn.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        conn.close()
    def test_forwarding_and_metadata_privacy(self):
        status, _, response = self.call("POST", "/v1/chat/completions", self.payload())
        self.assertEqual(status, 200)
        self.assertEqual(response["model"], "ollama/qwen3:4b")
        self.assertEqual(self.calls[0][1]["reasoning_effort"], "none")
        self.assertEqual(self.calls[0][1]["max_tokens"], 200)
        self.assertNotIn("PRIVATE_SENTINEL", self.g.metadata_path.read_text())
    def test_sjtu_busy_precheck_does_not_send_text(self):
        self.g.request = lambda *a, **kw: {"calls": 4, "paused_for": 0}
        with self.assertRaises(GatewayError) as ctx:
            self.g.chat(self.payload("sjtu/deepseek-chat"))
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(ctx.exception.retry_after, 15)
    def test_upstream_cooldown_prevents_repeat(self):
        calls = []
        def fail(*args, **kwargs):
            calls.append(1);raise GatewayError(401, "upstream_auth_failed", "unauthorized", 1)
        self.g.request = fail
        for _ in range(2):
            with self.assertRaises(GatewayError):
                self.g.chat(self.payload("hermes/upstage/solar-mini4:free"))
        self.assertEqual(len(calls), 1)
    def test_subscription_manual_without_daily_cap(self):
        self.assertEqual(self.g.config["claude"]["daily_limit"], 0)
        self.assertEqual(self.g.config["codex"]["daily_limit"], 0)
        with patch.object(self.g, "cli", return_value='{"t":["你好"]}') as cli:
            self.g.chat(self.payload("claude/haiku"))
            cli.assert_called_once()
    def test_local_url_only(self):
        for url in ["https://example.com", "http://127.0.0.1.evil.test", "http://user:pass@localhost:1"]:
            with self.assertRaises(GatewayError):
                local_url(url)
    def test_api_credentials_not_in_subscription_environment(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "TEST_SENTINEL", "ANTHROPIC_AUTH_TOKEN": "TEST_SENTINEL"}):
            env = proxy_environment()
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertNotIn("ANTHROPIC_AUTH_TOKEN", env)

class RuntimePolicyTests(unittest.TestCase):
    def test_fresh_gateway_excludes_optional_account_backends(self):
        from gateway.duallens_gateway import config_load
        with tempfile.TemporaryDirectory() as tmp:
            gateway = Gateway(Path(tmp), config_load(Path(tmp)))
            models = [x["id"] for x in gateway.models()["data"]]
        self.assertTrue(models)
        self.assertTrue(all(x.startswith("ollama/") for x in models))

    def test_real_manifest_identity_is_used_for_origin_allowlist(self):
        from gateway.duallens_gateway import config_load
        with tempfile.TemporaryDirectory() as tmp:
            config = config_load(Path(tmp))
        self.assertEqual(config["allowed_origins"], ["chrome-extension://noodgdnebcnfkgipoabjjlgaebocgnkj"])

    def test_claude_and_codex_receive_no_tools_and_no_api_key(self):
        import subprocess
        from gateway.duallens_gateway import config_load
        with tempfile.TemporaryDirectory() as tmp:
            config = copy.deepcopy(DEFAULTS)
            gateway = Gateway(Path(tmp), config)
            captured = []
            class FakeProc:
                pid = 1
                returncode = 0
                def communicate(self, data=None, timeout=None):
                    self.data = data
                    return b'{"result":"translated","is_error":false}', b""
            def popen(args, **kwargs):
                captured.append((args, kwargs))
                if "-o" in args:
                    Path(args[args.index("-o")+1]).write_text('{"t":["translated"]}', encoding="utf-8")
                return FakeProc()
            with patch("gateway.duallens_gateway.subprocess.Popen", side_effect=popen), \
                 patch.dict("os.environ", {"OPENAI_API_KEY": "TEST_SENTINEL"}):
                gateway.cli("claude", "haiku", [{"role":"user","content":"SOURCE_SENTINEL"}])
                gateway.cli("codex", "default", [{"role":"user","content":"SOURCE_SENTINEL"}])
            claude, codex = captured
            self.assertEqual(claude[0][claude[0].index("--tools")+1], "")
            self.assertIn("--restricted", claude[0])
            self.assertIn('web_search="disabled"', codex[0])
            self.assertIn("features.shell_tool=false", codex[0])
            for args, kwargs in captured:
                self.assertNotIn("SOURCE_SENTINEL", " ".join(args))
                self.assertNotIn("OPENAI_API_KEY", kwargs["env"])
                self.assertFalse(kwargs.get("shell", False))
                self.assertFalse(Path(kwargs["cwd"]).exists(), "temporary CLI working directory cleaned")

if __name__ == "__main__":
    unittest.main()
