"""Scheduling tests: `auto`, queueing, cooldown, SJTU rate window, phased timeouts, proxy choice.

Every upstream is a stub or a throwaway loopback server; no model service, account or network is used."""
import copy
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from gateway import duallens_gateway as g
from gateway.duallens_gateway import (DEFAULTS, Gateway, GatewayError, ProxyChooser, Slots, completion,
    loopback_stream, make_server, proxy_environment, stream_event, tls_probe)

SJTU, OLLAMA, HERMES = "sjtu/deepseek-chat", "ollama/qwen3:4b", "hermes/upstage/solar-mini4:free"


def backend_of(url):
    return "sjtu" if ":18765" in url else "hermes" if ":8645" in url else "ollama"


class Rig:
    """A gateway wired to scripted fake upstreams."""
    def __init__(self, test, sjtu=True, hermes=False, queue_s=2.0):
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        (self.home / "relay.json").write_text(json.dumps({"proxy_token": "test-not-real"}), encoding="utf-8")
        self.config = copy.deepcopy(DEFAULTS)
        self.config["sjtu"].update(enabled=sjtu, token_file=str(self.home / "relay.json"))
        self.config["hermes"]["enabled"] = hermes
        self.config["claude"]["enabled"] = self.config["codex"]["enabled"] = True
        self.config["auto"]["queue_s"] = queue_s
        self.ledger = {"calls": 0, "paused_for": 0}
        self.script = {"sjtu": [], "ollama": [], "hermes": []}  # queued behaviours, last one repeats
        self.calls = []
        self.gw = Gateway(self.home, self.config, request=self.request, stream_request=self.stream,
                          proxy_probe=lambda host, proxy: proxy is None)
        self.gw.hermes_catalog = (time.monotonic() + 600, ["upstage/solar-mini4:free"])
        self.gw.cli = lambda *a, **kw: self.fail("a subscription CLI must never be reached")
        self.test = test

    def fail(self, message):
        self.test.fail(message)

    def behaviour(self, backend):
        queue = self.script[backend]
        return queue.pop(0) if len(queue) > 1 else queue[0] if queue else self.answer("ok-" + backend)

    @staticmethod
    def answer(text, delay=0.0):
        def run(body):
            time.sleep(delay)
            yield stream_event("up", text)
        return run

    @staticmethod
    def error(status, code="upstream_error", retry=None):
        def run(body):
            raise GatewayError(status, code, "stub failure", retry)
            yield
        return run

    @staticmethod
    def empty():
        def run(body):
            yield {"object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant"}}]}
        return run

    def request(self, url, body=None, headers=None, timeout=120):
        if url.endswith("/ledger"):
            return dict(self.ledger)
        if url.endswith("/models"):
            return {"data": [{"id": "upstage/solar-mini4:free"}]}
        self.calls.append(backend_of(url))
        return completion("up", "".join(e["choices"][0]["delta"]["content"] for e in self.behaviour(backend_of(url))(body)))

    def stream(self, url, body, headers=None, timeout=12, first_byte_timeout=None):
        self.calls.append(backend_of(url))
        return self.behaviour(backend_of(url))(body)

    def chat(self, model="auto", stream=True, on_chunk=None, alive=None):
        payload = {"model": model, "stream": stream, "messages": [{"role": "user", "content": "PRIVATE_SENTINEL"}]}
        out = []
        result = self.gw.chat(payload, on_chunk=(on_chunk or out.append) if stream else None, alive=alive)
        return result, out


