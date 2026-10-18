"""OpenAI-compatible gateway; loopback by default, optional authenticated Tailscale listener."""
from __future__ import annotations
import argparse
import base64
import collections
import email.utils
import hashlib
import hmac
import ipaddress
import secrets
import select
import shutil
import ssl
import ctypes
import http.client
import json
import os
from pathlib import Path
import re
import socket
import statistics
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
    "sjtu": {"enabled": False, "url": "http://127.0.0.1:18765", "models": ["deepseek-chat"],
             "max_per_minute": 4},
    "hermes": {"enabled": False, "url": "http://127.0.0.1:8645", "models": [
        "upstage/solar-mini4:free"]},
    # qwen3:4b is the 2507 *thinking* build: it must be allowed to think. "none" makes it copy the source text
    # (or abort with "token repeat limit reached"), so the default effort is "low".
    "ollama": {"enabled": True, "url": "http://127.0.0.1:11434", "models": ["qwen3:4b", "gpt-oss:20b"],
               "reasoning_effort": "low"},
    "claude": {"enabled": False, "models": ["haiku", "sonnet"], "daily_limit": 0},
    "codex": {"enabled": False, "models": ["default"], "daily_limit": 0},
    # Virtual model "auto": picks among sjtu / ollama / free hermes by live health and speed.
    # claude/* and codex/* are subscription-limited and are never selected automatically.
    "auto": {"prefer": ["sjtu/deepseek-chat", "hermes/*", "ollama/qwen3:4b"], "queue_s": 20, "budget_s": 85,
             "switch_factor": 2.5, "switch_extra_ms": 6000},
}

class GatewayError(Exception):
    """`local` marks conditions the gateway itself imposes (queue full, rate window, cap):
    they say nothing about backend health and must never start a cooldown."""
    def __init__(self, status, code, message, retry_after=None, local=False):
        super().__init__(message)
        self.status, self.code, self.retry_after, self.local = status, code, retry_after, local

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
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            seconds = email.utils.parsedate_to_datetime(value).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            return default
    try:
        return max(1, min(600, int(seconds + 0.999)))
    except (ValueError, OverflowError):
        return default

# --- timing policy ---------------------------------------------------------------------------------
# A request may wait this long for a backend slot (or for the SJTU rate window) before the gateway
# answers "busy". Busy is not a failure: the extension re-queues it without cooling the model.
QUEUE_WAIT_S = 20.0
# Phase 1: time to the first content delta. SJTU's relay may itself hold a request up to 50 s for a rate
# slot, so the gateway must not give up earlier. Phase 2: once output flows, silence for IDLE_S is a stall.
FIRST_BYTE_S = {"sjtu": 50.0, "ollama": 60.0, "hermes": 40.0, "claude": 180.0, "codex": 180.0}
IDLE_S = 12.0
HEALTH_WINDOW_S = 300.0
COOLDOWN_BASE_S, COOLDOWN_MAX_S = 15.0, 300.0
# Latency priors (ms) used for `auto` until a backend has live statistics.
# Initial estimates, replaced by recent successful observations; not performance guarantees.
PRIOR_MS = {"sjtu": 9000.0, "ollama": 3500.0, "hermes": 6000.0}
# claude/* and codex/* draw on subscriptions: only an explicit user choice may reach them.
AUTO_BACKENDS = ("sjtu", "ollama", "hermes")
SJTU_LEDGER_RETRY_S = 6.0
PROBE_HOSTS = {"claude": "api.anthropic.com", "codex": "chatgpt.com"}
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")


def http_failure(status, headers=None):
    """Map an upstream HTTP status to a gateway error. Upstream bodies are never reflected."""
    retry = retry_seconds(headers.get("Retry-After"), None) if headers is not None else None
    code = ("upstream_auth_failed" if status in (401, 403) else "rate_limited" if status == 429 else
            "model_not_found" if status == 404 else "upstream_error")
    # A 5xx other than 503/504 is still a retryable server fault for the extension.
    mapped = 502 if status >= 500 and status not in (503, 504) else status
    return GatewayError(mapped, code, "Upstream returned HTTP " + str(status), retry)


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
        raise http_failure(exc.code, exc.headers) from None
    except (TimeoutError, socket.timeout):
        raise GatewayError(504, "backend_timeout", "Local backend timed out") from None
    except (urllib.error.URLError, ConnectionError, OSError):
        raise GatewayError(503, "backend_unavailable", "Local backend unavailable") from None
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


def stream_delta(event):
    if not isinstance(event, dict) or "error" in event:
        raise GatewayError(502, "upstream_error", "Upstream stream failed")
    choices = event.get("choices", [])
    if not isinstance(choices, list) or (choices and not isinstance(choices[0], dict)):
        raise GatewayError(502, "upstream_error", "Invalid upstream stream choices")
    delta = choices[0].get("delta") or {} if choices else {}
    if not isinstance(delta, dict) or any(delta.get(k) is not None and not isinstance(delta[k], str)
                                         for k in ("content", "reasoning_content")):
        raise GatewayError(502, "upstream_error", "Invalid upstream stream content")
    return delta


