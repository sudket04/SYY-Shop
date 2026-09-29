from pathlib import Path


def rep(s, old, new, label):
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, found {n}')
    return s.replace(old,new,1)

# Code.gs
p=Path('Code.gs'); s=p.read_text(encoding='utf-8')
start=s.index('function splitCollectionCacheChunks_(docs) {')
end=s.index('function readCollectionCache_(collectionName) {',start)
new='''function splitCollectionCacheChunks_(docs) {\n  docs = docs || [];\n  if (!docs.length) return ["[]"];\n  var chunks = [], parts = [], bytes = 2; // [ ]\n  for (var i = 0; i < docs.length; i++) {\n    var piece = JSON.stringify(docs[i]);\n    var pieceBytes = Utilities.newBlob(piece).getBytes().length;\n    if (pieceBytes + 2 > 95000) return null; // single document too large for CacheService\n    var separatorBytes = parts.length ? 1 : 0;\n    if (parts.length && bytes + separatorBytes + pieceBytes > CACHE_CHUNK_MAX_BYTES) {\n      chunks.push("[" + parts.join(",") + "]");\n      parts = []; bytes = 2; separatorBytes = 0;\n    }\n    parts.push(piece);\n    bytes += separatorBytes + pieceBytes;\n  }\n  if (parts.length) chunks.push("[" + parts.join(",") + "]");\n  return chunks;\n}\n\n'''
s=s[:start]+new+s[end:]
# Inclusive delta boundary + client-side dedupe is safer than > watermark.
s=rep(s,'var movements = queryDashboardMovementsRange_(since, serverTime, true);','var movements = queryDashboardMovementsRange_(since, serverTime, false);','dashboard inclusive boundary')
# Partial receipt idempotency: same invoice/date/delivery note must not mutate stock twice.
old='''      var receipts = [];\n      try { receipts = JSON.parse(parseFirestoreValue(f.Receipts_JSON) || "[]"); } catch (e2) { receipts = []; }\n      receipts.push({\n        date:d.receiptDate, invoiceNo:d.invoiceNo, receiverName:d.receiverName,\n        deliveryNoteNo:allComplete ? "" : String(d.deliveryNoteNo || ""),\n        isFinal:allComplete, items:receiptLineItems\n      });'''
new='''      var receipts = [];\n      try { receipts = JSON.parse(parseFirestoreValue(f.Receipts_JSON) || "[]"); } catch (e2) { receipts = []; }\n      var effectiveDeliveryNote = allComplete ? "" : String(d.deliveryNoteNo || "").trim();\n      var receiptExists = receipts.some(function(r) {\n        return String(r.invoiceNo || "").trim() === String(d.invoiceNo || "").trim()\n          && String(r.date || "") === String(d.receiptDate || "")\n          && String(r.deliveryNoteNo || "").trim() === effectiveDeliveryNote;\n      });\n      if (receiptExists) return fail("รายการรับสินค้านี้ถูกบันทึกแล้ว กรุณาตรวจสอบประวัติการรับสินค้า");\n      receipts.push({\n        date:d.receiptDate, invoiceNo:d.invoiceNo, receiverName:d.receiverName,\n        deliveryNoteNo:effectiveDeliveryNote,\n        isFinal:allComplete, items:receiptLineItems\n      });'''
s=rep(s,old,new,'receipt idempotency')
# Accumulate duplicated request lines instead of last-value-wins.
s=rep(s,
'''      var receiveMap = {};\n      reqItems.forEach(function(it) { receiveMap[it.productCode] = parseFloat(it.qtyReceivedNow || 0); });''',
'''      var receiveMap = {};\n      reqItems.forEach(function(it) {\n        var code = String(it.productCode || "");\n        receiveMap[code] = (receiveMap[code] || 0) + (parseFloat(it.qtyReceivedNow || 0) || 0);\n      });''','receive request merge')
p.write_text(s,encoding='utf-8')

# index.html — queue delta if stock changes while another dashboard request is in flight, and keep ordering.
p=Path('index.html'); s=p.read_text(encoding='utf-8')
s=rep(s,
"loaded:false, loading:false, lastLoad:0, lastSync:'', products:[], movements:[], poVendorMap:{},",
"loaded:false, loading:false, pendingDelta:false, lastLoad:0, lastSync:'', products:[], movements:[], poVendorMap:{},",
'dashboard pending state')
# Scope dashLoad success only by replacing the exact tail around render.
s=rep(s,
'''      dashBuildAggregates();\n      dashUpdateSidebarBadges();\n      dashRenderAll();\n    }, function(err){''',
'''      dashBuildAggregates();\n      dashUpdateSidebarBadges();\n      dashRenderAll();\n      if(DASH.pendingDelta){DASH.pendingDelta=false;setTimeout(dashRefreshDelta,0);}\n    }, function(err){''','dashLoad pending followup')
s=rep(s,
'''  function dashRefreshDelta(){\n    if(DASH.loading) return;\n    if(!DASH.loaded || !DASH.lastSync){ dashLoad(); return; }\n    DASH.loading=true;''',
'''  function dashRefreshDelta(){\n    if(DASH.loading){DASH.pendingDelta=true;return;}\n    if(!DASH.loaded || !DASH.lastSync){ dashLoad(); return; }\n    DASH.loading=true;DASH.pendingDelta=false;''','delta pending start')
s=rep(s,
'''      (data.movements||[]).forEach(function(m){\n        var key=m.id||[m.docNo,m.productCode,m.type,m.timestamp].join('|');if(seen[key])return;seen[key]=true;m.ts=new Date(m.timestamp);DASH.movements.push(m);\n      });\n      var byCode={};''',
'''      (data.movements||[]).forEach(function(m){\n        var key=m.id||[m.docNo,m.productCode,m.type,m.timestamp].join('|');if(seen[key])return;seen[key]=true;m.ts=new Date(m.timestamp);DASH.movements.push(m);\n      });\n      DASH.movements.sort(function(a,b){return b.ts-a.ts;});\n      var byCode={};''','delta movement ordering')
s=rep(s,
'''      dashBuildAggregates();dashUpdateSidebarBadges();dashRenderAll();\n    },function(err){DASH.loading=false;console.error('dashRefreshDelta error:',JSON.stringify(err));dashLoad();});''',
'''      dashBuildAggregates();dashUpdateSidebarBadges();dashRenderAll();\n      if(DASH.pendingDelta){DASH.pendingDelta=false;setTimeout(dashRefreshDelta,0);}\n    },function(err){DASH.loading=false;console.error('dashRefreshDelta error:',JSON.stringify(err));dashLoad();});''','delta pending followup')
p.write_text(s,encoding='utf-8')

# Styles.html — remove accidental duplicate .count declaration.
p=Path('Styles.html'); s=p.read_text(encoding='utf-8')
count='.count{font-size:12.5px;color:var(--muted);font-weight:600;white-space:nowrap}'
s=rep(s,count+count,count,'duplicate count css')
p.write_text(s,encoding='utf-8')
print('post optimization fixes applied')
