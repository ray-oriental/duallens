"""OpenAI-compatible gateway; loopback by default, optional authenticated Tailscale listener."""
from __future__ import annotations
import argparse
import base64
import hashlib
import hmac
import ipaddress
import secrets
import shutil
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
    "remote": {"enabled": False, "port": 18791},
    "sjtu": {"enabled": False, "url": "http://127.0.0.1:18765", "models": ["deepseek-chat"]},
    "hermes": {"enabled": False, "url": "http://127.0.0.1:8645", "models": [
        "upstage/solar-mini4:free"]},
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

def tailscale_identity():
    """Ask the local Tailscale daemon; never accept a configured arbitrary bind address."""
    exe = shutil.which("tailscale")
    if not exe and os.name == "nt":
        for candidate in (Path(r"D:\application\tailscale\tailscale.exe"),
                          Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Tailscale/tailscale.exe"):
            if candidate.is_file():
                exe = str(candidate)
                break
    if not exe:
        raise ValueError("Tailscale is not installed or available")
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run([exe, "ip", "-4"], capture_output=True, text=True, timeout=5, creationflags=flags)
        addresses = result.stdout.strip().splitlines()
        if result.returncode or len(addresses) != 1 or not is_tailscale_ip(addresses[0]):
            raise ValueError("No local Tailscale IPv4 address")
        name = ""
        status = subprocess.run([exe, "status", "--json"], capture_output=True, text=True, timeout=5, creationflags=flags)
        if not status.returncode:
            data = json.loads(status.stdout)
            candidate = data.get("Self", {}).get("DNSName", "").rstrip(".").lower()
            if re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", candidate) and candidate.endswith(".ts.net"):
                name = candidate
        return addresses[0], name
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        raise ValueError("Tailscale IPv4 discovery failed; remote listener stays closed") from None

def is_tailscale_ip(value):
    try:
        return ipaddress.ip_address(value) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False

def read_remote_token(home):
    path = home / "remote_token"
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 128:
            return ""
        token = path.read_text(encoding="ascii").strip()
        return token if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) else ""
    except (OSError, UnicodeError):
        return ""

def pair(home=HOME, rotate=False, config=None, discover=tailscale_identity, output=print):
    """Only this explicit terminal command displays the pairing credential."""
    home.mkdir(parents=True, exist_ok=True)
    path = home / "remote_token"
    if path.is_symlink():
        raise ValueError("remote_token must be a regular private file")
    token = read_remote_token(home)
    if rotate or not token:
        token = secrets.token_urlsafe(32)
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(path, flags, 0o600), "w", encoding="ascii") as fh:
            fh.write(token)
        if os.name != "nt":
            path.chmod(0o600)
    conf = config or config_load(home)
    urls = ["http://127.0.0.1:" + str(conf["port"]) + "/v1"]
    try:
        address, _ = discover()
        if not is_tailscale_ip(address):
            raise ValueError("Invalid Tailscale IPv4")
        urls.append("http://" + address + ":" + str(conf["remote"]["port"]) + "/v1")
    except ValueError:
        output("Tailscale unavailable: USB pairing only.")
    payload = json.dumps({"urls": urls, "token": token}, separators=(",", ":"))
    text = "duallens-pair:v1:" + base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    # Import lazily so normal serving is independent of terminal rendering.
    try:
        from gateway.qrcodegen import QrCode
    except ModuleNotFoundError:
        from qrcodegen import QrCode
    qr = QrCode.encode_text(text, QrCode.Ecc.LOW)
    output("Pairing grants access to enabled backends. Keep this terminal private; pair --rotate revokes old tokens.")
    output(text)
    # Two square modules per terminal cell, with a four-module quiet zone.
    for y in range(-4, qr.get_size() + 4):
        output("\033[30;47m" + "".join("██" if qr.get_module(x, y) else "  " for x in range(-4, qr.get_size() + 4)) + "\033[0m")
    return text

