from pathlib import Path

# Compatibility helper for the historical optimization workflow.
# Phase A is applied by tools/optimize_ui_reads.py; no source normalization is required here.
required = ["Code.gs", "Shared.html", "index.html"]
missing = [p for p in required if not Path(p).exists()]
if missing:
    raise SystemExit("Missing required source files: " + ", ".join(missing))
print("Phase A preflight helper: source files present")