def loopback_stream(url, body, headers=None, timeout=IDLE_S, first_byte_timeout=None, deadline=None):
    """Read bounded SSE events from a loopback backend.

    Two phases: `first_byte_timeout` bounds the wait for the first content delta (an upstream relay may
    legitimately queue a request); afterwards `timeout` is a no-progress limit, and keep-alive lines or
    empty events do not count as progress."""
    local_url(url)
    parts = urllib.parse.urlsplit(url)
    first_byte_timeout = first_byte_timeout or timeout
    started = time.monotonic()
    conn = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=first_byte_timeout)
    resp = None
    try:
        conn.request("POST", parts.path + ("?" + parts.query if parts.query else ""),
                     json.dumps(body).encode("utf-8"),
                     {"Content-Type": "application/json", "Accept": "text/event-stream", **(headers or {})})
        sock = conn.sock  # conn.close() detaches conn.sock; keep the object to change its timeout
        resp = conn.getresponse()
        if resp.status >= 400:
            raise http_failure(resp.status, resp.headers)
        if "text/event-stream" not in (resp.getheader("Content-Type") or ""):
            raw = resp.read(MAX_BODY * 4 + 1)
            if len(raw) > MAX_BODY * 4:
                raise GatewayError(502, "upstream_error", "Upstream response too large")
            result = json.loads(raw)
            yield stream_event(body["model"], result["choices"][0]["message"]["content"], "stop")
            return
        data, size, got, last = [], 0, False, started
        while True:
            now = time.monotonic()
            left = (last + timeout if got else started + first_byte_timeout) - now
            if deadline:
                left = min(left, deadline - now)
            if left <= 0:
                raise GatewayError(504, "backend_timeout", "Upstream stream made no progress")
            sock.settimeout(left)
            line = resp.readline(MAX_BODY + 1)
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
                delta = stream_delta(event)
                if delta.get("content") or delta.get("reasoning_content"):
                    got, last = True, time.monotonic()
                yield event
            elif line.startswith("data:"):
                data.append(line[5:].lstrip(" "))
    except (TimeoutError, socket.timeout):
        raise GatewayError(504, "backend_timeout", "Upstream stream made no progress") from None
    except (OSError, http.client.HTTPException):
        raise GatewayError(503, "backend_unavailable", "Local backend stream unavailable") from None
    except (ValueError, TypeError, KeyError, IndexError):
        raise GatewayError(502, "upstream_error", "Invalid upstream stream") from None
    finally:
        if resp is not None:
            resp.close()
        conn.close()


# --- outbound routing for the subscription CLIs -----------------------------------------------------

def registry_proxy():
    """The Windows system proxy as `http://host:port`, or None. Read-only; nothing is changed."""
    if os.name != "nt":
        return None
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
            enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
            value = winreg.QueryValueEx(key, "ProxyServer")[0] if enabled else ""
        if value:
            values = dict(piece.split("=", 1) for piece in value.split(";") if "=" in piece)
            value = values.get("https", values.get("http", value))
            return value if "://" in value else "http://" + value
    except (OSError, ValueError):
        pass
    return None