class AutoSelectionTests(unittest.TestCase):
    def test_configured_paid_or_missing_hermes_models_never_enter_auto(self):
        rig = Rig(self, hermes=True)
        rig.config["hermes"]["models"] += ["paid/model", "missing/model:free"]
        rig.config["auto"]["prefer"] = ["hermes/paid/model", "hermes/missing/model:free", HERMES, OLLAMA]
        rig.gw.hermes_catalog = (time.monotonic() + 600, ["paid/model", "upstage/solar-mini4:free"])
        self.assertEqual(rig.gw.auto_candidates(), [HERMES, OLLAMA])

    def test_empty_json_fails_over_without_exposing_empty_success(self):
        rig = Rig(self)
        rig.script["sjtu"] = [rig.answer("")]
        result, _ = rig.chat(stream=False)
        self.assertEqual(result["model"], OLLAMA)

    def test_malformed_stream_shapes_fail_over_as_backend_errors(self):
        for event in ({"choices": [None]}, {"choices": {}}, {"choices": [{"delta": {"content": 3}}]}):
            rig = Rig(self)
            rig.script["sjtu"] = [lambda body, e=event: iter([e])]
            _, events = rig.chat()
            self.assertEqual(events[0]["model"], OLLAMA)

    def test_auto_is_listed_and_prefers_sjtu_when_healthy(self):
        rig = Rig(self)
        self.assertEqual(rig.gw.models()["data"][0]["id"], "auto")
        _, events = rig.chat()
        self.assertEqual(events[0]["model"], SJTU)
        self.assertEqual(rig.calls, ["sjtu"])

    def test_auto_is_not_offered_without_a_candidate_but_reports_unavailability(self):
        rig = Rig(self, sjtu=False)
        rig.config["ollama"]["enabled"] = False
        self.assertNotIn("auto", [m["id"] for m in rig.gw.models()["data"]])
        with self.assertRaises(GatewayError) as caught:
            rig.chat()
        self.assertEqual((caught.exception.status, caught.exception.code), (503, "no_backend_available"))

    def test_claude_and_codex_never_enter_auto_even_when_listed_in_prefer(self):
        rig = Rig(self)
        rig.config["auto"]["prefer"] = ["claude/sonnet", "codex/default", SJTU, OLLAMA]
        self.assertEqual(rig.gw.auto_candidates(), [SJTU, OLLAMA])
        rig.script["sjtu"] = [rig.error(503)]
        rig.script["ollama"] = [rig.error(503)]
        with self.assertRaises(GatewayError) as caught:  # everything automatic fails; the CLI stub would fail the test
            rig.chat()
        self.assertEqual(caught.exception.code, "no_backend_available")
        self.assertEqual(caught.exception.status, 503)
        self.assertGreaterEqual(caught.exception.retry_after, 1)

    def test_free_hermes_model_is_tried_before_the_slow_local_thinking_model(self):
        rig = Rig(self, hermes=True)
        rig.script["sjtu"] = [rig.error(503)]
        _, events = rig.chat()
        self.assertEqual(events[0]["model"], HERMES)
        self.assertEqual(rig.calls, ["sjtu", "hermes"], "qwen3:4b thinks for ~12 s per batch; it is the last resort")
        rig.calls.clear()
        rig.script["hermes"] = [rig.error(502)]
        _, events = rig.chat()
        self.assertEqual(events[0]["model"], OLLAMA)
        self.assertEqual(rig.calls, ["hermes", "ollama"])

    def test_wildcard_expands_to_the_approved_hermes_models_and_unlisted_ones_are_still_appended(self):
        rig = Rig(self, hermes=True)
        self.assertEqual(rig.gw.auto_candidates(), [SJTU, HERMES, OLLAMA])
        rig.config["auto"]["prefer"] = [OLLAMA, SJTU]
        self.assertEqual(rig.gw.auto_candidates(), [OLLAMA, SJTU, HERMES])
        rig.config["hermes"]["enabled"] = False
        self.assertEqual(rig.gw.auto_candidates(), [OLLAMA, SJTU])

    def test_ollama_receives_thinking_headroom_and_never_reasoning_none(self):
        rig = Rig(self, sjtu=False)
        seen = []
        rig.gw.stream_request = lambda url, body, headers=None, **kw: seen.append(body) or iter([stream_event("up", "x")])
        rig.chat(OLLAMA)
        self.assertEqual(seen[0]["reasoning_effort"], "low")
        self.assertEqual(seen[0]["max_tokens"], 2048 + 3072)
        rig.config["ollama"]["reasoning_effort"] = "medium"
        rig.chat(OLLAMA)
        self.assertEqual(seen[1]["reasoning_effort"], "medium")

    def test_sjtu_429_fails_over_inside_the_same_request_and_obeys_retry_after(self):
        rig = Rig(self)
        rig.script["sjtu"] = [rig.error(429, "rate_limited", 30)]
        _, events = rig.chat()
        self.assertEqual(events[0]["model"], OLLAMA, "the caller gets an answer, not a 429")
        self.assertAlmostEqual(rig.gw.cooling_for(SJTU), 30, delta=2)
        rig.calls.clear()
        rig.chat()
        self.assertEqual(rig.calls, ["ollama"], "a cooling backend is skipped, not retried")

    def test_empty_stream_counts_as_failure_and_moves_on(self):
        rig = Rig(self)
        rig.script["sjtu"] = [rig.empty()]
        result, events = rig.chat()
        self.assertEqual(events[0]["model"], OLLAMA)
        self.assertEqual(rig.calls, ["sjtu", "ollama"])
        self.assertEqual([e["choices"][0]["delta"].get("role") for e in events], [None], "role-only events are not forwarded")

    def test_no_failover_after_bytes_reached_the_client(self):
        rig = Rig(self)
        def partial(body):
            yield stream_event("up", "first")
            raise GatewayError(502, "upstream_error", "boom")
        rig.script["sjtu"] = [partial]
        with self.assertRaises(GatewayError):
            rig.chat()
        self.assertEqual(rig.calls, ["sjtu"])

    def test_slow_sjtu_loses_to_ollama_but_a_moderate_one_keeps_the_quality_preference(self):
        rig = Rig(self)
        rig.chat()                       # one real sample keeps the prior out of the comparison
        now = time.monotonic()
        rig.gw.events[SJTU].clear(); rig.gw.events[OLLAMA] = g.collections.deque([(now, True, 3000, 100)])
        rig.gw.events[SJTU].append((now, True, 12000, 500))
        self.assertEqual(rig.gw.auto_order()[0], SJTU, "12 s vs 3 s: within tolerance, quality wins")
        rig.gw.events[SJTU].append((now, True, 40000, 500))
        rig.gw.events[SJTU].append((now, True, 40000, 500))
        self.assertEqual(rig.gw.auto_order()[0], OLLAMA, "p50 40 s: speed wins")

    def test_busy_ollama_queue_pushes_auto_to_the_other_backend(self):
        rig = Rig(self)
        rig.gw.events[SJTU] = g.collections.deque([(time.monotonic(), True, 9000, 300)])
        rig.gw.events[OLLAMA] = g.collections.deque([(time.monotonic(), True, 3000, 100)])
        self.assertEqual(rig.gw.auto_order()[0], SJTU)
        rig.config["auto"]["prefer"] = [OLLAMA, SJTU]
        for _ in range(4):
            rig.gw.limits["ollama"].acquire()
        self.assertEqual(rig.gw.limits["ollama"].used, 4)
        # Ollama is saturated: its expected time is now (3000 + wait) against SJTU's 9000.
        rig.gw.limits["ollama"].queue.extend(object() for _ in range(40))
        self.assertEqual(rig.gw.auto_order()[0], SJTU)


