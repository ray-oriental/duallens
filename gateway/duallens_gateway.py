"""Loopback-only OpenAI-compatible gateway. No prompts or credentials are logged."""
from __future__ import annotations
import argparse
import base64
import hashlib
import ctypes
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = Path.home() / ".duallens"
MAX_BODY = 1024 * 1024
DEFAULTS = {
    "port": 18790, "allowed_origins": [],
    "sjtu": {"enabled": False, "url": "http://127.0.0.1:18765", "models": ["deepseek-chat"]},
    "hermes": {"enabled": False, "url": "http://127.0.0.1:8645", "models": [
        "inclusionai/ling-3.1-flash", "meituan/longcat-2.0:free", "upstage/solar-mini4:free"]},
    "ollama": {"enabled": True, "url": "http://127.0.0.1:11434", "models": ["qwen3:4b", "gpt-oss:20b"]},
    "claude": {"enabled": False, "models": ["haiku", "sonnet"], "daily_limit": 0},
    "codex": {"enabled": False, "models": ["default"], "daily_limit": 0},
}

class GatewayError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        super().__init__(message)
        self.status, self.code, self.retry_after = status, code, retry_after

def config_load(home=HOME):
    conf = json.loads(json.dumps(DEFAULTS))
    path = home / "gateway.json"
    if path.exists():
        supplied = json.loads(path.read_text(encoding="utf-8-sig"))
        for key, value in supplied.items():
            if key in conf and isinstance(conf[key], dict) and isinstance(value, dict):
                conf[key].update(value)
            else:
                conf[key] = value
    origins = conf.get("allowed_origins")
    if not isinstance(origins, list) or any(not isinstance(origin, str) or
            not re.fullmatch(r"chrome-extension://[a-p]{32}", origin) for origin in origins):
        raise ValueError("allowed_origins must contain exact chrome-extension://<id> origins")
    if not origins:
        manifest_path = Path(__file__).resolve().parents[1] / "extension/manifest.json"
        try:
            key = json.loads(manifest_path.read_text(encoding="utf-8"))["key"]
            digest = hashlib.sha256(base64.b64decode(key, validate=True)).hexdigest()[:32]
            extension_id = "".join(chr(ord("a") + int(ch, 16)) for ch in digest)
            conf["allowed_origins"] = ["chrome-extension://" + extension_id]
        except (OSError, ValueError, KeyError):
            raise ValueError("Missing extension identity; configure explicit allowed_origins") from None
    return conf

def local_url(value):
    url = urllib.parse.urlsplit(value)
    if url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost") or url.username or url.password:
        raise GatewayError(503, "config_error", "Backend address must be loopback HTTP")
    return value.rstrip("/")

def retry_seconds(value, default=60):
    try:
        return max(1, min(600, int(float(value))))
    except (TypeError, ValueError):
        return default

def loopback_request(url, body=None, headers=None, timeout=120):
    local_url(url)
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            result = resp.read(MAX_BODY * 4 + 1)
            if len(result) > MAX_BODY * 4:
                raise GatewayError(502, "upstream_error", "Upstream response too large")
            return json.loads(result)
    except urllib.error.HTTPError as exc:
        retry = retry_seconds(exc.headers.get("Retry-After"))
        # Never reflect raw upstream messages: these may include credentials or source text.
        raise GatewayError(exc.code, "upstream_auth_failed" if exc.code in (401, 403) else
                           "rate_limited" if exc.code == 429 else "upstream_error",
                           "Upstream returned HTTP " + str(exc.code), retry) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
        raise GatewayError(503, "backend_unavailable", "Local backend unavailable", 60) from None
    except (ValueError, TypeError):
        raise GatewayError(502, "upstream_error", "Invalid upstream JSON") from None

def proxy_environment():
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("ANTHROPIC_", "CLAUDE_")) and k.upper() not in ("OPENAI_API_KEY", "OPENAI_BASE_URL")}
    if os.name == "nt" and not env.get("HTTPS_PROXY"):
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                               r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
                enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
                value = winreg.QueryValueEx(key, "ProxyServer")[0] if enabled else ""
            if value:
                values = dict(piece.split("=", 1) for piece in value.split(";") if "=" in piece)
                value = values.get("https", values.get("http", value))
                env["HTTPS_PROXY"] = value if "://" in value else "http://" + value
                env.setdefault("HTTP_PROXY", env["HTTPS_PROXY"])
        except OSError:
            pass
    return env

