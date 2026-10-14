# Translation latency probe

This script is intentionally outside CI. It loads a real, isolated extension and
an 18-paragraph local article. No installed browser profile, gateway configuration
or startup task is modified. The default mode uses a deterministic local mock.

Use the Playwright environment from `tests/e2e/README.md`, for example:

```powershell
$testPython = "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe"
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
$env:PYTHONIOENCODING = 'utf-8'
& $testPython -B -u tests/perf/run_perf.py --variant before
& $testPython -B -u tests/perf/run_perf.py --variant after
```

`before` stages the tracked extension and gateway at `HEAD` using `git archive`;
`--baseline-ref` may pin a different revision. `after` uses the working tree.

Real-provider probes require explicit `--allow-real`:

```powershell
& $testPython -B -u tests/perf/run_perf.py --variant before --allow-real --model sjtu/deepseek-chat --sjtu-budget 8
& $testPython -B -u tests/perf/run_perf.py --variant after --allow-real --model sjtu/deepseek-chat --sjtu-budget 8
& $testPython -B -u tests/perf/run_perf.py --variant before --allow-real --model ollama/qwen3:4b
& $testPython -B -u tests/perf/run_perf.py --variant after --allow-real --model ollama/qwen3:4b
```

Use only when these calls are authorized. Two runs with budget 8 each cannot
exceed 16 SJTU chat attempts; leave time between runs for the background RPM
window. The budget counts upstream chat attempts, including compatibility retries,
but excludes local health/catalog/ledger reads. It does not cap other programs.
The SJTU chain includes the first available allowlisted Hermes model and Ollama;
metadata records reveal if fallback occurred. It never selects subscription CLIs.

Timings start immediately before the toggle command. `first` is the first completed
translation node, `viewport` means all original visible paragraphs are translated,
and `full` means all 18 paragraphs are translated after sequential scrolling.
The full time includes this controlled scrolling and polling overhead. Millisecond
measurements and model/status metadata are saved under `~/.cache/duallens-e2e/`;
no source text, credentials or complete upstream responses are saved. Report
single samples as observations, not latency guarantees or quality evaluations.

Run benchmarks serially with other browser work stopped. Model warm-up, upstream
load and rate-limit windows affect real results; compare more samples within the
authorized call budget before claiming statistical performance improvements.
