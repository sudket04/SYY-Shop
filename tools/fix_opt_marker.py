from pathlib import Path

# Compatibility helper for the historical optimization workflow.
required = ["Code.gs", "Shared.html", "index.html", "tools/optimize_ui_reads.py"]
missing = [p for p in required if not Path(p).exists()]
if missing:
    raise SystemExit("Missing required source files: " + ", ".join(missing))

p = Path("tools/optimize_ui_reads.py")
s = p.read_text(encoding="utf-8")

# Current main already contains moveProductImage between primary-image and barcode handlers.
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

# Brand/Category pages intentionally contain the same post-write refresh sequence twice
# (save + delete). Keep strict verification but replace only the first occurrence for save.
old = "    t=must_replace(t,old,new,f'{filename} save local delta')"
new = "    if t.count(old) != 2:\n        raise RuntimeError(f'{filename} save/delete local delta: expected 2 exact matches, found {t.count(old)}')\n    t=t.replace(old,new,1)"
if old not in s:
    raise SystemExit("patch_simple_master compatibility anchor missing")
s = s.replace(old, new, 1)

# Vendor/Zone/Cars have the same save/delete duplicate sequence. Patch the first one explicitly,
# leaving the second strict must_replace as the delete verification.
for var, label in [("vendor", "Vendor"), ("zone", "Zone"), ("cars", "Cars")]:
    old = f"{var}=must_replace({var},{var}_old if '{var}'!='vendor' else vendor_save,{var}_new,'{label} save local delta')"
    # source uses vendor_save for vendor and <var>_old for zone/cars; build exact strings directly.

specific = [
    (
        "vendor=must_replace(vendor,vendor_save,vendor_new,'Vendor save local delta')",
        "if vendor.count(vendor_save)!=2: raise RuntimeError(f'Vendor save/delete local delta: expected 2 exact matches, found {vendor.count(vendor_save)}')\nvendor=vendor.replace(vendor_save,vendor_new,1)"
    ),
    (
        "zone=must_replace(zone,zone_old,zone_new,'Zone save local delta')",
        "if zone.count(zone_old)!=2: raise RuntimeError(f'Zone save/delete local delta: expected 2 exact matches, found {zone.count(zone_old)}')\nzone=zone.replace(zone_old,zone_new,1)"
    ),
    (
        "cars=must_replace(cars,cars_old,cars_new,'Cars save local delta')",
        "if cars.count(cars_old)!=2: raise RuntimeError(f'Cars save/delete local delta: expected 2 exact matches, found {cars.count(cars_old)}')\ncars=cars.replace(cars_old,cars_new,1)"
    ),
]
for old, new in specific:
    if old not in s:
        raise SystemExit("Master patch compatibility anchor missing: " + old)
    s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8")
print("Phase A preflight helper: source files present; optimizer anchors normalized")