def memory_ready():
    if os.name != "nt":
        return True
    class Info(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in
            ("CommitTotal", "CommitLimit", "CommitPeak", "PhysicalTotal", "PhysicalAvailable",
             "SystemCache", "KernelTotal", "KernelPaged", "KernelNonpaged", "PageSize")] + [
             ("HandleCount", ctypes.c_ulong), ("ProcessCount", ctypes.c_ulong), ("ThreadCount", ctypes.c_ulong)]
    info = Info()
    info.cb = ctypes.sizeof(info)
    if not ctypes.windll.psapi.GetPerformanceInfo(ctypes.byref(info), info.cb):
        return False
    return info.CommitTotal < info.CommitLimit * .9 and (info.CommitLimit - info.CommitTotal) * info.PageSize >= 8 * 1024 ** 3

def completion(model, text):
    return {"id": "dl-" + str(time.time_ns()), "object": "chat.completion",
            "created": int(time.time()), "model": model,
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": text}}]}

class Gateway:
    def __init__(self, home=HOME, config=None, request=loopback_request):
        self.home, self.config, self.request = home, config or config_load(home), request
        self.lock = threading.Lock()
        self.cooldown, self.usage = {}, {}
        self.limits = {name: threading.BoundedSemaphore(1 if name in ("claude", "codex") else 2)
                       for name in ("sjtu", "hermes", "ollama", "claude", "codex")}
        self.large_model_lock = threading.BoundedSemaphore(1)
        self.home.mkdir(parents=True, exist_ok=True)
        self.metadata_path = self.home / "gateway.log"
        try:
            self.usage = json.loads((self.home / "usage.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass

    def metadata(self, model, chars, started, status):
        record = {"at": int(time.time()), "model": model, "chars": chars,
                  "elapsed_ms": round((time.monotonic() - started) * 1000), "status": status}
        with self.lock:
            with self.metadata_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")

    def models(self):
        return {"object": "list", "data": [{"id": name + "/" + model, "object": "model",
                    "owned_by": name} for name in self.limits if self.config.get(name, {}).get("enabled")
                    for model in self.config[name].get("models", [])]}

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise GatewayError(400, "invalid_request", "JSON object required")
        model = payload.get("model", "")
        if not isinstance(model, str) or model not in {m["id"] for m in self.models()["data"]}:
            raise GatewayError(400, "unknown_model", "Choose a model from /v1/models")
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages or len(messages) > 100:
            raise GatewayError(400, "invalid_request", "messages must be a nonempty list")
        for msg in messages:
            if not isinstance(msg, dict) or msg.get("role") not in ("system", "user", "assistant") or not isinstance(msg.get("content"), str):
                raise GatewayError(400, "invalid_request", "Only text messages are supported")
        if payload.get("stream"):
            raise GatewayError(400, "unsupported", "Streaming is not supported")
        budget = payload.get("max_tokens", 2048)
        if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 8192:
            raise GatewayError(400, "invalid_request", "max_tokens must be an integer from 1 to 8192")
        return model, messages

    def cli(self, backend, model, messages):
        sandbox = self.home / "cli-sandbox"
        sandbox.mkdir(exist_ok=True)
        env = proxy_environment()
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        prompt = "\n\n".join(m["content"] for m in messages if m["role"] != "system")
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        with tempfile.TemporaryDirectory(prefix="cli-", dir=self.home) as tmp:
            sandbox = Path(tmp) / "cwd"
            sandbox.mkdir()
            out = Path(tmp) / "answer.txt"
            if backend == "claude":
                exe = Path(os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming"))) / "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"
                system_file = Path(tmp) / "system.txt"
                system_file.write_text(system, encoding="utf-8")
                args = [str(exe), "-p", "--model", model, "--tools", "", "--restricted",
                        "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands",
                        "--system-prompt-file", str(system_file), "--output-format", "json"]
            else:
                import shutil
                node = shutil.which("node")
                script = Path(os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming"))) / "npm/node_modules/@openai/codex/bin/codex.js"
                args = [node or "node", str(script), "exec", "-s", "read-only", "--skip-git-repo-check",
                        "--ephemeral", "--ignore-user-config", "-c", 'web_search="disabled"', "-c", "features.shell_tool=false",
                        "-c", "features.unified_exec=false", "-c", "features.js_repl=false", "-c", "project_doc_max_bytes=0",
                        "-c", "features.apps=false", "-c", "features.multi_agent=false",
                        "--json", "-o", str(out)]
                configured = self.config["codex"].get("model") if model == "default" else model
                if configured:
                    args += ["-m", configured]
                args += ["-"]
                prompt = "只做文本翻译；禁止使用任何工具、读取文件或执行技能。只输出规定格式的结果。\n" + system + "\n\n" + prompt
            try:
                proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        cwd=sandbox, env=env, creationflags=flags)
            except OSError:
                raise GatewayError(503, "backend_unavailable", "Subscription CLI not installed", 60) from None
            try:
                stdout, _ = proc.communicate(prompt.encode("utf-8"), timeout=180)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
                else:
                    proc.kill()
                proc.communicate()
                raise GatewayError(504, "backend_timeout", "Subscription CLI timed out", 60) from None
            if proc.returncode:
                raise GatewayError(503, "backend_unavailable", "Subscription CLI failed; check its login separately", 60)
            try:
                if backend == "claude":
                    data = json.loads(stdout)
                    if data.get("is_error"):
                        result = str(data.get("result", "")).lower()
                        if "limit" in result and ("hit" in result or "reset" in result):
                            raise GatewayError(429, "subscription_limited", "Claude subscription window is exhausted", 60)
                        raise GatewayError(503, "backend_unavailable", "Claude returned an error", 60)
                    text = data["result"]
                else:
                    # A translation CLI must not attempt tools even if the model was injected.
                    for line in stdout.decode("utf-8", errors="replace").splitlines():
                        event = json.loads(line)
                        item = event.get("item", {})
                        if item.get("type") in ("command_execution", "mcp_tool_call", "web_search", "web_search_call", "file_change"):
                            raise GatewayError(502, "unsafe_output", "Translation attempted a tool call")
                    text = out.read_text(encoding="utf-8")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError()
                return text.strip()
            except (ValueError, OSError, KeyError):
                raise GatewayError(502, "upstream_error", "Invalid subscription CLI output") from None

    def chat(self, payload):
        model, messages = self.validate(payload)
        backend, suffix = model.split("/", 1)
        started = time.monotonic()
        status, chars = 200, sum(len(m["content"]) for m in messages)
        acquired = False
        large_acquired = False
        try:
            with self.lock:
                until = self.cooldown.get(model, 0)
                if until > time.monotonic():
                    raise GatewayError(503, "backend_unavailable", "Model is cooling down", retry_seconds(until - time.monotonic()))
            acquired = self.limits[backend].acquire(blocking=False)
            if not acquired:
                raise GatewayError(429, "rate_limited", "Backend concurrency limit reached", 2)
            cap = int(self.config[backend].get("daily_limit", 0))
            day = time.strftime("%Y-%m-%d")
            key = day + "/" + backend
            with self.lock:
                if cap > 0 and self.usage.get(key, 0) >= cap:
                    raise GatewayError(429, "daily_limit", "Configured daily limit reached", 600)
                self.usage[key] = self.usage.get(key, 0) + 1
                self.usage = {k: v for k, v in self.usage.items() if k.startswith(day)}
                temp = self.home / "usage.tmp"
                temp.write_text(json.dumps(self.usage), encoding="utf-8")
                temp.replace(self.home / "usage.json")
            if backend in ("claude", "codex"):
                return completion(model, self.cli(backend, suffix, messages))
            base = local_url(self.config[backend]["url"])
            forwarded = {k: payload[k] for k in ("messages", "temperature", "max_tokens", "response_format") if k in payload}
            forwarded.update(model=suffix, stream=False)
            forwarded.setdefault("max_tokens", 2048)
            headers = {}
            if backend == "sjtu":
                ledger = self.request(base + "/ledger", timeout=5)
                if ledger.get("calls", 0) >= 4 or ledger.get("paused_for", 0) > 0:
                    raise GatewayError(429, "rate_limited", "SJTU background lane deferred",
                                       retry_seconds(ledger.get("paused_for") or 15))
                try:
                    token = json.loads((Path.home() / ".ddl-hub/config.json").read_text(encoding="utf-8-sig"))["proxy_token"]
                except (OSError, KeyError, ValueError):
                    raise GatewayError(503, "backend_unavailable", "SJTU relay not configured", 60) from None
                headers = {"Authorization": "Bearer " + token, "X-DDLHub-Lane": "background"}
            if backend == "ollama":
                size = re.search(r"(\d+(?:\.\d+)?)b\b", suffix, re.I)
                if size and float(size.group(1)) >= 20:
                    if not memory_ready():
                        raise GatewayError(503, "backend_unavailable", "Insufficient commit memory for large local model", 60)
                    large_acquired = self.large_model_lock.acquire(blocking=False)
                    if not large_acquired:
                        raise GatewayError(429, "rate_limited", "Large local model is busy", 2)
                forwarded.update(reasoning_effort="none" if "qwen3" in suffix else "low", keep_alive="10m", temperature=0)
            if backend == "hermes":
                forwarded["reasoning_effort"] = "none"
            try:
                result = self.request(base + "/v1/chat/completions", forwarded, headers, timeout=120)
            except GatewayError as exc:
                if backend != "hermes" or exc.status != 400 or "response_format" not in forwarded:
                    raise
                forwarded.pop("response_format")
                result = self.request(base + "/v1/chat/completions", forwarded, headers, timeout=120)
            if not isinstance(result, dict) or not isinstance(result.get("choices"), list) or not result["choices"]:
                raise GatewayError(502, "upstream_error", "Missing upstream choices")
            result["model"] = model
            return result
        except GatewayError as exc:
            status = exc.status
            if exc.status in (401, 403, 429, 502, 503, 504):
                duration = 600 if backend == "hermes" and exc.status in (401, 403) else exc.retry_after or 60
                with self.lock:
                    self.cooldown[model] = time.monotonic() + duration
            raise
        finally:
            if acquired:
                self.limits[backend].release()
            if large_acquired:
                self.large_model_lock.release()
            self.metadata(model, chars, started, status)

class Handler(BaseHTTPRequestHandler):
    server_version = "DualLens/0.1"
    def log_message(self, *_):
        pass

    def guard(self):
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or hosts[0] not in ("127.0.0.1:" + str(self.server.server_port),
                                              "localhost:" + str(self.server.server_port)):
            raise GatewayError(403, "forbidden_host", "Loopback Host required")
        origins = self.headers.get_all("Origin", [])
        origin = origins[0] if origins else None
        if len(origins) > 1 or (origin is not None and not re.fullmatch(r"chrome-extension://[a-p]{32}", origin)):
            raise GatewayError(403, "forbidden_origin", "Browser extension Origin required")
        allowed = self.server.gateway.config.get("allowed_origins", [])
        if origin and allowed and origin not in allowed:
            raise GatewayError(403, "forbidden_origin", "Extension Origin not allowed")
        self.allowed_origin = origin

    def respond(self, status, body, retry=None):
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "allowed_origin", None):
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin)
            self.send_header("Vary", "Origin")
        if retry:
            self.send_header("Retry-After", str(retry))
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def error(self, exc):
        self.respond(exc.status, {"error": {"message": str(exc), "code": exc.code, "type": "gateway_error"}}, exc.retry_after)

    def do_OPTIONS(self):
        try:
            self.guard()
            if not self.allowed_origin:
                raise GatewayError(403, "forbidden_origin", "Origin required")
            if self.headers.get("Access-Control-Request-Method") not in ("GET", "POST"):
                raise GatewayError(403, "forbidden_method", "Method not allowed")
            requested = {h.strip().lower() for h in self.headers.get("Access-Control-Request-Headers", "").split(",") if h.strip()}
            if requested - {"content-type", "authorization"}:
                raise GatewayError(403, "forbidden_headers", "Header not allowed")
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Length", "0")
            self.end_headers()
        except GatewayError as exc:
            self.error(exc)

    def do_GET(self):
        try:
            self.guard()
            if self.path == "/health":
                body = {"ok": True, "name": "DualLens", "version": "0.1.0"}
            elif self.path == "/v1/models":
                body = self.server.gateway.models()
            else:
                raise GatewayError(404, "not_found", "Unknown path")
            self.respond(200, body)
        except GatewayError as exc:
            self.error(exc)

    def do_POST(self):
        try:
            self.guard()
            if self.path != "/v1/chat/completions":
                raise GatewayError(404, "not_found", "Unknown path")
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                raise GatewayError(415, "unsupported_media_type", "application/json required")
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not lengths[0].isdigit() or self.headers.get("Transfer-Encoding"):
                raise GatewayError(400, "invalid_request", "One valid Content-Length required")
            length = int(lengths[0])
            if length > MAX_BODY:
                raise GatewayError(413, "request_too_large", "Body exceeds 1 MiB")
            self.connection.settimeout(10)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise GatewayError(400, "invalid_request", "Incomplete request body")
            payload = json.loads(raw)
            self.respond(200, self.server.gateway.chat(payload))
        except GatewayError as exc:
            self.error(exc)
        except (ValueError, TypeError, socket.timeout):
            self.error(GatewayError(400, "invalid_request", "Invalid JSON request"))
        except Exception:
            self.error(GatewayError(500, "internal_error", "Gateway internal error"))

def make_server(port=18790, gateway=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.gateway = gateway or Gateway()
    return server

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["serve"])
    parser.add_argument("--port", type=int)
    opts = parser.parse_args()
    gateway = Gateway()
    server = make_server(opts.port if opts.port is not None else int(gateway.config["port"]), gateway)
    print("DualLens listening on 127.0.0.1:" + str(server.server_port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