class SjtuRateWindowTests(unittest.TestCase):
    def test_config_cannot_raise_the_four_per_minute_safety_ceiling(self):
        rig = Rig(self)
        rig.config["sjtu"]["max_per_minute"] = 100
        self.assertEqual(rig.gw.sjtu_limit(), 4)

    def test_a_short_ledger_pause_also_switches_without_waiting(self):
        rig = Rig(self)
        rig.ledger["paused_for"] = 0.5
        _, events = rig.chat()
        self.assertEqual(events[0]["model"], OLLAMA)
        self.assertEqual(rig.calls, ["ollama"])

    def test_json_fallback_reads_ledger_again_and_consumes_a_second_token(self):
        rig = Rig(self)
        rig.script["sjtu"] = [rig.error(400)]
        original = rig.request
        ledgers = []
        def request(url, body=None, headers=None, timeout=120):
            if url.endswith("/ledger"):
                ledgers.append(url)
                return original(url, body, headers, timeout)
            return completion("up", "json fallback")
        rig.gw.request = request
        result, _ = rig.chat(SJTU)
        self.assertEqual(result["model"], SJTU)
        self.assertEqual(len(ledgers), 2)
        self.assertEqual(len(rig.gw.sjtu_calls), 2)

    def test_local_bucket_allows_four_calls_a_minute_then_auto_switches(self):
        rig = Rig(self)
        for _ in range(4):
            rig.chat(SJTU)
        self.assertEqual(rig.calls.count("sjtu"), 4)
        rig.calls.clear()
        _, events = rig.chat()
        self.assertEqual(events[0]["model"], OLLAMA)
        self.assertEqual(rig.calls, ["ollama"], "the fifth call never touches the relay")
        rig.config["auto"]["queue_s"] = 0.3
        with self.assertRaises(GatewayError) as caught:
            rig.chat(SJTU)
        self.assertEqual((caught.exception.status, caught.exception.code), (429, "rate_limited"))
        self.assertGreater(caught.exception.retry_after, 30)
        self.assertEqual(rig.gw.cooling_for(SJTU), 0, "the gateway's own window is not a backend fault")

    def test_ledger_shared_with_hermes_is_read_before_every_send(self):
        for ledger in ({"calls": 4, "paused_for": 0}, {"calls": 1, "paused_for": 25}):
            rig = Rig(self)
            rig.ledger = ledger
            _, events = rig.chat()
            self.assertEqual(events[0]["model"], OLLAMA)
            self.assertNotIn("sjtu", rig.calls)

    def test_explicit_sjtu_request_waits_in_the_queue_when_the_window_reopens_soon(self):
        rig = Rig(self, queue_s=3.0)
        rig.ledger = {"calls": 4, "paused_for": 0}
        threading.Timer(0.7, lambda: rig.ledger.update(calls=0)).start()
        started = time.monotonic()
        _, events = rig.chat(SJTU)
        self.assertEqual(events[0]["model"], SJTU)
        self.assertGreaterEqual(time.monotonic() - started, 0.5)
        self.assertEqual(rig.calls, ["sjtu"])

    def test_relay_credentials_are_sent_only_upstream(self):
        rig = Rig(self)
        seen = []
        rig.gw.stream_request = lambda url, body, headers=None, **kw: seen.append(headers) or iter([stream_event("up", "x")])
        rig.chat(SJTU)
        self.assertEqual(seen[0]["X-DDLHub-Lane"], "background")
        self.assertNotIn("PRIVATE_SENTINEL", rig.gw.metadata_path.read_text())
        self.assertNotIn("test-not-real", rig.gw.metadata_path.read_text())