def backend_status(config, request=None):
    # Defined above the transport; resolve it at call time.
    request = request or loopback_request
    states = {}
    for name in ("sjtu", "hermes", "ollama"):
        try:
            request(local_url(config[name]["url"]) + ("/health" if name == "sjtu" else "/v1/models"), timeout=2)
            states[name] = True
        except (GatewayError, OSError, ValueError):
            states[name] = False
    npm = Path(os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming"))) / "npm/node_modules"
    states["claude"] = (npm / "@anthropic-ai/claude-code/bin/claude.exe").is_file() or bool(shutil.which("claude"))
    states["codex"] = (npm / "@openai/codex/bin/codex.js").is_file() or bool(shutil.which("codex"))
    return states

def setup(home=HOME, ask=input, output=print, probe=backend_status):
    conf = config_load(home)
    states = probe(conf)
    for name, available in states.items():
        output(name + (": available (login not checked)" if available else ": unavailable"))
        answer = ask("Enable " + name + "? [y/N] ").strip().lower()
        conf[name]["enabled"] = answer in ("y", "yes")
    if conf["hermes"]["enabled"]:
        # Retain only the explicit free-model allowlist intersection, never add
        # arbitrary models advertised by the proxy.
        discovery = Gateway(home, config=conf)
        conf["hermes"]["models"] = discovery.hermes_models()
    # Setup never enables remote access; explicit local config is required.
    home.mkdir(parents=True, exist_ok=True)
    (home / "gateway.json").write_text(json.dumps(conf, indent=2) + "\n", encoding="utf-8")
    output("Saved gateway.json. Restart gateway to apply; remote access was not enabled by setup.")

def listener_reachable(address, port):
    """TCP-only probe: does not read a token or consume an authentication failure."""
    if not is_tailscale_ip(address) or isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        return False
    try:
        with socket.create_connection((address, port), timeout=2):
            return True
    except OSError:
        return False

def status(home=HOME, output=print, probe=backend_status, discover=tailscale_identity, listener=listener_reachable):
    conf = config_load(home)
    for name, available in probe(conf).items():
        output(name + ": " + ("enabled" if conf[name]["enabled"] else "disabled") +
               ", " + ("available (login not checked)" if available else "unavailable"))
    try:
        address, _ = discover()
    except ValueError:
        address = "unavailable"
    reachable = listener(address, conf["remote"]["port"]) if conf["remote"]["enabled"] and is_tailscale_ip(address) else False
    output("remote: " + ("configured enabled" if conf["remote"]["enabled"] else "disabled") +
           ", Tailscale IPv4 " + address + ", port " + str(conf["remote"]["port"]) +
           ("; TCP reachable (identity/auth not checked)" if reachable else "; no reachable configured listener"))

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
                           "rate_limited" if exc.code == 429 else "model_not_found" if exc.code == 404 else "upstream_error",
                           "Upstream returned HTTP " + str(exc.code), retry) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
        raise GatewayError(503, "backend_unavailable", "Local backend unavailable", 60) from None
    except (ValueError, TypeError):
        raise GatewayError(502, "upstream_error", "Invalid upstream JSON") from None

def manifest_version():
    try:
        return json.loads((Path(__file__).resolve().parents[1] / "extension/manifest.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        return "unknown"


def stream_event(model, text, finish=None):
    return {"object": "chat.completion.chunk", "model": model,
            "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": finish}]}


