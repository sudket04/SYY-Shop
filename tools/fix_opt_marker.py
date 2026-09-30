from pathlib import Path

# Compatibility helper for the historical optimization workflow.
required = ["Code.gs", "Shared.html", "index.html", "tools/optimize_ui_reads.py"]
missing = [p for p in required if not Path(p).exists()]
if missing:
    raise SystemExit("Missing required source files: " + ", ".join(missing))

# Current main already contains the moveProductImage endpoint between primary-image
# and barcode handlers. Normalize the temporary Phase A patcher's exact anchors so
# it preserves that endpoint while adding commitProductImageDraft.
p = Path("tools/optimize_ui_reads.py")
s = p.read_text(encoding="utf-8")
repls = [
    (
        "'  setPrimaryProductImage   : \"staff\",\\n  generateProductBarcode   : \"staff\",'",
        "'  setPrimaryProductImage   : \"staff\",\\n  moveProductImage         : \"staff\",\\n  generateProductBarcode   : \"staff\",'"
    ),
    (
        "'  setPrimaryProductImage   : \"staff\",\\n  commitProductImageDraft  : \"staff\",\\n  generateProductBarcode   : \"staff\",'",
        "'  setPrimaryProductImage   : \"staff\",\\n  moveProductImage         : \"staff\",\\n  commitProductImageDraft  : \"staff\",\\n  generateProductBarcode   : \"staff\",'"
    ),
    (
        "'  setPrimaryProductImage    : setPrimaryProductImage,\\n  generateProductBarcode    : generateProductBarcode,'",
        "'  setPrimaryProductImage    : setPrimaryProductImage,\\n  moveProductImage          : moveProductImage,\\n  generateProductBarcode    : generateProductBarcode,'"
    ),
    (
        "'  setPrimaryProductImage    : setPrimaryProductImage,\\n  commitProductImageDraft   : commitProductImageDraft,\\n  generateProductBarcode    : generateProductBarcode,'",
        "'  setPrimaryProductImage    : setPrimaryProductImage,\\n  moveProductImage          : moveProductImage,\\n  commitProductImageDraft   : commitProductImageDraft,\\n  generateProductBarcode    : generateProductBarcode,'"
    ),
]
for old, new in repls:
    if old not in s:
        raise SystemExit("Phase A compatibility anchor missing: " + old)
    s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
print("Phase A preflight helper: source files present; optimizer anchors normalized")