class QueueTests(unittest.TestCase):
    def test_one_limited_backend_plus_one_busy_backend_is_retryable_busy(self):
        rig = Rig(self, queue_s=0.1)
        rig.script["sjtu"] = [rig.error(429, "rate_limited", 8)]
        rig.gw.limits["ollama"] = Slots(1)
        rig.gw.limits["ollama"].acquire()
        with self.assertRaises(GatewayError) as caught:
            rig.chat()
        self.assertEqual((caught.exception.status, caught.exception.code), (429, "gateway_busy"))
        self.assertEqual(rig.gw.cooling_for(OLLAMA), 0)

    def test_full_slots_queue_the_request_instead_of_refusing_it(self):
        rig = Rig(self, sjtu=False, queue_s=5.0)
        rig.gw.limits["ollama"] = Slots(1)
        active, peak, lock = [0], [0], threading.Lock()
        def slow(body):
            with lock:
                active[0] += 1; peak[0] = max(peak[0], active[0])
            time.sleep(0.15)
            with lock:
                active[0] -= 1
            yield stream_event("up", "done")
        rig.script["ollama"] = [slow]
        results, errors = [], []
        def go():
            try:
                results.append(rig.chat()[1][0]["model"])
            except GatewayError as exc:
                errors.append(exc)
        threads = [threading.Thread(target=go) for _ in range(6)]
        for t in threads: t.start()
        for t in threads: t.join(10)
        self.assertEqual((len(results), errors), (6, []))
        self.assertEqual(peak[0], 1, "the slot limit still holds")

    def test_queue_timeout_is_busy_not_a_fault_and_does_not_cool_the_model(self):
        rig = Rig(self, sjtu=False, queue_s=0.2)
        rig.gw.limits["ollama"] = Slots(1)
        rig.gw.limits["ollama"].acquire()
        for model in (OLLAMA, "auto"):
            with self.assertRaises(GatewayError) as caught:
                rig.chat(model)
            self.assertEqual((caught.exception.status, caught.exception.code), (429, "gateway_busy"))
            self.assertEqual(caught.exception.retry_after, 2)
        self.assertEqual(rig.gw.cooldown, {})
        self.assertEqual(rig.calls, [], "nothing was sent upstream")

    def test_waiters_are_served_in_arrival_order(self):
        slots, order = Slots(1), []
        slots.acquire()
        def waiter(name):
            slots.acquire(timeout=5); order.append(name); slots.release()
        threads = []
        for name in "abc":
            t = threading.Thread(target=waiter, args=(name,)); t.start(); threads.append(t)
            while slots.waiting < len(threads): time.sleep(0.005)
        slots.release()
        for t in threads: t.join(5)
        self.assertEqual(order, ["a", "b", "c"])

    def test_a_client_that_left_is_dropped_from_the_queue_without_an_upstream_call(self):
        rig = Rig(self, sjtu=False, queue_s=5.0)
        rig.gw.limits["ollama"] = Slots(1)
        rig.gw.limits["ollama"].acquire()
        started = time.monotonic()
        with self.assertRaises(ConnectionError):
            rig.chat(OLLAMA, alive=lambda: time.monotonic() - started < 0.4)
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(rig.calls, [])
        self.assertEqual(rig.gw.limits["ollama"].waiting, 0)
        self.assertIn('"status": 499', rig.gw.metadata_path.read_text())


