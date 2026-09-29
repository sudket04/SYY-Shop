from pathlib import Path

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')
needle='  function onProductImageSelected(input) {'
pos=[]
i=0
while True:
    i=s.find(needle,i)
    if i<0: break
    pos.append(i); i+=len(needle)
if len(pos)!=2:
    raise SystemExit(f'Expected exactly 2 onProductImageSelected definitions, found {len(pos)}')
start=pos[1]
end=s.find('  // ==========================================\n  // ดูรายละเอียดสินค้า',start)
if end<0:
    raise SystemExit('Could not find product detail section after duplicate image handlers')
s=s[:start]+s[end:]
# Guard against all duplicate image handlers introduced by the old single-image implementation.
for name in ['onProductImageSelected','uploadProductImageNow','deleteProductImageNow']:
    count=s.count('function '+name+'(')
    if count!=1:
        raise SystemExit(f'{name} definition count after cleanup = {count}')
p.write_text(s,encoding='utf-8')
print('Duplicate image handlers removed')
