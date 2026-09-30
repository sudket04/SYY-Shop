from pathlib import Path
import re

p=Path('Code.gs')
s=p.read_text(encoding='utf-8')

if 'function moveProductImage(productCode, fromSlot, toSlot)' not in s:
    marker='\n// ==========================================\n// 2b. ★ Cache Layer'
    if marker not in s:
        raise SystemExit('cache marker not found')
    fn='''

function moveProductImage(productCode, fromSlot, toSlot) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    var cur = getProductImageDocData_(productCode);
    fromSlot = parseInt(fromSlot, 10);
    toSlot = parseInt(toSlot, 10);
    if (isNaN(fromSlot) || isNaN(toSlot)) return { success: false, message: "ตำแหน่งรูปไม่ถูกต้อง" };
    if (fromSlot < 0 || toSlot < 0 || fromSlot >= cur.urls.length || toSlot >= cur.urls.length) {
      return { success: false, message: "ตำแหน่งรูปอยู่นอกช่วง" };
    }
    if (fromSlot === toSlot) {
      var same = normalizeProductImageData_("", "", cur.urls, cur.ids, cur.primaryIndex);
      return { success: true, imageUrl: same.primaryUrl, imageUrls: same.urls, primaryIndex: same.primaryIndex };
    }

    var oldPrimary = cur.primaryIndex;
    var movedUrl = cur.urls.splice(fromSlot, 1)[0];
    var movedId = cur.ids.splice(fromSlot, 1)[0] || "";
    cur.urls.splice(toSlot, 0, movedUrl);
    cur.ids.splice(toSlot, 0, movedId);

    if (oldPrimary === fromSlot) cur.primaryIndex = toSlot;
    else if (fromSlot < oldPrimary && toSlot >= oldPrimary) cur.primaryIndex = oldPrimary - 1;
    else if (fromSlot > oldPrimary && toSlot <= oldPrimary) cur.primaryIndex = oldPrimary + 1;

    var saved = saveProductImageDoc_(productCode, "", "", cur.urls, cur.ids, cur.primaryIndex);
    return { success: true, imageUrl: saved.primaryUrl, imageUrls: saved.urls, primaryIndex: saved.primaryIndex };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
'''
    s=s.replace(marker,fn+marker,1)

if re.search(r'^\s*moveProductImage\s*:\s*"staff"',s,re.M) is None:
    m=re.search(r'^(\s*)setPrimaryProductImage\s*:\s*"staff",?\s*$',s,re.M)
    if not m:
        raise SystemExit('staff registry marker not found')
    s=s[:m.end()]+'\n'+m.group(1)+'moveProductImage         : "staff",'+s[m.end():]

if re.search(r'^\s*moveProductImage\s*:\s*moveProductImage\b',s,re.M) is None:
    m=re.search(r'^(\s*)setPrimaryProductImage\s*:\s*setPrimaryProductImage,?\s*$',s,re.M)
    if not m:
        raise SystemExit('gateway registry marker not found')
    s=s[:m.end()]+'\n'+m.group(1)+'moveProductImage          : moveProductImage,'+s[m.end():]

p.write_text(s,encoding='utf-8')