class CooldownTests(unittest.TestCase):
    def test_backoff_doubles_from_fifteen_seconds_and_resets_on_success(self):
        rig = Rig(self, sjtu=False)
        rig.script["ollama"] = [rig.error(503, "backend_unavailable")]
        seen = []
        for _ in range(4):
            rig.gw.cooldown.clear()
            with self.assertRaises(GatewayError):
                rig.chat(OLLAMA)
            seen.append(round(rig.gw.cooling_for(OLLAMA)))
        self.assertEqual(seen, [15, 30, 60, 120])
        rig.script["ollama"] = [rig.answer("fine")]
        rig.gw.cooldown.clear()
        rig.chat(OLLAMA)
        rig.script["ollama"] = [rig.error(502)]
        with self.assertRaises(GatewayError):
            rig.chat(OLLAMA)
        self.assertEqual(round(rig.gw.cooling_for(OLLAMA)), 15)

    def test_rate_limit_retry_after_is_obeyed_and_a_cooling_model_answers_immediately(self):
        rig = Rig(self, sjtu=False)
        rig.script["ollama"] = [rig.error(429, "rate_limited", 7)]
        with self.assertRaises(GatewayError):
            rig.chat(OLLAMA)
        self.assertAlmostEqual(rig.gw.cooling_for(OLLAMA), 7, delta=1)
        started = time.monotonic()
        with self.assertRaises(GatewayError) as caught:
            rig.chat(OLLAMA)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual((caught.exception.status, caught.exception.code), (503, "model_cooling"))
        self.assertLessEqual(caught.exception.retry_after, 8)
        self.assertEqual(rig.calls, ["ollama"], "the cooling model was not called again")

    def test_a_rejected_request_is_not_a_backend_fault(self):
        rig = Rig(self, sjtu=False)
        rig.script["ollama"] = [rig.error(422)]
        with self.assertRaises(GatewayError):
            rig.chat(OLLAMA, stream=False)
        self.assertEqual(rig.gw.cooldown, {})

    def test_http_5xx_is_normalised_to_a_retryable_502_and_429_keeps_retry_after(self):
        self.assertEqual(g.http_failure(500).status, 502)
        self.assertEqual(g.http_failure(503).status, 503)
        class H(dict):
            def get(self, key, default=None): return dict.get(self, key, default)
        failure = g.http_failure(429, H({"Retry-After": "42"}))
        self.assertEqual((failure.status, failure.code, failure.retry_after), (429, "rate_limited", 42))
        self.assertIsNone(g.http_failure(429, H()).retry_after)