def tls_probe(host, proxy, timeout=4.0):
    """Can a TLS handshake with `host:443` complete, directly or through an HTTP CONNECT proxy?
    Only the handshake happens: no request, no credentials, no body."""
    sock = None
    try:
        if proxy:
            u = urllib.parse.urlsplit(proxy if "://" in proxy else "http://" + proxy)
            sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
            sock.sendall(("CONNECT %s:443 HTTP/1.1\r\nHost: %s:443\r\n\r\n" % (host, host)).encode("ascii"))
            reply = b""
            while b"\r\n\r\n" not in reply and len(reply) < 4096:
                chunk = sock.recv(512)
                if not chunk:
                    return False
                reply += chunk
            if not re.match(rb"HTTP/1\.[01] 200", reply):
                return False
        else:
            sock = socket.create_connection((host, 443), timeout=timeout)
        with ssl.create_default_context().wrap_socket(sock, server_hostname=host):
            return True
    except (OSError, ssl.SSLError, ValueError):
        return False
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def proxy_sources():
    """Candidate routes in preference order: an explicit environment proxy, direct, the system proxy."""
    seen, out = set(), []
    env = next((os.environ[k] for k in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy") if os.environ.get(k)), None)
    for kind, proxy in (("env", env), ("direct", None), ("system", registry_proxy())):
        if (kind != "direct" and not proxy) or proxy in seen:
            continue
        seen.add(proxy)
        out.append((kind, proxy))
    return out


class ProxyChooser:
    """Choose, per destination host, the first route whose TLS handshake works; remember it 5 minutes.
    A broken proxy is never handed to a child process."""
    TTL, FAIL_TTL = 300.0, 30.0

    def __init__(self, probe=tls_probe, sources=proxy_sources, clock=time.monotonic):
        self.probe, self.sources, self.clock = probe, sources, clock
        self.cache, self.lock = {}, threading.Lock()

    def route(self, host):
        with self.lock:  # probes are serialized so a burst of first requests probes once
            now = self.clock()
            hit = self.cache.get(host)
            if hit and hit[0] > now:
                return hit[1], hit[2]
            kind, proxy, ok = "direct", None, False
            for k, p in self.sources():
                if self.probe(host, p):
                    kind, proxy, ok = k, p, True
                    break
            self.cache[host] = (now + (self.TTL if ok else self.FAIL_TTL), kind, proxy, ok)
            return kind, proxy

    def snapshot(self):
        now = self.clock()
        with self.lock:
            return {host: {"route": kind, "working": ok, "expires_in_s": max(0, round(until - now))}
                    for host, (until, kind, _, ok) in self.cache.items()}


DEFAULT_CHOOSER = ProxyChooser()


def proxy_environment(host=None, chooser=None):
    """Environment for a child process: API-billing variables removed. With `host`, the proxy
    variables are replaced by the probed route; without it the legacy registry lookup is used."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("ANTHROPIC_", "CLAUDE_")) and k.upper() not in ("OPENAI_API_KEY", "OPENAI_BASE_URL")}
    if host is not None:
        for key in [k for k in env if k.upper() in PROXY_VARS]:
            del env[key]
        _, proxy = (chooser or DEFAULT_CHOOSER).route(host)
        if proxy:
            env["HTTPS_PROXY"] = env["HTTP_PROXY"] = proxy
        return env
    if os.name == "nt" and not env.get("HTTPS_PROXY"):
        value = registry_proxy()
        if value:
            env["HTTPS_PROXY"] = value
            env.setdefault("HTTP_PROXY", value)
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


class Slots:
    """Counting semaphore whose waiters queue in arrival order for a bounded time.

    The old gateway refused a request the instant every slot was taken, which the extension read as an
    outage and cooled the model. Waiting briefly is almost always cheaper than failing."""
    def __init__(self, capacity):
        self.capacity, self.used = capacity, 0
        self.queue = collections.deque()
        self.cond = threading.Condition()

    @property
    def waiting(self):
        return len(self.queue)

    def acquire(self, blocking=True, timeout=None, alive=None):
        wait = 0.0 if not blocking else float("inf") if timeout is None else max(0.0, timeout)
        deadline = time.monotonic() + wait
        ticket = object()
        with self.cond:
            self.queue.append(ticket)
            try:
                while True:
                    if self.used < self.capacity and self.queue[0] is ticket:
                        self.used += 1
                        return True
                    left = deadline - time.monotonic()
                    if left <= 0:
                        return False
                    self.cond.wait(min(left, 0.25))
                    if alive is not None and not alive():
                        raise ConnectionError("client left the queue")
            finally:
                self.queue.remove(ticket)
                self.cond.notify_all()

    def release(self):
        with self.cond:
            if self.used <= 0:
                raise ValueError("slot released more often than acquired")
            self.used -= 1
            self.cond.notify_all()


class Ctx:
    """Per-request bookkeeping shared by the attempts that serve it."""
    def __init__(self, queue_s, budget_s=None, alive=None):
        self.started = time.monotonic()
        self.queue_deadline = self.started + queue_s
        self.deadline = self.started + budget_s if budget_s else None
        self.alive = alive or (lambda: True)
        self.sent = False          # a byte of the answer already reached the client
        self.served = None         # concrete model that produced (or is producing) the answer
        self.first_byte_ms = None  # request start -> first forwarded content, ms
        self.queued_ms = 0         # time spent waiting for slots / rate windows


class Gateway:
    def __init__(self, home=HOME, config=None, request=loopback_request, stream_request=loopback_stream,
                 proxy_probe=tls_probe):
        self.home, self.config, self.request = home, config or config_load(home), request
        self.lock = threading.RLock()
        self.cooldown, self.usage = {}, {}
        self.not_found = {}
        self.auth_failures = {}
        self.stream_request = stream_request
        self.hermes_catalog = (0, [])
        self.catalog_lock = threading.Lock()
        self.catalog_refreshing = False
        self.limits = {name: Slots(1 if name in ("claude", "codex") else 4 if name == "ollama" else 2)
                       for name in ("sjtu", "hermes", "ollama", "claude", "codex")}
        self.large_model_lock = Slots(1)
        self.events, self.streak = {}, {}
        self.sjtu_calls, self.sjtu_lock = [], threading.Lock()
        self._ledger = None
        self.proxy = ProxyChooser(probe=proxy_probe)
        self.booted = time.monotonic()
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

    def metadata(self, model, chars, started, status, ctx=None):
        record = {"at": int(time.time()), "model": model, "chars": chars,
                  "elapsed_ms": round((time.monotonic() - started) * 1000), "status": status}
        if ctx is not None:
            if ctx.served:
                record["served"] = ctx.served
            if ctx.first_byte_ms is not None:
                record["first_byte_ms"] = ctx.first_byte_ms
            if ctx.queued_ms:
                record["queued_ms"] = ctx.queued_ms
        with self.lock:
            try:
                if self.metadata_path.exists() and self.metadata_path.stat().st_size > 4 * 1024 * 1024:
                    self.metadata_path.replace(self.metadata_path.with_name("gateway.log.1"))
                with self.metadata_path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record) + "\n")
            except OSError:
                pass  # a full disk or a locked log must never fail a translation

    # --- catalogs -----------------------------------------------------------------------------------
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

    def hermes_models_cached(self):
        """Never blocks the request path after the first lookup: a stale list is refreshed in the background."""
        until, ids = self.hermes_catalog
        if until == 0:
            return self.hermes_models()
        if until <= time.monotonic() and not self.catalog_refreshing:
            self.catalog_refreshing = True
            def refresh():
                try:
                    self.hermes_models()
                finally:
                    self.catalog_refreshing = False
            threading.Thread(target=refresh, daemon=True).start()
        return ids

    def auto_conf(self):
        conf = dict(DEFAULTS["auto"])
        conf.update(self.config.get("auto") or {})
        return conf

    def auto_candidates(self, fetch=True):
        """Concrete models `auto` may use, in preference order. Never claude/* or codex/*."""
        conf, out = self.auto_conf(), []
        prefer = conf.get("prefer")
        enabled = (self.config.get("hermes") or {}).get("enabled")
        catalog = (self.hermes_models_cached() if fetch else self.hermes_catalog[1]) if enabled else []
        # Configured non-free models may be selected explicitly, never via auto.
        hermes = [("hermes/" + n) for n in catalog if n.endswith(":free")]
        for model in prefer if isinstance(prefer, list) else []:
            backend, _, name = str(model).partition("/")
            section = self.config.get(backend) or {}
            if backend not in AUTO_BACKENDS or not section.get("enabled"):
                continue
            # "hermes/*" stands for every approved free model the proxy currently lists.
            for candidate in (hermes if name == "*" else [model] if model in hermes else []) if backend == "hermes" else [model] if name in section.get("models", []) else []:
                if candidate not in out:
                    out.append(candidate)
        out += [m for m in hermes if m not in out]
        now = time.monotonic()
        return [m for m in out if self.not_found.get(m, 0) <= now]

    def models(self):
        data = [{"id": "auto", "object": "model", "owned_by": "duallens"}] if self.auto_candidates() else []
        return {"object": "list", "data": data + [{"id": name + "/" + model, "object": "model",
                    "owned_by": name} for name in self.limits if self.config.get(name, {}).get("enabled")
                    for model in (self.hermes_models() if name == "hermes" else self.config[name].get("models", []))
                    if self.not_found.get(name + "/" + model, 0) <= time.monotonic()]}

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise GatewayError(400, "invalid_request", "JSON object required")
        model = payload.get("model", "")
        allowed = {name + "/" + m for name in self.limits if self.config[name].get("enabled") for m in self.config[name].get("models", [])}
        # A previously configured auto remains valid even when every concrete model
        # is temporarily hidden/unavailable; report availability, not bad configuration.
        if not isinstance(model, str) or not (model in allowed or model == "auto"):
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

    # --- health, cooldown, SJTU rate window ----------------------------------------------------------
    def record(self, model, ok, elapsed_ms, first_byte_ms=None):
        with self.lock:
            self.events.setdefault(model, collections.deque(maxlen=200)).append(
                (time.monotonic(), ok, elapsed_ms, first_byte_ms))
            if ok:
                self.streak.pop(model, None)

    def stats(self, model):
        cutoff = time.monotonic() - HEALTH_WINDOW_S
        with self.lock:
            items = [e for e in self.events.get(model, ()) if e[0] >= cutoff]
        good = [e for e in items if e[1]]
        firsts = [e[3] for e in good if e[3] is not None]
        return {"requests_5m": len(items),
                "success_rate_5m": round(len(good) / len(items), 3) if items else None,
                "p50_ms": round(statistics.median(e[2] for e in good)) if good else None,
                "p50_first_byte_ms": round(statistics.median(firsts)) if firsts else None}

    def cooling_for(self, model):
        with self.lock:
            return max(0.0, self.cooldown.get(model, 0) - time.monotonic())

    def cool(self, model, exc):
        """Start a cooldown after a real backend fault: short, doubling, reset by the next success.
        A Retry-After sent by the upstream is obeyed as given."""
        backend = model.split("/", 1)[0]
        with self.lock:
            n = self.streak[model] = self.streak.get(model, 0) + 1
            if exc.status == 404:
                duration = 1800
            elif exc.status in (401, 403):
                duration = 600 if backend == "hermes" else 120
            elif exc.status == 429 and exc.retry_after:
                duration = exc.retry_after
            else:
                duration = min(COOLDOWN_MAX_S, COOLDOWN_BASE_S * 2 ** (n - 1))
            self.cooldown[model] = max(self.cooldown.get(model, 0), time.monotonic() + duration)
            if exc.status == 404:
                self.not_found[model] = self.cooldown[model]

    def ledger(self, fresh=False):
        cached = self._ledger
        if not fresh and cached and cached[0] > time.monotonic():
            return cached[1]
        data = self.request(local_url(self.config["sjtu"]["url"]) + "/ledger", timeout=5)
        data = data if isinstance(data, dict) else {}
        self._ledger = (time.monotonic() + 1.5, data)
        return data

    def sjtu_limit(self):
        try:
            return min(4, max(1, int(self.config["sjtu"].get("max_per_minute", 4))))
        except (TypeError, ValueError):
            return 4

    def sjtu_local_wait(self):
        limit, now = self.sjtu_limit(), time.monotonic()
        with self.sjtu_lock:
            self.sjtu_calls = [t for t in self.sjtu_calls if t > now - 60.0]
            return self.sjtu_calls[len(self.sjtu_calls) - limit] + 60.0 - now if len(self.sjtu_calls) >= limit else 0.0

    def sjtu_wait_info(self, fetch=True, fresh=False):
        """(seconds until an SJTU call may go out, whether that figure is exact). Own token bucket first,
        then the relay ledger, which also counts Hermes: a full ledger gives no date, only an estimate.
        Raises GatewayError when the relay itself is down."""
        wait, exact = self.sjtu_local_wait(), True
        if fetch or self._ledger:
            ledger = self.ledger(fresh=fresh) if fetch else self._ledger[1]
            paused = float(ledger.get("paused_for") or 0)
            if not fetch:
                paused = max(0, paused - max(0, time.monotonic() - (self._ledger[0] - 1.5)))
            if paused > 0:
                wait = max(wait, paused)
            elif int(ledger.get("calls") or 0) >= self.sjtu_limit() and wait < SJTU_LEDGER_RETRY_S:
                wait, exact = SJTU_LEDGER_RETRY_S, False
        return wait, exact

    def sjtu_wait(self, fetch=True):
        return self.sjtu_wait_info(fetch)[0]

    def sjtu_admit(self, ctx):
        """Take one SJTU slot, waiting inside the queue budget; defer (no cooldown) when it would be longer."""
        try:
            token = json.loads(Path(self.config["sjtu"].get("token_file") or Path.home() / ".ddl-hub/config.json"
                                    ).read_text(encoding="utf-8-sig"))["proxy_token"]
        except (OSError, KeyError, ValueError, TypeError):
            raise GatewayError(503, "backend_unavailable", "SJTU relay not configured") from None
        began = time.monotonic()
        while True:
            wait, exact = self.sjtu_wait_info(fresh=True)
            if wait <= 0:
                with self.sjtu_lock:
                    now = time.monotonic()
                    self.sjtu_calls = [t for t in self.sjtu_calls if t > now - 60.0]
                    if len(self.sjtu_calls) < self.sjtu_limit():
                        self.sjtu_calls.append(now)
                        ctx.queued_ms += round((now - began) * 1000)
                        return {"Authorization": "Bearer " + token, "X-DDLHub-Lane": "background"}
                continue
            left = ctx.queue_deadline - time.monotonic()
            if (exact and wait > left) or left <= 0:
                raise GatewayError(429, "rate_limited", "SJTU rate window is full", retry_seconds(wait + 0.5, 15), local=True)
            time.sleep(min(wait, 0.5, left))
            if not ctx.alive():
                raise ConnectionError("client left the queue")

    # --- `auto` scheduling ------------------------------------------------------------------------------
    def expected_ms(self, model, fetch=True):
        """Rough time to a finished answer: typical service time plus the wait for a slot or the SJTU window."""
        backend = model.split("/", 1)[0]
        base = self.stats(model)["p50_ms"] or PRIOR_MS[backend]
        slots = self.limits[backend]
        ahead = max(0, slots.used + slots.waiting + 1 - slots.capacity)
        wait = ahead * base / slots.capacity
        if backend == "sjtu":
            wait = max(wait, self.sjtu_wait(fetch) * 1000.0)
        return base + wait

    def auto_order(self, tried=(), fetch=True):
        """Models to try, best first. Quality preference holds until the preferred backend is clearly slower."""
        costs = {}
        for model in self.auto_candidates(fetch=fetch):
            if model in tried or self.cooling_for(model) > 0:
                continue
            try:
                # An occupied rate window is a deferral, not a slow quality preference.
                # Keep SJTU as a fallback only if every other backend is unavailable.
                costs[model] = self.expected_ms(model, fetch)
            except GatewayError as exc:  # the relay is down: that is a real fault of this backend
                if fetch:
                    self.cool(model, exc)
        if not costs:
            return []
        ready = {m: cost for m, cost in costs.items()
                 if not (m.startswith("sjtu/") and self.sjtu_wait(fetch=False) > 0)}
        if ready:
            costs = ready
        conf = self.auto_conf()
        limit = min(costs.values()) * float(conf["switch_factor"]) + float(conf["switch_extra_ms"])
        first = next((m for m in costs if costs[m] <= limit), min(costs, key=costs.get))  # dict keeps preference order
        return [first] + sorted((m for m in costs if m != first), key=costs.get)

    def chat_auto(self, payload, messages, on_chunk, ctx):
        tried, busy, last = set(), None, None
        while True:
            order = self.auto_order(tried)
            if not order or (ctx.deadline and time.monotonic() > ctx.deadline - 5):
                break
            model = order[0]
            try:
                return self.run_model(model, payload, messages, on_chunk, ctx)
            except GatewayError as exc:
                # Once bytes reached the client the answer cannot be moved to another backend.
                if ctx.sent or exc.status in (400, 413, 415, 422):
                    raise
                tried.add(model)
                if exc.local:
                    busy = busy or exc
                else:
                    last = exc
        # A genuine fault on one candidate must not turn another healthy backend's
        # queue timeout into an outage; clients can retry that capacity deferral.
        if busy is not None:
            raise GatewayError(429, "gateway_busy", "All backends are busy; retry shortly",
                               min(busy.retry_after or 2, 10), local=True)
        waits = [self.cooling_for(m) for m in self.auto_candidates()]
        waits = [w for w in waits if w > 0]
        raise GatewayError(503, "no_backend_available", "No backend is available right now",
                           retry_seconds(min(waits) if waits else 5, 5), local=True)

    # --- one request on one concrete model -------------------------------------------------------------
    def first_byte_s(self, backend, suffix, ctx):
        base = float((self.config.get("timeouts") or {}).get(backend) or FIRST_BYTE_S[backend])
        if backend == "sjtu":
            base = min(base, 50.0)
        size = re.search(r"(\d+(?:\.\d+)?)b\b", suffix, re.I)
        if backend == "ollama" and size and float(size.group(1)) >= 20:
            base = max(base, 120.0)  # a 20B model may have to load first
        if ctx.deadline:
            base = min(base, max(0.001, ctx.deadline - time.monotonic()))
        return base

    def run_model(self, model, payload, messages, on_chunk, ctx):
        backend, suffix = model.split("/", 1)
        remaining = self.cooling_for(model)
        if remaining > 0:
            raise GatewayError(503, "model_cooling", "Model is cooling down", retry_seconds(remaining + 0.5, 15), local=True)
        slots, waited = self.limits[backend], time.monotonic()
        if not slots.acquire(timeout=max(0.0, ctx.queue_deadline - waited), alive=ctx.alive):
            ctx.queued_ms += round((time.monotonic() - waited) * 1000)
            raise GatewayError(429, "gateway_busy", "Backend queue is full; retry shortly", 2, local=True)
        ctx.queued_ms += round((time.monotonic() - waited) * 1000)
        release = [slots.release]
        began = time.monotonic()
        marks = {"first": None}
        def forward(event):
            if ctx.deadline and time.monotonic() >= ctx.deadline:
                raise GatewayError(504, "backend_timeout", "Request time budget exhausted")
            if marks["first"] is None:
                marks["first"] = time.monotonic()
                ctx.first_byte_ms = ctx.first_byte_ms or round((marks["first"] - ctx.started) * 1000)
            ctx.sent = True
            on_chunk(event)
        try:
            ctx.served = model
            result = self.dispatch(model, backend, suffix, payload, messages, forward if on_chunk else None, ctx, release)
            if ctx.deadline and time.monotonic() >= ctx.deadline:
                raise GatewayError(504, "backend_timeout", "Request time budget exhausted")
            first = None if marks["first"] is None else round((marks["first"] - began) * 1000)
            self.record(model, True, round((time.monotonic() - began) * 1000), first)
            return result
        except GatewayError as exc:
            if not exc.local and (exc.status in (401, 403, 404, 429) or exc.status >= 500):
                self.cool(model, exc)  # a rejected request (400/413/422) says nothing about backend health
                self.record(model, False, round((time.monotonic() - began) * 1000))
            raise
        finally:
            for free in release:
                free()

    def count_usage(self, backend):
        cap = int(self.config[backend].get("daily_limit", 0))
        day = time.strftime("%Y-%m-%d")
        key = day + "/" + backend
        with self.lock:
            if cap > 0 and self.usage.get(key, 0) >= cap:
                raise GatewayError(429, "daily_limit", "Configured daily limit reached", 600, local=True)
            self.usage[key] = self.usage.get(key, 0) + 1
            self.usage = {k: v for k, v in self.usage.items() if k.startswith(day)}
            try:
                temp = self.home / "usage.tmp"
                temp.write_text(json.dumps(self.usage), encoding="utf-8")
                temp.replace(self.home / "usage.json")
            except OSError:
                pass

    def dispatch(self, model, backend, suffix, payload, messages, on_chunk, ctx, release):
        if backend in ("claude", "codex"):
            self.count_usage(backend)
            return completion(model, self.cli(backend, suffix, messages))
        base = local_url(self.config[backend]["url"])
        forwarded = {k: payload[k] for k in ("messages", "temperature", "max_tokens", "response_format") if k in payload}
        streaming = bool(payload.get("stream", False) and on_chunk is not None)
        forwarded.update(model=suffix, stream=streaming)
        forwarded.setdefault("max_tokens", 2048)
        headers = {}
        if backend == "ollama":
            size = re.search(r"(\d+(?:\.\d+)?)b\b", suffix, re.I)
            if size and float(size.group(1)) >= 20:
                if not memory_ready():
                    raise GatewayError(503, "backend_unavailable", "Insufficient commit memory for large local model", 60, local=True)
                began = time.monotonic()
                if not self.large_model_lock.acquire(timeout=max(0.0, ctx.queue_deadline - began), alive=ctx.alive):
                    raise GatewayError(429, "gateway_busy", "Large local model is busy", 2, local=True)
                release.append(self.large_model_lock.release)
            # Thinking tokens count against max_tokens in Ollama: leave room for them or the JSON is cut off.
            forwarded["max_tokens"] = min(8192, forwarded["max_tokens"] + 3072)
            forwarded.update(reasoning_effort=self.config["ollama"].get("reasoning_effort") or "low", keep_alive="10m", temperature=0)
        if backend == "hermes":
            forwarded["reasoning_effort"] = "none"
        first_byte = self.first_byte_s(backend, suffix, ctx)
        def remaining_timeout():
            return min(first_byte + 30, max(0.001, ctx.deadline - time.monotonic())) if ctx.deadline else first_byte + 30
        def admit():
            if not ctx.alive():
                raise ConnectionError("client left before upstream send")
            if ctx.deadline and time.monotonic() >= ctx.deadline:
                raise GatewayError(504, "backend_timeout", "Request time budget exhausted", local=True)
            current = self.sjtu_admit(ctx) if backend == "sjtu" else headers
            self.count_usage(backend)
            return current
        def request_json():
            current = admit()
            return self.finish(model, self.request(url, forwarded, current, timeout=remaining_timeout()))
        url = base + "/v1/chat/completions"
        if streaming:
            sent = False
            for _ in range(3):
                try:
                    stream_limits = {"timeout": IDLE_S, "first_byte_timeout": self.first_byte_s(backend, suffix, ctx)}
                    if ctx.deadline and self.stream_request is loopback_stream:
                        stream_limits["deadline"] = ctx.deadline
                    current = admit()
                    stream_limits["first_byte_timeout"] = self.first_byte_s(backend, suffix, ctx)
                    for event in self.stream_request(url, forwarded, current, **stream_limits):
                        delta = stream_delta(event)
                        # Role-only and reasoning events carry nothing the page can use. Dropping them keeps the
                        # response uncommitted, so an empty or failed answer can still move to another backend.
                        if not delta.get("content") and not sent:
                            continue
                        event["model"] = model
                        on_chunk(event); sent = True
                    if not sent:
                        raise GatewayError(502, "upstream_error", "Upstream returned an empty answer")
                    return None
                except GatewayError as exc:
                    if not sent and exc.status == 400 and backend == "hermes" and "response_format" in forwarded:
                        forwarded.pop("response_format"); continue
                    if not sent and exc.status in (400, 422, 501):
                        forwarded["stream"] = False
                        return request_json()
                    raise
        try:
            return request_json()
        except GatewayError as exc:
            if backend != "hermes" or exc.status != 400 or "response_format" not in forwarded:
                raise
            forwarded.pop("response_format")
            return request_json()

    @staticmethod
    def finish(model, result):
        if not isinstance(result, dict) or not isinstance(result.get("choices"), list) or not result["choices"]:
            raise GatewayError(502, "upstream_error", "Missing upstream choices")
        choice = result["choices"][0]
        message = choice.get("message") if isinstance(choice, dict) else None
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise GatewayError(502, "upstream_error", "Upstream returned an empty answer")
        result["model"] = model
        return result

    def cli(self, backend, model, messages):
        sandbox = self.home / "cli-sandbox"
        sandbox.mkdir(exist_ok=True)
        env = proxy_environment(PROBE_HOSTS[backend], self.proxy)
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
                raise GatewayError(503, "backend_unavailable", "Subscription CLI not installed") from None
            try:
                stdout, _ = proc.communicate(prompt.encode("utf-8"), timeout=180)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
                else:
                    proc.kill()
                proc.communicate()
                raise GatewayError(504, "backend_timeout", "Subscription CLI timed out") from None
            if proc.returncode:
                raise GatewayError(503, "backend_unavailable", "Subscription CLI failed; check its login separately")
            try:
                if backend == "claude":
                    data = json.loads(stdout)
                    if data.get("is_error"):
                        result = str(data.get("result", "")).lower()
                        if "limit" in result and ("hit" in result or "reset" in result):
                            raise GatewayError(429, "subscription_limited", "Claude subscription window is exhausted", 60)
                        raise GatewayError(503, "backend_unavailable", "Claude returned an error")
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

    def chat(self, payload, on_chunk=None, alive=None):
        model, messages = self.validate(payload)
        conf = self.auto_conf()
        ctx = Ctx(float(conf.get("queue_s", QUEUE_WAIT_S)), float(conf["budget_s"]) if model == "auto" else None, alive)
        status, chars = 200, sum(len(m["content"]) for m in messages)
        try:
            if model == "auto":
                return self.chat_auto(payload, messages, on_chunk, ctx)
            return self.run_model(model, payload, messages, on_chunk, ctx)
        except ConnectionError:
            status = 499
            raise
        except GatewayError as exc:
            status = exc.status
            raise
        finally:
            self.metadata(model, chars, ctx.started, status, ctx)

    def health(self):
        """In-memory snapshot, metadata only: no model call and no network round trip."""
        backends = {}
        for name, slots in self.limits.items():
            section = self.config.get(name) or {}
            if not section.get("enabled"):
                continue
            ids = self.hermes_catalog[1] if name == "hermes" else section.get("models", [])
            for suffix in ids:
                model = name + "/" + suffix
                cool = self.cooling_for(model)
                local_wait = self.sjtu_wait(fetch=False) if name == "sjtu" else 0
                state = "cooling" if cool > 0 else "limited" if local_wait > 0 else "ok"
                entry = {"state": state, "cooldown_s": round(cool), "inflight": slots.used,
                         "queued": slots.waiting, "capacity": slots.capacity, **self.stats(model)}
                if name == "sjtu":
                    with self.sjtu_lock:
                        entry["calls_last_minute"] = len([t for t in self.sjtu_calls if t > time.monotonic() - 60.0])
                    entry["max_per_minute"] = self.sjtu_limit()
                backends[model] = entry
        order = self.auto_order(fetch=False)
        return {"ok": True, "name": "DualLens", "version": manifest_version(),
                "uptime_s": round(time.monotonic() - self.booted),
                "auto": {"available": bool(self.auto_candidates(fetch=False)), "candidates": self.auto_candidates(fetch=False),
                         "next": order[0] if order else None},
                "backends": backends, "routes": self.proxy.snapshot()}


class Handler(BaseHTTPRequestHandler):
    server_version = "DualLens/0.4"
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
                body = self.server.gateway.health()
            elif self.path == "/v1/models":
                body = self.server.gateway.models()
            else:
                raise GatewayError(404, "not_found", "Unknown path")
            self.respond(200, body)
        except GatewayError as exc:
            self.error(exc)

    def client_alive(self):
        """False once the peer has closed the socket: a request still waiting in the queue is then dropped
        instead of being sent upstream (which would burn rate-limited quota for nobody)."""
        try:
            if select.select([self.connection], [], [], 0)[0]:
                return self.connection.recv(1, socket.MSG_PEEK) != b""
            return True
        except (OSError, ValueError):
            return False

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
                result = self.server.gateway.chat(payload, on_chunk=self.stream_send, alive=self.client_alive)
                if result is not None:
                    self.stream_send(stream_event(result.get("model", payload["model"]),
                                                  result["choices"][0]["message"]["content"], "stop"))
                self.stream_send("[DONE]")
            else:
                self.respond(200, self.server.gateway.chat(payload, alive=self.client_alive))
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
    # The default listen backlog of 5 makes a burst of simultaneous page batches wait for a SYN retry on Windows.
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler, bind_and_activate=False)
    server.request_queue_size = 128
    try:
        server.server_bind(); server.server_activate()
    except OSError:
        server.server_close(); raise
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
    parser.add_argument("--home", type=Path, help="state directory (default ~/.duallens); lets a test gateway run beside the real one")
    opts = parser.parse_args()
    home = opts.home or HOME
    if opts.command != "serve":
        if opts.command == "pair":
            pair(home, rotate=opts.rotate)
        elif opts.command == "setup":
            setup(home)
        else:
            status(home)
        return
    gateway = Gateway(home)
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
