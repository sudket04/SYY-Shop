from pathlib import Path
import re

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')
# The new 3-image handler is minified as `function name(...){` while the
# legacy single-image block uses `function name(...) {`. Remove only legacy.
start=s.find('  function onProductImageSelected(input) {')
if start<0:
    raise SystemExit('Legacy onProductImageSelected block not found')
end=s.find('  // ==========================================\n  // ดูรายละเอียดสินค้า',start)
if end<0:
    raise SystemExit('Product detail section not found after legacy image handlers')
s=s[:start]+s[end:]
for name in ['onProductImageSelected','uploadProductImageNow','deleteProductImageNow']:
    count=len(re.findall(r'function\s+'+re.escape(name)+r'\s*\(',s))
    if count!=1:
        raise SystemExit(f'{name} definition count after cleanup = {count}')
if 'setPrimaryProductImageNow' not in s or 'productImageSlots' not in s:
    raise SystemExit('New 3-image implementation is missing')
p.write_text(s,encoding='utf-8')
print('Legacy duplicate image handlers removed; new 3-image handlers retained')