class HealthTests(unittest.TestCase):
    def test_cold_and_expired_hermes_health_never_perform_network_io(self):
        rig = Rig(self, hermes=True)
        rig.gw.request = lambda *args, **kwargs: self.fail("health must be an in-memory snapshot")
        for expiry in (0, time.monotonic() - 1):
            rig.gw.hermes_catalog = (expiry, [])
            self.assertTrue(rig.gw.health()["ok"])
            self.assertFalse(rig.gw.catalog_refreshing)

    def test_health_reports_state_success_rate_and_p50_without_touching_the_network(self):
        rig = Rig(self)
        rig.script["ollama"] = [rig.answer("a", 0.05)]  # Windows sleeps can be ~16 ms short of 20 ms
        for _ in range(3):
            rig.chat(OLLAMA)
        rig.script["sjtu"] = [rig.error(503)]
        with self.assertRaises(GatewayError):
            rig.chat(SJTU)
        before = len(rig.calls)
        info = rig.gw.health()
        self.assertEqual(len(rig.calls), before)
        self.assertTrue(info["ok"] and info["name"] == "DualLens")
        self.assertEqual(info["backends"][OLLAMA]["state"], "ok")
        self.assertEqual(info["backends"][OLLAMA]["success_rate_5m"], 1.0)
        self.assertGreaterEqual(info["backends"][OLLAMA]["p50_ms"], 20)
        self.assertEqual(info["backends"][SJTU]["state"], "cooling")
        self.assertEqual(info["backends"][SJTU]["success_rate_5m"], 0.0)
        self.assertGreater(info["backends"][SJTU]["cooldown_s"], 0)
        self.assertEqual(info["auto"]["next"], OLLAMA)
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(info))
        self.assertNotIn("test-not-real", json.dumps(info))

    def test_statistics_cover_five_minutes_only(self):
        rig = Rig(self)
        old = time.monotonic() - 400
        rig.gw.events[OLLAMA] = g.collections.deque([(old, False, 1, None), (time.monotonic(), True, 800, 50)])
        stats = rig.gw.stats(OLLAMA)
        self.assertEqual((stats["requests_5m"], stats["success_rate_5m"], stats["p50_ms"]), (1, 1.0, 800))

    def test_served_model_reaches_the_client_and_the_metadata_log(self):
        rig = Rig(self)
        rig.script["sjtu"] = [rig.error(503)]
        server = make_server(0, rig.gw)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        def post(stream):
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            conn.request("POST", "/v1/chat/completions", json.dumps({"model": "auto", "stream": stream,
                "messages": [{"role": "user", "content": "PRIVATE_SENTINEL"}]}), {"Content-Type": "application/json"})
            response = conn.getresponse(); raw = response.read().decode(); conn.close()
            return response.status, raw
        status, raw = post(False)
        self.assertEqual((status, json.loads(raw)["model"]), (200, OLLAMA))
        status, raw = post(True)
        self.assertIn(OLLAMA, raw); self.assertTrue(raw.endswith("data: [DONE]\n\n"))
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        conn.request("GET", "/health"); body = json.loads(conn.getresponse().read()); conn.close()
        self.assertIn(OLLAMA, body["backends"])
        log = rig.gw.metadata_path.read_text()
        self.assertIn('"model": "auto"', log); self.assertIn('"served": "' + OLLAMA + '"', log)
        self.assertNotIn("PRIVATE_SENTINEL", log)


