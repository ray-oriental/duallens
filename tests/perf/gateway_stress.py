#!/usr/bin/env python3
"""Offline stress test for the gateway's `auto` scheduler, excluded from CI.

Starts the working-tree gateway on its own port (default 18799, never the user's 18790) with a private
state directory, in front of two fake backends that this script controls: an SJTU relay that enforces a
background-lane rate window and can be put into a 429 storm, and an Ollama that serves only two requests
at a time and can be slowed down. No model, account, network or user configuration is involved.

Each phase fires a burst of concurrent streaming translations at `auto` and reports latency percentiles,
the status codes seen, the backends that served and how many answers needed a client-side busy retry
(the client retries only `gateway_busy`; backend outages fail the run).

    python -B tests/perf/gateway_stress.py [--port 18799] [--burst 30]
"""
from __future__ import annotations
import argparse
import collections
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Fake:
    """Shared, thread-safe knobs for both fake backends."""
    def __init__(self):
        self.lock = threading.Lock()
        self.sjtu_calls, self.storm_until = [], 0.0
        self.sjtu_total = self.ollama_total = 0
        self.ollama_gate = threading.BoundedSemaphore(2)
        self.ollama_slow = 1.0
        self.sjtu_rejected = 0


def sse(handler, text, first, total):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Connection", "close")
    handler.end_headers()
    time.sleep(first)
    handler.wfile.write(('data: {"choices":[{"delta":{"content":%s}}]}\n\n' % json.dumps(text)).encode()); handler.wfile.flush()
    time.sleep(max(0.0, total - first))
    handler.wfile.write(b'data: {"choices":[{"delta":{"content":"."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    handler.wfile.flush()


def relay_handler(fake):
    class Relay(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            now = time.time()
            with fake.lock:
                fake.sjtu_calls = [t for t in fake.sjtu_calls if t > now - 60]
                # Deliberately stale ledger during a storm: exercise an actual upstream 429.
                body = json.dumps({"calls": 0 if now < fake.storm_until else len(fake.sjtu_calls), "paused_for": 0}).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            now = time.time()
            with fake.lock:
                fake.sjtu_calls = [t for t in fake.sjtu_calls if t > now - 60]
                refuse = now < fake.storm_until or len(fake.sjtu_calls) >= 5
                if not refuse:
                    fake.sjtu_calls.append(now); fake.sjtu_total += 1
                else:
                    fake.sjtu_rejected += 1
            if refuse:
                self.send_response(429); self.send_header("Retry-After", "8"); self.send_header("Content-Length", "2")
                self.end_headers(); self.wfile.write(b"{}")
                return
            sse(self, "sjtu-translation", random.uniform(0.3, 0.9), random.uniform(1.2, 2.8))
    return Relay


def ollama_handler(fake):
    class Ollama(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            body = b'{"models":[]}'
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            with fake.ollama_gate:  # Ollama's own parallelism: extra callers simply wait
                fake.ollama_total += 1
                sse(self, "ollama-translation", 0.2 * fake.ollama_slow, random.uniform(0.6, 1.4) * fake.ollama_slow)
    return Ollama


def one_request(port, results):
    """One translation as the extension would make it: busy answers are retried after Retry-After."""
    body = json.dumps({"model": "auto", "stream": True, "max_tokens": 512,
                       "messages": [{"role": "user", "content": "Translate: hello"}]}).encode()
    began, attempts, statuses = time.monotonic(), 0, []
    while attempts < 8:
        attempts += 1
        request = urllib.request.Request("http://127.0.0.1:%d/v1/chat/completions" % port, data=body,
                                         headers={"Content-Type": "application/json"})
        try:
            with OPENER.open(request, timeout=100) as response:
                wire = response.read().decode()
            events = [json.loads(line[5:]) for line in wire.splitlines() if line.startswith("data: {")]
            served = events[0].get("model") if events else None
            if (not wire.endswith("data: [DONE]\n\n") or any("error" in e for e in events)
                    or served not in ("sjtu/deepseek-chat", "ollama/qwen3:4b")
                    or any(e.get("model") != served for e in events)
                    or not any(e.get("choices", [{}])[0].get("delta", {}).get("content") for e in events)):
                raise ValueError("incomplete or invalid SSE completion")
            statuses.append(200)
            results.append({"ok": True, "ms": (time.monotonic() - began) * 1000, "statuses": statuses, "served": served})
            return
        except urllib.error.HTTPError as exc:
            statuses.append(exc.code)
            retry = float(exc.headers.get("Retry-After") or 2)
            try:
                code = json.loads(exc.read())["error"]["code"]
            except (ValueError, KeyError):
                code = ""
            if code != "gateway_busy":
                break
            time.sleep(min(retry, 5))
        except (OSError, ValueError, KeyError, IndexError):
            statuses.append(0)
            break
    results.append({"ok": False, "ms": (time.monotonic() - began) * 1000, "statuses": statuses, "served": None})


def percentile(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))] if values else None


def burst(port, count, label):
    results, threads = [], []
    for _ in range(count):
        threads.append(threading.Thread(target=one_request, args=(port, results), daemon=True))
    wall = time.monotonic()
    for t in threads: t.start()
    deadline = time.monotonic() + 240
    for t in threads: t.join(max(0, deadline - time.monotonic()))
    if any(t.is_alive() for t in threads):
        raise RuntimeError("stress phase exceeded its 240-second budget")
    wall = time.monotonic() - wall
    ms = [r["ms"] for r in results if r["ok"]]
    codes = collections.Counter(code for r in results for code in r["statuses"])
    summary = {"phase": label, "requests": count, "answered": len(ms), "failed": count - len(ms),
               "p50_ms": round(percentile(ms, .5)) if ms else None, "p95_ms": round(percentile(ms, .95)) if ms else None,
               "max_ms": round(max(ms)) if ms else None, "wall_s": round(wall, 1),
               "http_statuses": dict(sorted(codes.items())), "needed_busy_retry": sum(1 for r in results if len(r["statuses"]) > 1),
               "served_by": dict(collections.Counter(r["served"] for r in results if r["ok"]))}
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def health(port):
    with OPENER.open("http://127.0.0.1:%d/health" % port, timeout=5) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18799)
    parser.add_argument("--burst", type=int, default=30)
    opts = parser.parse_args()
    if opts.port in (18790, 18791):
        raise SystemExit("refusing to touch the user's gateway port")
    if not 1 <= opts.burst <= 100:
        raise SystemExit("burst must be between 1 and 100")
    random.seed(42)
    fake = Fake()
    servers = []
    for handler, port in ((relay_handler(fake), 0), (ollama_handler(fake), 0)):
        server = ThreadingHTTPServer(("127.0.0.1", port), handler); server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start(); servers.append(server)
    cache = Path.home() / ".cache/duallens-e2e/v04/dev-gateway"
    cache.mkdir(parents=True, exist_ok=True)
    state = tempfile.TemporaryDirectory(prefix="stress-", dir=cache)
    home = Path(state.name)
    (home / "relay.json").write_text(json.dumps({"proxy_token": "stress-not-real"}), encoding="utf-8")
    (home / "gateway.json").write_text(json.dumps({
        "sjtu": {"enabled": True, "url": "http://127.0.0.1:%d" % servers[0].server_port, "token_file": str(home / "relay.json")},
        "ollama": {"enabled": True, "url": "http://127.0.0.1:%d" % servers[1].server_port, "models": ["qwen3:4b"]},
        "hermes": {"enabled": False}, "claude": {"enabled": False}, "codex": {"enabled": False}}), encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k.upper() not in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY")}
    gateway = subprocess.Popen([sys.executable, "-B", str(ROOT / "gateway/duallens_gateway.py"), "serve",
                                "--port", str(opts.port), "--home", str(home)], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                health(opts.port); break
            except OSError:
                time.sleep(0.2)
        else:
            raise SystemExit("test gateway did not start")
        phases = []
        phases.append(burst(opts.port, opts.burst, "A healthy backends"))
        time.sleep(62)  # let the SJTU rate window empty so each phase starts equal
        fake.storm_until = time.time() + 20
        phases.append(burst(opts.port, opts.burst, "B SJTU 429 storm (Retry-After 8, 20 s)"))
        time.sleep(62)
        fake.ollama_slow = 5.0
        phases.append(burst(opts.port, opts.burst, "C Ollama congested (5x slower, 2 at a time)"))
        time.sleep(62)
        fake.storm_until = time.time() + 20
        phases.append(burst(opts.port, opts.burst, "D both degraded"))
        fake.ollama_slow = 1.0
        info = health(opts.port)
        print(json.dumps({"final_health": {k: v for k, v in info["backends"].items()}, "auto": info["auto"],
                          "fake": {"sjtu_served": fake.sjtu_total, "sjtu_refused": fake.sjtu_rejected,
                                   "ollama_served": fake.ollama_total}}, ensure_ascii=False))
        log = [json.loads(line) for line in (home / "gateway.log").read_text(encoding="utf-8").splitlines()]
        print(json.dumps({"gateway_log_statuses": dict(collections.Counter(r["status"] for r in log))}))
        failed = sum(p["failed"] for p in phases)
        bad = sum(n for p in phases for code, n in p["http_statuses"].items() if 500 <= code < 600)
        print("RESULT: %d of %d answered, %d requests saw 5xx" % (sum(p["answered"] for p in phases),
              sum(p["requests"] for p in phases), bad))
        print("UPSTREAM_429_EXERCISED: %d" % fake.sjtu_rejected)
        return 1 if failed or bad or not fake.sjtu_rejected else 0
    finally:
        gateway.terminate()
        try:
            gateway.wait(10)
        except subprocess.TimeoutExpired:
            gateway.kill(); gateway.wait(10)
        for server in servers:
            server.shutdown(); server.server_close()
        state.cleanup()


if __name__ == "__main__":
    sys.exit(main())
