"""Portable compatibility entry point for the canonical mock lifecycle regressions.
With arguments, forwards directly to the official E2E runner.
"""
from pathlib import Path
import runpy
import sys

if not sys.argv[1:]:
    sys.argv += [arg for name in (
        "ui_settings", "paragraph_edit", "never_wake", "input_edit_race",
        "clone_safety", "native_attributes_restore", "toast_expiry_cleanup",
    ) for arg in ("--only", name)]
runpy.run_path(str(Path(__file__).resolve().parents[1] / "e2e" / "run_e2e.py"), run_name="__main__")