class FakeSSE(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        plan = self.server.plan
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        try:
            for kind, value in plan:
                if kind == "sleep": time.sleep(value)
                elif kind == "ping": self.wfile.write(b": keep-alive\n\n"); self.wfile.flush()
                elif kind == "text":
                    self.wfile.write(('data: {"choices":[{"delta":{"content":"%s"}}]}\n\n' % value).encode()); self.wfile.flush()
                elif kind == "done": self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
        except OSError:
            pass


class PhasedTimeoutTests(unittest.TestCase):
    def test_absolute_budget_expires_even_when_content_keeps_arriving(self):
        url = self.serve([("text", "a"), ("sleep", 0.1)] * 20 + [("done", 0)])
        start = time.monotonic()
        with self.assertRaises(GatewayError) as caught:
            list(loopback_stream(url, {"model": "t"}, timeout=1, first_byte_timeout=2, deadline=start + 0.4))
        self.assertEqual(caught.exception.status, 504)
        self.assertLess(time.monotonic() - start, 1.2)

    def serve(self, plan):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeSSE); server.plan = plan
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        return "http://127.0.0.1:%d/v1/chat/completions" % server.server_port

    def read(self, plan, **kw):
        return [e["choices"][0]["delta"]["content"] for e in loopback_stream(self.serve(plan), {"model": "t"}, **kw)]

    def test_the_first_byte_may_take_longer_than_the_idle_limit(self):
        got = self.read([("sleep", 0.9), ("text", "a"), ("sleep", 0.1), ("text", "b"), ("done", 0)],
                        timeout=0.5, first_byte_timeout=4)
        self.assertEqual(got, ["a", "b"])

    def test_silence_after_output_started_is_a_stall(self):
        started = time.monotonic()
        with self.assertRaises(GatewayError) as caught:
            self.read([("text", "a"), ("sleep", 2.0), ("text", "b")], timeout=0.4, first_byte_timeout=4)
        self.assertEqual((caught.exception.status, caught.exception.code), (504, "backend_timeout"))
        self.assertLess(time.monotonic() - started, 1.5)

    def test_keep_alive_lines_do_not_extend_the_first_byte_phase(self):
        started = time.monotonic()
        with self.assertRaises(GatewayError) as caught:
            self.read([("ping", 0), ("sleep", 0.1)] * 30 + [("text", "late")], timeout=0.4, first_byte_timeout=0.6)
        self.assertEqual(caught.exception.status, 504)
        self.assertLess(time.monotonic() - started, 1.6)

    def test_upstream_error_status_keeps_its_retry_after(self):
        class Limited(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(429); self.send_header("Retry-After", "17"); self.send_header("Content-Length", "2")
                self.end_headers(); self.wfile.write(b"{}")
        server = ThreadingHTTPServer(("127.0.0.1", 0), Limited)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        with self.assertRaises(GatewayError) as caught:
            list(loopback_stream("http://127.0.0.1:%d/v1/chat/completions" % server.server_port, {"model": "t"}))
        self.assertEqual((caught.exception.status, caught.exception.retry_after), (429, 17))

    def test_a_closed_port_is_unavailable_not_a_timeout(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0)); port = probe.getsockname()[1]
        with self.assertRaises(GatewayError) as caught:
            list(loopback_stream("http://127.0.0.1:%d/x" % port, {"model": "t"}))
        self.assertEqual(caught.exception.status, 503)