def loopback_stream(url, body, headers=None, timeout=45):
    """Read bounded SSE events; socket timeout is an inactivity timeout, not total duration."""
    local_url(url)
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream", **(headers or {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            if "text/event-stream" not in resp.headers.get("Content-Type", ""):
                raw = resp.read(MAX_BODY * 4 + 1)
                if len(raw) > MAX_BODY * 4:
                    raise GatewayError(502, "upstream_error", "Upstream response too large")
                result = json.loads(raw)
                yield stream_event(body["model"], result["choices"][0]["message"]["content"], "stop")
                return
            data, size, last_progress = [], 0, time.monotonic()
            while True:
                line = resp.readline(MAX_BODY + 1)
                if time.monotonic() - last_progress > timeout:
                    raise GatewayError(504, "backend_timeout", "Upstream stream made no progress", 60)
                if not line:
                    raise GatewayError(502, "upstream_error", "Upstream stream interrupted")
                size += len(line)
                if len(line) > MAX_BODY or size > MAX_BODY * 4:
                    raise GatewayError(502, "upstream_error", "Upstream response too large")
                line = line.decode("utf-8").rstrip("\r\n")
                if not line:
                    if not data:
                        continue
                    value = "\n".join(data); data = []
                    if value == "[DONE]":
                        return
                    event = json.loads(value)
                    if not isinstance(event, dict) or "error" in event:
                        raise GatewayError(502, "upstream_error", "Upstream stream failed")
                    delta = (event.get("choices") or [{}])[0].get("delta", {})
                    if delta.get("content") or delta.get("reasoning_content"):
                        last_progress = time.monotonic()
                    yield event
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip(" "))
    except urllib.error.HTTPError as exc:
        raise GatewayError(exc.code, "model_not_found" if exc.code == 404 else
            "upstream_auth_failed" if exc.code in (401, 403) else "upstream_error",
            "Upstream returned HTTP " + str(exc.code), retry_seconds(exc.headers.get("Retry-After"))) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
        raise GatewayError(503, "backend_unavailable", "Local backend stream unavailable", 60) from None
    except (ValueError, TypeError, KeyError, IndexError):
        raise GatewayError(502, "upstream_error", "Invalid upstream stream") from None


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
    def __init__(self, home=HOME, config=None, request=loopback_request, stream_request=loopback_stream):
        self.home, self.config, self.request = home, config or config_load(home), request
        self.lock = threading.Lock()
        self.cooldown, self.usage = {}, {}
        self.not_found = {}
        self.auth_failures = {}
        self.stream_request = stream_request
        self.hermes_catalog = (0, [])
        self.catalog_lock = threading.Lock()
        self.limits = {name: threading.BoundedSemaphore(1 if name in ("claude", "codex") else 4 if name == "ollama" else 2)
                       for name in ("sjtu", "hermes", "ollama", "claude", "codex")}
        self.large_model_lock = threading.BoundedSemaphore(1)
        self.home.mkdir(parents=True, exist_ok=True)
        self.metadata_path = self.home / "gateway.log"
        try:
            self.usage = json.loads((self.home / "usage.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass

    def authenticate(self, ip, authorization, required=False):
        if not required and not authorization:
            return False
        now = time.monotonic()
        with self.lock:
            failures, until = self.auth_failures.get(ip, ([], 0))
            if until > now:
                raise GatewayError(429, "pairing_rate_limited", "Pairing authentication cooling down", retry_seconds(until - now))
            expected = read_remote_token(self.home)
            supplied = authorization[0][7:] if len(authorization) == 1 and authorization[0].startswith("Bearer ") else ""
            valid = bool(expected and supplied and hmac.compare_digest(expected.encode("ascii"), supplied.encode("utf-8")))
            if valid:
                return True
            if required or authorization:
                failures = [t for t in failures if t > now - 60] + [now]
                until = now + 600 if len(failures) > 10 else 0
                # Bound metadata memory; expired entries carry no authentication information.
                if len(self.auth_failures) >= 4096 and ip not in self.auth_failures:
                    self.auth_failures = {key: value for key, value in self.auth_failures.items()
                                          if value[1] > now or (value[0] and value[0][-1] > now - 60)}
                    if len(self.auth_failures) >= 4096:
                        raise GatewayError(429, "pairing_rate_limited", "Pairing authentication capacity reached", 600)
                self.auth_failures[ip] = (failures, until)
                if until:
                    raise GatewayError(429, "pairing_rate_limited", "Pairing authentication cooling down", 600)
                raise GatewayError(401, "pairing_required", "Valid pairing token required")
            return False

    def metadata(self, model, chars, started, status):
        record = {"at": int(time.time()), "model": model, "chars": chars,
                  "elapsed_ms": round((time.monotonic() - started) * 1000), "status": status}
        with self.lock:
            with self.metadata_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")

    def hermes_models(self):
        with self.catalog_lock:
            until, ids = self.hermes_catalog
            if until > time.monotonic():
                return ids
            try:
                result = self.request(local_url(self.config["hermes"]["url"]) + "/v1/models", timeout=5)
                available = {m["id"] for m in result.get("data", []) if isinstance(m, dict) and isinstance(m.get("id"), str)}
                ids = [m for m in self.config["hermes"].get("models", []) if m in available]
                self.hermes_catalog = (time.monotonic() + 600, ids)
            except GatewayError:
                # Do not advertise a stale or unreachable model. Short negative cache.
                ids = []; self.hermes_catalog = (time.monotonic() + 15, ids)
            return ids

    def models(self):
        return {"object": "list", "data": [{"id": name + "/" + model, "object": "model",
                    "owned_by": name} for name in self.limits if self.config.get(name, {}).get("enabled")
                    for model in (self.hermes_models() if name == "hermes" else self.config[name].get("models", []))
                    if self.not_found.get(name + "/" + model, 0) <= time.monotonic()]}

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise GatewayError(400, "invalid_request", "JSON object required")
        model = payload.get("model", "")
        if not isinstance(model, str) or model not in {name + "/" + m for name in self.limits if self.config[name].get("enabled") for m in self.config[name].get("models", [])}:
            raise GatewayError(400, "unknown_model", "Choose a model from /v1/models")
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages or len(messages) > 100:
            raise GatewayError(400, "invalid_request", "messages must be a nonempty list")
        for msg in messages:
            if not isinstance(msg, dict) or msg.get("role") not in ("system", "user", "assistant") or not isinstance(msg.get("content"), str):
                raise GatewayError(400, "invalid_request", "Only text messages are supported")
        if not isinstance(payload.get("stream", False), bool):
            raise GatewayError(400, "invalid_request", "stream must be a boolean")
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

    def chat(self, payload, on_chunk=None):
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
            streaming = payload.get("stream", False) and on_chunk is not None
            forwarded.update(model=suffix, stream=streaming)
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
            timeout = 45 if backend == "sjtu" else 120
            if streaming:
                sent = False
                for attempt in range(3):
                    try:
                        for event in self.stream_request(base + "/v1/chat/completions", forwarded, headers, timeout=timeout):
                            event["model"] = model
                            on_chunk(event); sent = True
                        return None
                    except GatewayError as exc:
                        if not sent and exc.status == 400 and backend == "hermes" and "response_format" in forwarded:
                            forwarded.pop("response_format"); continue
                        if not sent and exc.status in (400, 422, 501):
                            forwarded["stream"] = False
                            result = self.request(base + "/v1/chat/completions", forwarded, headers, timeout=timeout)
                            return result
                        raise
            try:
                result = self.request(base + "/v1/chat/completions", forwarded, headers, timeout=timeout)
            except GatewayError as exc:
                if backend != "hermes" or exc.status != 400 or "response_format" not in forwarded:
                    raise
                forwarded.pop("response_format")
                result = self.request(base + "/v1/chat/completions", forwarded, headers, timeout=timeout)
            if not isinstance(result, dict) or not isinstance(result.get("choices"), list) or not result["choices"]:
                raise GatewayError(502, "upstream_error", "Missing upstream choices")
            result["model"] = model
            return result
        except ConnectionError:
            status = 499
            raise
        except GatewayError as exc:
            status = exc.status
            if exc.status in (401, 403, 404, 429, 502, 503, 504):
                duration = 1800 if exc.status == 404 else 600 if backend == "hermes" and exc.status in (401, 403) else exc.retry_after or 60
                with self.lock:
                    self.cooldown[model] = time.monotonic() + duration
                    if exc.status == 404:
                        self.not_found[model] = self.cooldown[model]
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

    def __getattr__(self, name):
        if name.startswith("do_"):
            return self.unsupported
        raise AttributeError(name)

    def guard(self):
        hosts = self.headers.get_all("Host", [])
        remote = getattr(self.server, "remote", False)
        paired = self.server.gateway.authenticate(self.client_address[0], self.headers.get_all("Authorization", []), required=remote)
        allowed_hosts = getattr(self.server, "allowed_hosts", (
            "127.0.0.1:" + str(self.server.server_port), "localhost:" + str(self.server.server_port)))
        if len(hosts) != 1 or (hosts[0].lower() if remote else hosts[0]) not in allowed_hosts:
            raise GatewayError(403, "forbidden_host", "Exact listener Host required")
        origins = self.headers.get_all("Origin", [])
        origin = origins[0] if origins else None
        if paired:
            if len(origins) > 1:
                raise GatewayError(403, "forbidden_origin", "One Origin required")
            self.allowed_origin = origin
            return
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
        if getattr(self, "stream_started", False):
            self.stream_send({"error": {"message": "Gateway stream failed", "code": exc.code, "type": "gateway_error"}})
            self.close_connection = True
            return
        self.respond(exc.status, {"error": {"message": str(exc), "code": exc.code, "type": "gateway_error"}}, exc.retry_after)

    def do_OPTIONS(self):
        try:
            self.guard()
            if self.path not in ("/health", "/v1/models", "/v1/chat/completions"):
                raise GatewayError(404, "not_found", "Unknown path")
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
                body = {"ok": True, "name": "DualLens", "version": manifest_version()}
            elif self.path == "/v1/models":
                body = self.server.gateway.models()
            else:
                raise GatewayError(404, "not_found", "Unknown path")
            self.respond(200, body)
        except GatewayError as exc:
            self.error(exc)

    def stream_send(self, event):
        if not getattr(self, "stream_started", False):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            if getattr(self, "allowed_origin", None):
                self.send_header("Access-Control-Allow-Origin", self.allowed_origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.stream_started = True
            self.close_connection = True
        data = event if isinstance(event, str) else json.dumps(event, ensure_ascii=False)
        self.wfile.write(("data: " + data + "\n\n").encode("utf-8"))
        self.wfile.flush()

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
            if isinstance(payload, dict) and payload.get("stream") is True:
                result = self.server.gateway.chat(payload, on_chunk=self.stream_send)
                if result is not None:
                    self.stream_send(stream_event(payload["model"], result["choices"][0]["message"]["content"], "stop"))
                self.stream_send("[DONE]")
            else:
                self.respond(200, self.server.gateway.chat(payload))
        except ConnectionError:
            self.close_connection = True
        except GatewayError as exc:
            self.error(exc)
        except (ValueError, TypeError, socket.timeout):
            self.error(GatewayError(400, "invalid_request", "Invalid JSON request"))
        except Exception:
            self.error(GatewayError(500, "internal_error", "Gateway internal error"))

    def unsupported(self):
        try:
            self.guard()
            raise GatewayError(405, "method_not_allowed", "Method not allowed")
        except GatewayError as exc:
            self.error(exc)

    do_HEAD = do_PUT = do_PATCH = do_DELETE = do_TRACE = do_CONNECT = unsupported

def make_server(port=18790, gateway=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.gateway = gateway or Gateway()
    return server

def make_remote_server(gateway, discover=tailscale_identity):
    conf = gateway.config.get("remote", {})
    if conf.get("enabled") is not True:
        raise ValueError("Remote listener is disabled")
    address, name = discover()
    if not is_tailscale_ip(address):
        raise ValueError("Remote listener requires a local Tailscale IPv4 address")
    port = conf.get("port", 18791)
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("Invalid remote port")
    if not read_remote_token(gateway.home):
        raise ValueError("Run pair before enabling the remote listener")
    server = ThreadingHTTPServer((address, port), Handler)
    server.daemon_threads = True
    server.gateway, server.remote = gateway, True
    server.allowed_hosts = {address + ":" + str(port)}
    if name and re.fullmatch(r"[a-z0-9.-]+\.ts\.net", name):
        server.allowed_hosts.add(name + ":" + str(port))
    return server

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["serve", "pair", "setup", "status"])
    parser.add_argument("--port", type=int)
    parser.add_argument("--rotate", action="store_true")
    opts = parser.parse_args()
    if opts.command != "serve":
        if opts.command == "pair":
            pair(rotate=opts.rotate)
        elif opts.command == "setup":
            setup()
        else:
            status()
        return
    gateway = Gateway()
    server = make_server(opts.port if opts.port is not None else int(gateway.config["port"]), gateway)
    remote = None
    try:
        if gateway.config.get("remote", {}).get("enabled"):
            remote = make_remote_server(gateway)
            threading.Thread(target=remote.serve_forever, daemon=True).start()
    except (ValueError, OSError):
        server.server_close()
        raise SystemExit("Remote listener unavailable; no gateway listeners started") from None
    print("DualLens listening on 127.0.0.1:" + str(server.server_port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if remote:
            remote.shutdown()
            remote.server_close()
        server.server_close()

if __name__ == "__main__":
    main()