class ProxyChoiceTests(unittest.TestCase):
    def chooser(self, working, now):
        probes = []
        def probe(host, proxy):
            probes.append((host, proxy)); return proxy in working
        sources = lambda: [("env", "http://127.0.0.1:1"), ("direct", None), ("system", "http://127.0.0.1:7897")]
        return ProxyChooser(probe, sources, clock=lambda: now[0]), probes

    def test_broken_proxy_is_skipped_in_favour_of_direct_and_the_answer_is_cached_five_minutes(self):
        now = [0.0]
        chooser, probes = self.chooser({None}, now)
        self.assertEqual(chooser.route("api.anthropic.com"), ("direct", None))
        self.assertEqual(len(probes), 2, "env proxy failed, direct worked: the system proxy is never probed")
        chooser.route("api.anthropic.com"); now[0] = 299
        chooser.route("api.anthropic.com")
        self.assertEqual(len(probes), 2)
        now[0] = 301
        chooser.route("api.anthropic.com")
        self.assertEqual(len(probes), 4)

    def test_system_proxy_is_used_when_direct_does_not_work(self):
        chooser, _ = self.chooser({"http://127.0.0.1:7897"}, [0.0])
        self.assertEqual(chooser.route("chatgpt.com"), ("system", "http://127.0.0.1:7897"))

    def test_when_nothing_works_the_child_gets_no_proxy_and_the_failure_is_cached_briefly(self):
        now = [0.0]
        chooser, probes = self.chooser(set(), now)
        self.assertEqual(chooser.route("chatgpt.com"), ("direct", None))
        count = len(probes); now[0] = 10
        chooser.route("chatgpt.com"); self.assertEqual(len(probes), count)
        now[0] = 31
        chooser.route("chatgpt.com"); self.assertGreater(len(probes), count)

    def test_child_environment_never_inherits_a_dead_proxy_or_billing_keys(self):
        chooser, _ = self.chooser({None}, [0.0])
        with patch.dict("os.environ", {"HTTPS_PROXY": "http://127.0.0.1:7897", "http_proxy": "http://127.0.0.1:7897",
                                       "ANTHROPIC_API_KEY": "TEST_SENTINEL", "PATH": "x"}):
            env = proxy_environment("api.anthropic.com", chooser)
        self.assertEqual([k for k in env if k.upper() in g.PROXY_VARS], [])
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        chooser, _ = self.chooser({"http://127.0.0.1:7897"}, [0.0])
        with patch.dict("os.environ", {"HTTPS_PROXY": ""}):
            env = proxy_environment("api.anthropic.com", chooser)
        self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:7897")

    def test_cli_children_receive_the_probed_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            gateway = Gateway(Path(tmp), copy.deepcopy(DEFAULTS))
            gateway.proxy = ProxyChooser(lambda host, proxy: proxy is None, lambda: [("env", "http://127.0.0.1:1"), ("direct", None)])
            captured = []
            class Proc:
                pid, returncode = 1, 0
                def communicate(self, data=None, timeout=None): return b'{"result":"ok","is_error":false}', b""
            with patch("gateway.duallens_gateway.subprocess.Popen", side_effect=lambda a, **kw: captured.append(kw["env"]) or Proc()), \
                 patch.dict("os.environ", {"HTTPS_PROXY": "http://127.0.0.1:1"}):
                gateway.cli("claude", "haiku", [{"role": "user", "content": "x"}])
            self.assertFalse([k for k in captured[0] if k.upper() in g.PROXY_VARS])

    def test_tls_probe_rejects_a_proxy_that_refuses_connect_or_cannot_complete_tls(self):
        def serve(reply):
            listener = socket.socket(); listener.bind(("127.0.0.1", 0)); listener.listen(5)
            def run():
                while True:
                    try: conn, _ = listener.accept()
                    except OSError: return
                    conn.recv(1024); conn.sendall(reply); time.sleep(0.05); conn.close()
            threading.Thread(target=run, daemon=True).start()
            self.addCleanup(listener.close)
            return "http://127.0.0.1:%d" % listener.getsockname()[1]
        self.assertFalse(tls_probe("example.invalid", serve(b"HTTP/1.1 502 Bad Gateway\r\n\r\n"), timeout=1))
        self.assertFalse(tls_probe("example.invalid", serve(b"HTTP/1.1 200 Connection established\r\n\r\nnot tls"), timeout=1),
                         "CONNECT succeeds but TLS fails: exactly the broken 7897 behaviour")
        self.assertFalse(tls_probe("example.invalid", "http://127.0.0.1:9", timeout=1))


if __name__ == "__main__":
    unittest.main()
