from pathlib import Path
import re

ROOT = Path('.')


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


def write(name, text):
    (ROOT / name).write_text(text, encoding='utf-8')


def must_replace(text, old, new, label, count=1):
    found = text.count(old)
    if found != count:
        raise RuntimeError(f'{label}: expected {count} exact match(es), found {found}')
    return text.replace(old, new, count)


def must_regex(text, pattern, repl, label, count=1, flags=re.S):
    out, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n != count:
        raise RuntimeError(f'{label}: expected {count} regex match(es), found {n}')
    return out


# ---------------------------------------------------------------------------
# Code.gs — backward-compatible delta contracts, list-only reads, image draft
# ---------------------------------------------------------------------------
code = read('Code.gs')

code = must_replace(
    code,
    'return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: newId };',
    'return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: newId, data: dataObject };',
    'saveMasterData create response'
)
code = must_replace(
    code,
    'return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: id };',
    'return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: id, data: dataObject };',
    'saveMasterData update response'
)

# Add one-shot Product Image draft commit. Existing immediate endpoints remain for backward compatibility.
image_marker = '// ==========================================\n// 2b. ★ Cache Layer — ลด Firestore Reads (Firebase Spark Plan / Free Quota)\n// =========================================='
image_commit_fn = r'''
/**
 * Phase A: บันทึก Product Gallery จาก draft ฝั่ง browser ครั้งเดียวตอนกดบันทึกสินค้า
 * - ไม่เปลี่ยน schema Product_Images เดิม
 * - รูปเดิมที่ยังถูกอ้างอิงจะ reuse URL/File ID เดิม
 * - รูปใหม่สร้างใน Drive ก่อน แล้วค่อยเขียน metadata; ถ้า metadata ล้มเหลวจะ trash ไฟล์ใหม่
 * - ไฟล์เดิมที่ผู้ใช้ลบออกจะ trash หลัง metadata สำเร็จเท่านั้น
 */
function commitProductImageDraft(productCode, draft) {
  var newFileIds = [];
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    draft = draft || {};
    var items = Array.isArray(draft.items) ? draft.items.slice(0, 3) : [];
    var cur = getProductImageDocData_(productCode);
    var oldByUrl = {};
    cur.urls.forEach(function(url, i) { if (url) oldByUrl[url] = cur.ids[i] || ""; });

    var folder = null, urls = [], ids = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var existingUrl = String(it.url || "").trim();
      var base64 = String(it.base64 || "").trim();
      if (base64) {
        var bytes = Utilities.base64Decode(base64);
        if (bytes.length > 5 * 1024 * 1024) throw new Error("ไฟล์รูปใหญ่เกิน 5MB หลังประมวลผล");
        if (!(bytes.length > 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255)) {
          throw new Error("รูปหลังประมวลผลไม่ใช่ JPEG ที่ถูกต้อง");
        }
        if (!folder) folder = getProductImageFolder_();
        var file = folder.createFile(Utilities.newBlob(bytes, "image/jpeg", productCode + "_" + (i + 1) + ".jpg"));
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var fileId = file.getId();
        urls.push("https://lh3.googleusercontent.com/d/" + fileId);
        ids.push(fileId);
        newFileIds.push(fileId);
      } else if (existingUrl && Object.prototype.hasOwnProperty.call(oldByUrl, existingUrl)) {
        urls.push(existingUrl);
        ids.push(oldByUrl[existingUrl]);
      }
    }

    var primaryIndex = Math.max(0, Math.min(parseInt(draft.primaryIndex, 10) || 0, Math.max(0, urls.length - 1)));
    var saved;
    try {
      if (!urls.length) {
        deleteProductImageDoc_(productCode);
        saved = { primaryUrl: "", urls: [], ids: [], primaryIndex: 0 };
      } else {
        saved = saveProductImageDoc_(productCode, "", "", urls, ids, primaryIndex);
      }
    } catch (saveErr) {
      newFileIds.forEach(function(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
      throw saveErr;
    }

    var retained = {};
    (saved.ids || ids).forEach(function(id) { if (id) retained[id] = true; });
    cur.ids.forEach(function(id) {
      if (id && !retained[id]) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
    });
    return {
      success: true,
      imageUrl: saved.primaryUrl || "",
      imageUrls: (saved.urls || []).slice(0, 3),
      primaryIndex: saved.primaryIndex || 0
    };
  } catch (e) {
    newFileIds.forEach(function(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e2) {} });
    return { success: false, message: e.message };
  }
}

'''
code = must_replace(code, image_marker, image_commit_fn + image_marker, 'insert image draft commit')

# Product save now returns one canonical product object rather than forcing callers to reread the whole collection.
code = must_replace(
    code,
    'return saveMasterData("Master_Products", "P", docId, dataObject, null);',
    '''var saveRes = saveMasterData("Master_Products", "P", docId, dataObject, null);\n  if (saveRes && saveRes.success) {\n    saveRes.product = getProductById(saveRes.id);\n    if (saveRes.product) saveRes.product.id = saveRes.id;\n  }\n  return saveRes;''',
    'saveProduct return delta'
)

# Targeted customer read for quotation save (avoid getCustomersFull() scan/cache hydration on every save).
customer_marker = 'function deleteCustomer(docId) { return deleteFirestoreDocument("Master_Customers", docId); }'
customer_target = r'''
function getCustomerById_(docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Customers/" + encodeURIComponent(docId);
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var f = JSON.parse(res.getContentText()).fields || {};
    var obj = {
      id            : docId,
      Customer_Name : parseFirestoreValue(f.Customer_Name) || "",
      Customer_Type : parseFirestoreValue(f.Customer_Type) || "",
      Address_No     : parseFirestoreValue(f.Address_No) || "",
      Address_Moo    : parseFirestoreValue(f.Address_Moo) || "",
      Address_Road   : parseFirestoreValue(f.Address_Road) || "",
      Subdistrict    : parseFirestoreValue(f.Subdistrict) || "",
      District       : parseFirestoreValue(f.District) || "",
      Province       : parseFirestoreValue(f.Province) || "",
      Postal_Code    : parseFirestoreValue(f.Postal_Code) || "",
      Tax_ID         : String(parseFirestoreValue(f.Tax_ID) || ""),
      Branch         : parseFirestoreValue(f.Branch) || "",
      Phone          : parseFirestoreValue(f.Phone) || "",
      Status         : parseFirestoreValue(f.Status) || ""
    };
    obj.Address = buildFullAddress({
      addressNo: obj.Address_No, addressMoo: obj.Address_Moo, addressRoad: obj.Address_Road,
      subdistrict: obj.Subdistrict, district: obj.District, province: obj.Province,
      postalCode: obj.Postal_Code, address: parseFirestoreValue(f.Address)
    });
    return obj;
  } catch (e) {
    console.error("getCustomerById_ error:", e);
    return null;
  }
}

'''
code = must_replace(code, customer_marker, customer_target + customer_marker, 'insert targeted customer getter')
code = must_regex(
    code,
    r'var cust = getCustomersFull\(\)\.filter\(function\(c\) \{ return c\.id === d\.customerId; \}\)\[0\];',
    'var cust = getCustomerById_(d.customerId);',
    'quotation targeted customer'
)

# List-only endpoints after the first page bootstrap.
tax_page_marker = 'function getTaxInvoicePageData(yearFilter) {'
tax_list_fn = r'''function getTaxInvoiceListData(yearFilter) {
  var invoices;
  if (yearFilter === "all") {
    invoices = getTaxInvoiceList();
  } else {
    var yearBE = parseInt(yearFilter, 10) || (new Date().getFullYear() + 543);
    invoices = getTaxInvoiceListByYear(yearBE);
  }
  return { invoices: invoices, availableYears: getTaxInvoiceAvailableYears() };
}

'''
code = must_replace(code, tax_page_marker, tax_list_fn + tax_page_marker, 'insert tax list-only endpoint')

quote_page_marker = 'function getQuotationPageData(yearFilter) {'
quote_list_fn = r'''function getQuotationListData(yearFilter) {
  var quotationsList;
  if (yearFilter === "all") {
    quotationsList = getQuotationList();
  } else {
    var yearBE = parseInt(yearFilter, 10) || (new Date().getFullYear() + 543);
    quotationsList = getQuotationListByYear(yearBE);
  }
  return { quotations: quotationsList, availableYears: getQuotationAvailableYears() };
}

'''
code = must_replace(code, quote_page_marker, quote_list_fn + quote_page_marker, 'insert quotation list-only endpoint')

# receiveGoods returns only the PO/product deltas already known inside its transaction.
old_receive_return = '''return {\n          success:true, title:"สำเร็จ",\n          message:allComplete ? "บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย" : "บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย",\n          status:newStatus\n        };'''
new_receive_return = '''return {\n          success:true, title:"สำเร็จ",\n          message:allComplete ? "บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย" : "บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย",\n          status:newStatus,\n          po:{ poId:d.poId, status:newStatus, items:poItems, receipts:receipts },\n          productStocks:stockAdditions.map(function(l) {\n            var info=stockMap[l.productCode], qty=parseFloat(l.qty || 0);\n            return { productCode:l.productCode, currentStock:info.stock + qty, minStock:info.minStock, costPrice:info.costPrice, sellingPrice:info.sellingPrice };\n          })\n        };'''
code = must_replace(code, old_receive_return, new_receive_return, 'receiveGoods delta response')

# API registry/function map/activity log: additive only; existing contracts remain available.
code = must_replace(
    code,
    '  getTaxInvoicePageData    : "viewer",\n  getQuotationPageData     : "viewer",',
    '  getTaxInvoicePageData    : "viewer",\n  getTaxInvoiceListData    : "viewer",\n  getQuotationPageData     : "viewer",\n  getQuotationListData     : "viewer",',
    'API registry list-only endpoints'
)
code = must_replace(
    code,
    '  setPrimaryProductImage   : "staff",\n  generateProductBarcode   : "staff",',
    '  setPrimaryProductImage   : "staff",\n  commitProductImageDraft  : "staff",\n  generateProductBarcode   : "staff",',
    'API registry image draft'
)
code = must_replace(
    code,
    '  getTaxInvoicePageData     : getTaxInvoicePageData,\n  getQuotationPageData      : getQuotationPageData,',
    '  getTaxInvoicePageData     : getTaxInvoicePageData,\n  getTaxInvoiceListData     : getTaxInvoiceListData,\n  getQuotationPageData      : getQuotationPageData,\n  getQuotationListData      : getQuotationListData,',
    'API function map list-only endpoints'
)
code = must_replace(
    code,
    '  setPrimaryProductImage    : setPrimaryProductImage,\n  generateProductBarcode    : generateProductBarcode,',
    '  setPrimaryProductImage    : setPrimaryProductImage,\n  commitProductImageDraft   : commitProductImageDraft,\n  generateProductBarcode    : generateProductBarcode,',
    'API function map image draft'
)
code = must_replace(
    code,
    '  setPrimaryProductImage      : { action: "update", label: "ตั้งรูปสินค้าหลัก" },\n  generateProductBarcode      : { action: "update", label: "สร้างบาร์โค้ดสินค้า" },',
    '  setPrimaryProductImage      : { action: "update", label: "ตั้งรูปสินค้าหลัก" },\n  commitProductImageDraft     : { action: "update", label: "บันทึกรูปสินค้า" },\n  generateProductBarcode      : { action: "update", label: "สร้างบาร์โค้ดสินค้า" },',
    'activity image draft'
)
write('Code.gs', code)


# ---------------------------------------------------------------------------
# Shared.html — delta notifications while preserving legacy refresh events
# ---------------------------------------------------------------------------
shared = read('Shared.html')
shared_marker = "function notifyParentRefreshDropdowns(){\n  try{ window.parent.postMessage({action:'REFRESH_DROPDOWNS'},'*'); }catch(e){}\n}"
shared_delta = r'''function notifyParentProductDelta(product,deleted){
  try{ window.parent.postMessage({action:'PRODUCT_DELTA',product:product||null,deleted:!!deleted},'*'); }catch(e){}
}
function notifyParentMasterDelta(kind,item,deleted){
  try{ window.parent.postMessage({action:'MASTER_DELTA',kind:kind,item:item||null,deleted:!!deleted},'*'); }catch(e){}
}
'''
shared = must_replace(shared, shared_marker, shared_delta + shared_marker, 'Shared delta notifiers')
write('Shared.html', shared)


# ---------------------------------------------------------------------------
# index.html — apply product/master deltas in memory; keep legacy fallbacks
# ---------------------------------------------------------------------------
idx = read('index.html')
idx_msg_marker = "  window.addEventListener('message', function(e){\n    var d = e.data || {};\n    if(d.action==='REFRESH_DROPDOWNS'){ loadMasters(); }"
idx_helpers = r'''  function applyDashboardProductDelta(product,deleted){
    if(!product) return;
    var key=product.productCode||product.id;
    if(!key) return;
    var pos=DASH.products.findIndex(function(p){return (p.productCode||p.id)===key;});
    if(deleted){
      if(pos>-1) DASH.products.splice(pos,1);
    }else{
      product.id=product.id||key;product.productCode=product.productCode||key;
      if(pos>-1) DASH.products[pos]=product; else DASH.products.push(product);
    }
    allProducts=DASH.products;
    if(DASH.loaded){dashBuildAggregates();dashRenderAll();}
    dashUpdateSidebarBadges();
  }

  function shellMasterDeltaLabel(kind,item){
    if(!item)return '';
    if(kind==='brands')return item.Brand_Name||item.Name||item.id||'';
    if(kind==='categories')return item.Category_Name||item.Name||item.id||'';
    if(kind==='vendors'){
      var vn=item.Vendor_name||item.Name||item.id||'';
      return item.Phone?vn+' ('+item.Phone+')':vn;
    }
    if(kind==='zones'){
      var z=item.Area||item.Name||item.id||'';
      if(item.Build||item.Floor)z+=' — '+[item.Build,item.Floor].filter(Boolean).join(' ');
      if(item.Rack_no)z+=' (Rack '+item.Rack_no+')';
      return z;
    }
    if(kind==='cars'){
      var c=[item.Brand,item.Model].filter(Boolean).join(' ');
      if(item.Year)c+=' ('+item.Year+')';
      if(item.Type_Car)c+=' — '+item.Type_Car;
      return c||item.Name||item.id||'';
    }
    return item.Name||item.id||'';
  }

  function applyMasterDelta(kind,item,deleted){
    if(!kind||!item||!item.id)return;
    var list=masters[kind]||[],pos=list.findIndex(function(x){return x.id===item.id;});
    if(deleted){if(pos>-1)list.splice(pos,1);}
    else{
      var label=shellMasterDeltaLabel(kind,item),entry={id:item.id,Name:label,name:String(label).toLowerCase()};
      if(pos>-1)list[pos]=entry;else list.push(entry);
    }
    masters[kind]=list;
    var selectId={brands:'mBrandId',categories:'mCategoryId',vendors:'mVendorId',zones:'mZoneId'}[kind];
    if(selectId)fillSelect(selectId,list);
    var frame=document.getElementById('iframe-products');
    if(frame&&frame.contentWindow&&frame.src){
      try{frame.contentWindow.postMessage({action:'MASTER_DELTA',kind:kind,item:item,deleted:!!deleted},'*');}catch(e){}
    }
  }

  window.addEventListener('message', function(e){
    var d = e.data || {};
    if(d.action==='PRODUCT_DELTA'){ applyDashboardProductDelta(d.product,d.deleted); }
    else if(d.action==='MASTER_DELTA'){ applyMasterDelta(d.kind,d.item,d.deleted); }
    else if(d.action==='REFRESH_DROPDOWNS'){ loadMasters(); }'''
idx = must_replace(idx, idx_msg_marker, idx_helpers, 'index delta message handler')
write('index.html', idx)


# ---------------------------------------------------------------------------
# Quotation.html — full bootstrap once, then list-only reads
# ---------------------------------------------------------------------------
qt = read('Quotation.html')
qt = must_replace(qt, 'var availableYearsCache = [];', 'var availableYearsCache = [];\nvar quotationBootstrapped = false;', 'quotation bootstrap state')
old_qt_load = '''  callApi('getQuotationPageData', [yearParam || ''], function (data) {\n    if (btn) btnDone(btn);\n    data = data || {};\n    customers  = data.customers  || [];\n    products   = data.products   || [];\n    quotations = data.quotations || [];\n    sellerInfo = data.seller     || {};\n    marginMin  = data.marginMin  || 15;\n    statuses   = data.statuses   || [];\n    availableYearsCache = data.availableYears || [new Date().getFullYear() + 543];'''
new_qt_load = '''  var apiName = quotationBootstrapped ? 'getQuotationListData' : 'getQuotationPageData';\n  callApi(apiName, [yearParam || ''], function (data) {\n    if (btn) btnDone(btn);\n    data = data || {};\n    if (data.customers) customers = data.customers;\n    if (data.products) products = data.products;\n    quotations = data.quotations || [];\n    if (data.seller) sellerInfo = data.seller;\n    if (data.marginMin != null) marginMin = data.marginMin;\n    if (data.statuses) statuses = data.statuses;\n    availableYearsCache = data.availableYears || [new Date().getFullYear() + 543];\n    quotationBootstrapped = true;'''
qt = must_replace(qt, old_qt_load, new_qt_load, 'quotation list-only refresh')
write('Quotation.html', qt)


# ---------------------------------------------------------------------------
# Tax invoice — full bootstrap once; quick-add customer stays local
# ---------------------------------------------------------------------------
tax = read('Master_Tax_Invoice.html')
# Insert state next to availableYearsCache regardless surrounding variable declarations.
tax = must_replace(tax, 'var availableYearsCache = [];', 'var availableYearsCache = [];\nvar taxInvoiceBootstrapped = false;', 'tax bootstrap state')
old_tax_load = '''  callApi('getTaxInvoicePageData', [yearParam || ''], function(data) {\n      invoicesCache      = (data && data.invoices)       || [];\n      sellerInfo          = (data && data.seller)          || sellerInfo;\n      customersCache       = (data && data.customers)       || [];\n      productsCache       = (data && data.products)        || [];\n      availableYearsCache = (data && data.availableYears) || [new Date().getFullYear() + 543];'''
new_tax_load = '''  var apiName = taxInvoiceBootstrapped ? 'getTaxInvoiceListData' : 'getTaxInvoicePageData';\n  callApi(apiName, [yearParam || ''], function(data) {\n      invoicesCache = (data && data.invoices) || [];\n      if (data && data.seller) sellerInfo = data.seller;\n      if (data && data.customers) customersCache = data.customers;\n      if (data && data.products) productsCache = data.products;\n      availableYearsCache = (data && data.availableYears) || [new Date().getFullYear() + 543];\n      taxInvoiceBootstrapped = true;'''
tax = must_replace(tax, old_tax_load, new_tax_load, 'tax list-only refresh')

old_quick_customer = r'''      if (res.success) {
        // ★ ต้องโหลดรายชื่อลูกค้าใหม่จาก server เพราะเราไม่มีสำเนา backend ฝั่ง client
        //   แล้วค่อย auto-select ลูกค้าที่เพิ่งเพิ่ม + auto-fill ให้ทันที
        callApi('getCustomersFull', [], function(freshCustomers) {
            customersCache = freshCustomers || [];
            populateCustomerDropdown();
            document.getElementById('modalCustomerSelect').value = res.id;
            onCustomerSelect();
            closeQuickAddCustomer();
          }, function() { closeQuickAddCustomer(); });
      } else {'''
new_quick_customer = r'''      if (res.success) {
        var raw = res.data || {};
        var customer = {
          id:res.id,
          Customer_Name:raw.Customer_Name || payload.customerName || '',
          Customer_Type:raw.Customer_Type || 'ลูกค้าทั่วไป',
          Address_No:raw.Address_No || payload.addressNo || '', Address_Moo:raw.Address_Moo || payload.addressMoo || '',
          Address_Road:raw.Address_Road || payload.addressRoad || '', Subdistrict:raw.Subdistrict || payload.subdistrict || '',
          District:raw.District || payload.district || '', Province:raw.Province || payload.province || '',
          Postal_Code:raw.Postal_Code || payload.postalCode || '', Tax_ID:raw.Tax_ID || payload.taxId || '',
          Branch:raw.Branch || payload.branch || 'สำนักงานใหญ่', Phone:raw.Phone || payload.phone || '', Status:raw.Status || 'Active'
        };
        customer.Address=[customer.Address_No?'เลขที่ '+customer.Address_No:'',customer.Address_Moo?'หมู่ '+customer.Address_Moo:'',
          customer.Address_Road?'ถนน'+customer.Address_Road:'',customer.Subdistrict?'ตำบล/แขวง'+customer.Subdistrict:'',
          customer.District?'อำเภอ/เขต'+customer.District:'',customer.Province?'จังหวัด'+customer.Province:'',customer.Postal_Code||''].filter(Boolean).join(' ');
        customersCache.push(customer);
        populateCustomerDropdown();
        document.getElementById('modalCustomerSelect').value = res.id;
        if(window.SYYSelect)SYYSelect.refresh(document.getElementById('modalCustomerSelect'));
        onCustomerSelect();
        closeQuickAddCustomer();
      } else {'''
tax = must_replace(tax, old_quick_customer, new_quick_customer, 'tax quick customer local delta')
write('Master_Tax_Invoice.html', tax)


# ---------------------------------------------------------------------------
# StockIssue — patch only affected stock rows after atomic issueStock
# ---------------------------------------------------------------------------
stock = read('StockIssue.html')
stock = must_replace(
    stock,
    '''          renderBasket();\n          loadProducts();\n          movements = [];''',
    '''          renderBasket();\n          (res.results || []).forEach(function(r) {\n            var p = products.find(function(x) { return x.productCode === r.productCode; });\n            if (p) p.currentStock = num(r.after);\n          });\n          updateCounts();\n          renderResults();\n          movements = [];''',
    'StockIssue local stock delta'
)
write('StockIssue.html', stock)


# ---------------------------------------------------------------------------
# Purchase Orders — apply receive result locally; dashboard keeps existing delta
# ---------------------------------------------------------------------------
po = read('Purchase_Orders.html')
old_pending = '''        pendingProductCodes = {};\n        purchaseOrders.forEach(function(po) {\n          if (po.status === 'Pending' || po.status === 'Ordered') {\n            (po.items || []).forEach(function(it) { pendingProductCodes[it.productCode] = true; });\n          }\n        });'''
new_pending = '''        rebuildPendingProductCodes();'''
po = must_replace(po, old_pending, new_pending, 'PO pending helper use')
po_helper_marker = '  function updateStatCards() {'
po_helpers = r'''  function rebuildPendingProductCodes() {
    pendingProductCodes = {};
    purchaseOrders.forEach(function(po) {
      if (po.status !== 'Pending' && po.status !== 'Ordered' && po.status !== 'PartiallyReceived') return;
      (po.items || []).forEach(function(it) {
        if (num(it.qty) - num(it.receivedQty) > 0) pendingProductCodes[it.productCode] = true;
      });
    });
  }

  function applyReceiveGoodsDelta(res) {
    var p = res && res.po;
    if (p && p.poId) {
      var idx = purchaseOrders.findIndex(function(x) { return x.poId === p.poId; });
      if (idx > -1) {
        purchaseOrders[idx].status = p.status || purchaseOrders[idx].status;
        purchaseOrders[idx].items = p.items || purchaseOrders[idx].items;
        purchaseOrders[idx].receipts = p.receipts || purchaseOrders[idx].receipts;
      }
    }
    (res && res.productStocks || []).forEach(function(s) {
      var li = lowStockItems.findIndex(function(x) { return x.productCode === s.productCode; });
      if (li < 0) return;
      if (num(s.currentStock) > num(s.minStock)) {
        lowStockItems.splice(li, 1);
        delete qtyState[s.productCode];
        delete checkedState[s.productCode];
      } else {
        lowStockItems[li].currentStock = num(s.currentStock);
        lowStockItems[li].minStock = num(s.minStock);
        lowStockItems[li].costPrice = num(s.costPrice);
        lowStockItems[li].suggestedQty = Math.max(num(s.minStock) - num(s.currentStock), 1);
        qtyState[s.productCode] = lowStockItems[li].suggestedQty;
      }
    });
    rebuildPendingProductCodes();
    renderCreateTab();
    renderHistoryTab();
    updateStatCards();
  }

'''
po = must_replace(po, po_helper_marker, po_helpers + po_helper_marker, 'PO receive delta helpers')
po = must_replace(
    po,
    '''            setTimeout(function() {\n              closeReceiveModal();\n              loadAll();\n            }, 1000);''',
    '''            applyReceiveGoodsDelta(res);\n            try { window.parent.postMessage({ action:'REFRESH_STOCK_FULL' }, '*'); } catch (e) {}\n            setTimeout(function() { closeReceiveModal(); }, 700);''',
    'PO receive no full reload'
)
write('Purchase_Orders.html', po)


# ---------------------------------------------------------------------------
# Product page — local product/master delta + draft image UX/commit on Save
# ---------------------------------------------------------------------------
prod = read('Master_Products.html')
old_msg = r'''  window.addEventListener('message', function(e) {
    var d = e.data || {};
    if (d.action === 'OPEN_PRODUCT_ADD') openAddModal(d.barcode || '');
  });'''
new_msg = r'''  function masterDeltaLabel(kind,item){
    if(!item)return '';
    if(kind==='brands')return item.Brand_Name||item.Name||item.id||'';
    if(kind==='categories')return item.Category_Name||item.Name||item.id||'';
    if(kind==='vendors'){var vn=item.Vendor_name||item.Name||item.id||'';return item.Phone?vn+' ('+item.Phone+')':vn;}
    if(kind==='zones'){var z=item.Area||item.Name||item.id||'';if(item.Build||item.Floor)z+=' — '+[item.Build,item.Floor].filter(Boolean).join(' ');if(item.Rack_no)z+=' (Rack '+item.Rack_no+')';return z;}
    if(kind==='cars'){var c=[item.Brand,item.Model].filter(Boolean).join(' ');if(item.Year)c+=' ('+item.Year+')';if(item.Type_Car)c+=' — '+item.Type_Car;return c||item.Name||item.id||'';}
    return item.Name||item.id||'';
  }
  function applyMasterDeltaToProduct(d){
    var kind=d.kind,item=d.item||{},list=masterData[kind]||[],id=item.id;if(!id)return;
    var pos=list.findIndex(function(x){return x.id===id;});
    if(d.deleted){if(pos>-1)list.splice(pos,1);}else{var label=masterDeltaLabel(kind,item),entry={id:id,Name:label,name:String(label).toLowerCase()};if(pos>-1)list[pos]=entry;else list.push(entry);}
    masterData[kind]=list;
    if(kind==='brands')fillDropdown('inp_brandId',list,'-- เลือกแบรนด์ --');
    else if(kind==='categories')fillDropdown('inp_categoryId',list,'-- เลือกหมวดหมู่ --');
    else if(kind==='vendors')fillDropdown('inp_vendorId',list,'-- เลือกผู้จำหน่าย --');
    else if(kind==='zones')fillDropdown('inp_zoneId',list,'-- เลือกโซนจัดเก็บ --');
    else if(kind==='cars'){carOptionsCache=list.slice();renderCarDropdownList('');renderCarChips();}
    if(window.SYYSelect)SYYSelect.refresh(document);
  }
  function upsertProductLocal(item){
    if(!item)return;item.id=item.id||item.productCode;item.productCode=item.productCode||item.id;
    var key=item.id||item.productCode,pos=productsCache.findIndex(function(p){return (p.id||p.productCode)===key;});
    if(pos>-1)productsCache[pos]=item;else productsCache.push(item);filterAndRenderTable();
  }
  function removeProductLocal(id){productsCache=productsCache.filter(function(p){return (p.id||p.productCode)!==id;});filterAndRenderTable();}

  window.addEventListener('message', function(e) {
    var d = e.data || {};
    if (d.action === 'OPEN_PRODUCT_ADD') openAddModal(d.barcode || '');
    else if (d.action === 'MASTER_DELTA') applyMasterDeltaToProduct(d);
  });'''
prod = must_replace(prod, old_msg, new_msg, 'Product master/product delta helpers')

# Replace whole Product save function with image-aware local delta flow.
new_handle = r'''  function handleSubmit(e) {
    e.preventDefault();
    var btn=document.getElementById('modalBtnSave'),alertEl=document.getElementById('modalAlert');
    alertEl.style.display='none';
    var formData={
      docId:editingDocId||null,productName:document.getElementById('inp_productName').value.trim(),
      partType:document.getElementById('inp_partType').value,partNumber:document.getElementById('inp_partNumber').value.trim(),
      barcode:document.getElementById('inp_barcode').value.trim(),brandId:document.getElementById('inp_brandId').value,
      categoryId:document.getElementById('inp_categoryId').value,vendorId:document.getElementById('inp_vendorId').value,
      zoneId:document.getElementById('inp_zoneId').value,carIds:selectedCarIds,
      costPrice:parseFloat(document.getElementById('inp_costPrice').value||0),sellingPrice:parseFloat(document.getElementById('inp_sellingPrice').value||0),
      currentStock:parseFloat(document.getElementById('inp_currentStock').value||0),minStock:parseFloat(document.getElementById('inp_minStock').value||0),
      status:document.getElementById('inp_status').value
    };
    var wasNew=!editingDocId;
    btn.disabled=true;btn.innerText='⏳ กำลังบันทึก...';

    function finishSavedProduct(product,res){
      product=product||{};product.id=product.id||res.id;product.productCode=product.productCode||res.id;
      editingDocId=res.id;document.getElementById('modalDocId').value=res.id;
      upsertProductLocal(product);notifyParentProductDelta(product,false);
      btn.disabled=false;btn.innerText='💾 บันทึกการแก้ไข';
      alertEl.style.display='block';alertEl.className='modal-alert success';
      alertEl.innerText=''+res.message+' (ID: '+res.id+')';
      if(wasNew){
        document.getElementById('modalTitle').innerText='✏️ แก้ไขข้อมูลสินค้า ('+res.id+')';
        updateBarcodeGenButton();
        alertEl.innerText+=' — บันทึกแล้ว สามารถแก้ไข/สร้างบาร์โค้ดต่อได้';
      }else setTimeout(function(){closeProductModal();},900);
    }

    callApi('saveProduct',[formData],function(res){
      if(!res||!res.success){btn.disabled=false;btn.innerText=editingDocId?'💾 บันทึกการแก้ไข':'💾 บันทึก';alertEl.style.display='block';alertEl.className='modal-alert error';alertEl.innerText=''+((res&&res.message)||'บันทึกไม่สำเร็จ');return;}
      var product=res.product||{id:res.id,productCode:res.id};
      if(productImageDraftDirty){
        btn.innerText='⏳ กำลังบันทึกรูป...';
        callApi('commitProductImageDraft',[res.id,buildProductImageDraftPayload()],function(imgRes){
          if(imgRes&&imgRes.success){applyCommittedImageResult(product,imgRes);finishSavedProduct(product,res);}
          else{
            editingDocId=res.id;document.getElementById('modalDocId').value=res.id;upsertProductLocal(product);notifyParentProductDelta(product,false);
            btn.disabled=false;btn.innerText='💾 บันทึกการแก้ไข';alertEl.style.display='block';alertEl.className='modal-alert error';
            alertEl.innerText='ข้อมูลสินค้าบันทึกแล้ว แต่รูปยังไม่บันทึก: '+((imgRes&&imgRes.message)||'ไม่ทราบสาเหตุ')+' — draft รูปยังอยู่ กดบันทึกอีกครั้งเพื่อ retry';
          }
        },function(err){
          editingDocId=res.id;document.getElementById('modalDocId').value=res.id;upsertProductLocal(product);notifyParentProductDelta(product,false);
          btn.disabled=false;btn.innerText='💾 บันทึกการแก้ไข';alertEl.style.display='block';alertEl.className='modal-alert error';
          alertEl.innerText='ข้อมูลสินค้าบันทึกแล้ว แต่รูปยังไม่บันทึก: '+JSON.stringify(err)+' — draft รูปยังอยู่';
        });
      }else finishSavedProduct(product,res);
    },function(err){btn.disabled=false;btn.innerText=editingDocId?'💾 บันทึกการแก้ไข':'💾 บันทึก';alertEl.style.display='block';alertEl.className='modal-alert error';alertEl.innerText='Error: '+JSON.stringify(err);});
  }

'''
prod = must_regex(
    prod,
    r'  function handleSubmit\(e\) \{.*?\n  \}\n\n  // ==========================================\n  // รูปสินค้า — สูงสุด 3 รูป, แสดงเต็มภาพโดยไม่ crop\n  // ==========================================\n',
    new_handle + '  // ==========================================\n  // รูปสินค้า — สูงสุด 3 รูป, แสดงเต็มภาพโดยไม่ crop\n  // ==========================================\n',
    'replace Product save flow'
)

# Replace immediate image mutations with pure client draft operations.
image_front = r'''  var PROD_IMG_MAX_DIM=1600,PROD_IMG_QUALITY=0.82;
  var productImageUrls=[],productImageDraftBase64=[],productPrimaryImageIndex=0,pendingImageSlot=0,productImageDraftDirty=false;
  function getEditingProductLocal(){return productsCache.find(function(p){return (p.id||p.productCode)===editingDocId;})||null;}
  function updateImageSectionForEdit(docId,imageUrl,imageUrls,primaryIndex){
    productImageUrls=Array.isArray(imageUrls)&&imageUrls.length?imageUrls.slice(0,3):(imageUrl?[imageUrl]:[]);
    productImageDraftBase64=productImageUrls.map(function(){return null;});
    productPrimaryImageIndex=Math.max(0,Math.min(parseInt(primaryIndex,10)||0,Math.max(0,productImageUrls.length-1)));
    productImageDraftDirty=false;
    document.getElementById('imageHint').innerText='เพิ่มได้สูงสุด 3 รูป · การเพิ่ม/ลบ/เลื่อน/ตั้งรูปหลักจะบันทึกพร้อมปุ่ม “บันทึก” · กดยกเลิกจะไม่แก้ข้อมูลรูป';
    renderProductImageSlots(docId);
  }
  function renderProductImageSlots(docId){
    var box=document.getElementById('productImageSlots');if(!box)return;box.className='product-image-slots-ui';var count=productImageUrls.length;
    box.innerHTML=[0,1,2].map(function(i){
      var url=productImageUrls[i]||'',main=!!url&&i===productPrimaryImageIndex;
      if(!url)return '<div class="product-image-slot-ui"><div class="product-image-position-ui"><span>ตำแหน่ง '+(i+1)+'</span></div><button type="button" class="product-image-add-ui" onclick="pickProductImage('+i+')">+ เพิ่มรูป '+(i+1)+'</button></div>';
      var order='<div class="product-image-order-ui"><button type="button" class="btn btn-ghost" '+(i<=0?'disabled':'')+' onclick="moveProductImageNow('+i+','+(i-1)+')">← ซ้าย</button><button type="button" class="btn btn-ghost" '+(i>=count-1?'disabled':'')+' onclick="moveProductImageNow('+i+','+(i+1)+')">ขวา →</button></div>';
      return '<div class="product-image-slot-ui"><div class="product-image-position-ui"><span>ตำแหน่ง '+(i+1)+'</span>'+(main?'<span class="badge badge-ok">รูปหลัก</span>':'')+'</div><button type="button" class="product-image-preview-btn" title="คลิกเพื่อดูรูปขนาดใหญ่" onclick="openProductImageLightbox('+i+')"><img src="'+esc(url)+'" alt="รูปสินค้า '+(i+1)+'"><span class="product-image-zoom-hint">🔍 ขยาย</span></button><div class="product-image-actions-ui"><button type="button" class="btn btn-ghost" style="padding:4px 7px;min-height:28px" onclick="pickProductImage('+i+')">เปลี่ยน</button><button type="button" class="btn btn-ghost" style="padding:4px 7px;min-height:28px" onclick="deleteProductImageNow('+i+')">ลบ</button>'+(main?'':'<button type="button" class="btn btn-soft" style="padding:4px 7px;min-height:28px" onclick="setPrimaryProductImageNow('+i+')">ตั้งรูปหลัก</button>')+'</div>'+order+'</div>';
    }).join('');
  }
  function setImageUploadProgress(percent,text,visible){var wrap=document.getElementById('imgUploadProgress'),bar=document.getElementById('imgUploadProgressBar'),pct=document.getElementById('imgUploadProgressPercent'),label=document.getElementById('imgUploadProgressText');percent=Math.max(0,Math.min(100,parseInt(percent,10)||0));if(wrap)wrap.style.display=visible===false?'none':'block';if(bar)bar.style.width=percent+'%';if(pct)pct.textContent=percent+'%';if(label&&text)label.textContent=text;}
  function resetImageUploadProgress(){setImageUploadProgress(0,'กำลังเตรียมรูป...',false);}
  function pickProductImage(slot){if(window.SYYSelect)SYYSelect.closeActive();pendingImageSlot=slot;resetImageUploadProgress();var i=document.getElementById('inp_imageFile');i.value='';i.click();}
  function onProductImageSelected(input){
    var file=input.files&&input.files[0];if(!file)return;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){swyWarning('ไฟล์ไม่ถูกต้อง','รองรับ JPG, PNG และ WebP เท่านั้น');input.value='';return;}
    if(file.size>5*1024*1024){swyWarning('ไฟล์ใหญ่เกินไป','ไฟล์ต้นฉบับต้องไม่เกิน 5MB');input.value='';return;}
    setImageUploadProgress(10,'กำลังอ่านไฟล์...',true);var reader=new FileReader();
    reader.onload=function(e){setImageUploadProgress(25,'กำลังตรวจสอบรูป...',true);var img=new Image();img.onload=function(){
      var w=img.naturalWidth,h=img.naturalHeight;if(w<100||h<100){resetImageUploadProgress();swyWarning('รูปมีความละเอียดต่ำ','กรุณาใช้รูปอย่างน้อย 100×100 พิกเซล');return;}
      setImageUploadProgress(40,'กำลังปรับขนาดรูป...',true);if(w>PROD_IMG_MAX_DIM||h>PROD_IMG_MAX_DIM){if(w>=h){h=Math.round(h*PROD_IMG_MAX_DIM/w);w=PROD_IMG_MAX_DIM;}else{w=Math.round(w*PROD_IMG_MAX_DIM/h);h=PROD_IMG_MAX_DIM;}}
      var c=document.createElement('canvas');c.width=w;c.height=h;var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);var dataUrl=c.toDataURL('image/jpeg',PROD_IMG_QUALITY);stageProductImageNow(dataUrl.split(',')[1],dataUrl,pendingImageSlot);
    };img.onerror=function(){resetImageUploadProgress();swyError('เปิดรูปไม่สำเร็จ');};img.src=e.target.result;};reader.onerror=function(){resetImageUploadProgress();input.value='';swyError('อ่านไฟล์ไม่สำเร็จ');};reader.readAsDataURL(file);
  }
  function stageProductImageNow(base64,dataUrl,slot){
    var input=document.getElementById('inp_imageFile');slot=parseInt(slot,10)||0;if(productImageUrls.length>=3&&!productImageUrls[slot]){resetImageUploadProgress();swyWarning('เพิ่มรูปได้สูงสุด 3 รูป');return;}
    if(slot>productImageUrls.length)slot=productImageUrls.length;productImageUrls[slot]=dataUrl;productImageDraftBase64[slot]=base64;productImageDraftDirty=true;
    if(productPrimaryImageIndex>=productImageUrls.length)productPrimaryImageIndex=0;renderProductImageSlots(editingDocId);if(input)input.value='';setImageUploadProgress(100,'เตรียมรูปแล้ว — กดบันทึกเพื่อยืนยัน',true);setTimeout(resetImageUploadProgress,900);
  }
  function deleteProductImageNow(slot){
    if(!productImageUrls[slot])return;if(window.SYYSelect)SYYSelect.closeActive();
    swyConfirm({icon:'warning',title:'ลบรูปสินค้า?',html:'การลบจะมีผลเมื่อกดปุ่ม “บันทึก” เท่านั้น',confirmText:'ลบรูป',danger:true}).then(function(ok){if(!ok)return;
      productImageUrls.splice(slot,1);productImageDraftBase64.splice(slot,1);if(!productImageUrls.length)productPrimaryImageIndex=0;else if(productPrimaryImageIndex===slot)productPrimaryImageIndex=0;else if(productPrimaryImageIndex>slot)productPrimaryImageIndex--;productImageDraftDirty=true;renderProductImageSlots(editingDocId);
    });
  }
  function setPrimaryProductImageNow(slot){if(!productImageUrls[slot])return;productPrimaryImageIndex=slot;productImageDraftDirty=true;renderProductImageSlots(editingDocId);toast('เลือกรูปหลักแล้ว — กดบันทึกเพื่อยืนยัน');}
  function moveProductImageNow(fromSlot,toSlot){
    fromSlot=parseInt(fromSlot,10);toSlot=parseInt(toSlot,10);if(fromSlot===toSlot||fromSlot<0||toSlot<0||fromSlot>=productImageUrls.length||toSlot>=productImageUrls.length)return;
    var oldPrimary=productPrimaryImageIndex,url=productImageUrls.splice(fromSlot,1)[0],b64=productImageDraftBase64.splice(fromSlot,1)[0]||null;productImageUrls.splice(toSlot,0,url);productImageDraftBase64.splice(toSlot,0,b64);
    if(oldPrimary===fromSlot)productPrimaryImageIndex=toSlot;else if(fromSlot<oldPrimary&&toSlot>=oldPrimary)productPrimaryImageIndex=oldPrimary-1;else if(fromSlot>oldPrimary&&toSlot<=oldPrimary)productPrimaryImageIndex=oldPrimary+1;
    productImageDraftDirty=true;renderProductImageSlots(editingDocId);toast('ปรับตำแหน่งรูปแล้ว — กดบันทึกเพื่อยืนยัน');
  }
  function buildProductImageDraftPayload(){var items=[];productImageUrls.slice(0,3).forEach(function(url,i){var b=productImageDraftBase64[i];items.push(b?{base64:b}:{url:url});});return {items:items,primaryIndex:productPrimaryImageIndex};}
  function applyCommittedImageResult(product,res){
    productImageUrls=Array.isArray(res.imageUrls)?res.imageUrls.slice(0,3):[];productImageDraftBase64=productImageUrls.map(function(){return null;});productPrimaryImageIndex=Math.max(0,Math.min(parseInt(res.primaryIndex,10)||0,Math.max(0,productImageUrls.length-1)));productImageDraftDirty=false;
    if(product){product.imageUrls=productImageUrls.slice();product.primaryImageIndex=productPrimaryImageIndex;product.imageUrl=res.imageUrl||productImageUrls[productPrimaryImageIndex]||productImageUrls[0]||'';}renderProductImageSlots(editingDocId);
  }
'''
prod = must_regex(
    prod,
    r'  var PROD_IMG_MAX_DIM=1600,PROD_IMG_QUALITY=0\.82;.*?\n  var PRODUCT_VIEWER=',
    image_front + '  var PRODUCT_VIEWER=',
    'replace Product image immediate mutations'
)

old_product_delete = r'''  function execDeleteProduct() {
    if (!targetDeleteDocId) return;

    var btn = document.getElementById('btnConfirmDelete');
    btn.disabled = true;
    btn.innerText = '⏳ กำลังลบ...';

    callApi('deleteProduct', [targetDeleteDocId], function(res) {
        closeDeleteModal();
        if (res && res.success) {
          toast('ลบสินค้าเรียบร้อย');
          loadTable();
          notifyParentRefreshProducts();
        } else {
          swyError('ไม่สามารถลบข้อมูลได้', (res ? res.message : 'เกิดข้อผิดพลาด'));
        }
      }, function(err) {
        closeDeleteModal();
        swyError('ลบไม่สำเร็จ', esc(JSON.stringify(err)));
      });
  }'''
new_product_delete = r'''  function execDeleteProduct() {
    if (!targetDeleteDocId) return;
    var deletingId=targetDeleteDocId;
    var btn=document.getElementById('btnConfirmDelete');btn.disabled=true;btn.innerText='⏳ กำลังลบ...';
    callApi('deleteProduct',[deletingId],function(res){
      closeDeleteModal();
      if(res&&res.success){toast('ลบสินค้าเรียบร้อย');removeProductLocal(deletingId);notifyParentProductDelta({id:deletingId,productCode:deletingId},true);}
      else swyError('ไม่สามารถลบข้อมูลได้',(res?res.message:'เกิดข้อผิดพลาด'));
    },function(err){closeDeleteModal();swyError('ลบไม่สำเร็จ',esc(JSON.stringify(err)));});
  }'''
prod = must_replace(prod, old_product_delete, new_product_delete, 'Product delete local delta')
write('Master_Products.html', prod)


# ---------------------------------------------------------------------------
# Master pages — update their own in-memory row + send one delta to parent
# ---------------------------------------------------------------------------

def patch_simple_master(filename, kind, field_name):
    t=read(filename)
    old='''        loadTable();\n        notifyParentRefreshDropdowns();'''
    new=f'''        var raw=res.data||{{}},item={{id:res.id,Name:raw.{field_name}||name,{field_name}:raw.{field_name}||name}};\n        var pos=cache.findIndex(function(x){{return x.id===item.id;}});if(pos>-1)cache[pos]=item;else cache.push(item);\n        renderRows();\n        notifyParentMasterDelta('{kind}',item,false);'''
    t=must_replace(t,old,new,f'{filename} save local delta')
    old_del='''        loadTable();\n        notifyParentRefreshDropdowns();'''
    new_del=f'''        var removedId=deleteId;cache=cache.filter(function(x){{return x.id!==removedId;}});renderRows();\n        notifyParentMasterDelta('{kind}',{{id:removedId}},true);'''
    # after first replacement only the delete occurrence remains
    t=must_replace(t,old_del,new_del,f'{filename} delete local delta')
    write(filename,t)

patch_simple_master('Master_Brands.html','brands','Brand_Name')
patch_simple_master('Master_Categories.html','categories','Category_Name')

# Vendor
vendor=read('Master_Vendors.html')
vendor_save='''        loadTable();\n        notifyParentRefreshDropdowns();'''
vendor_new=r'''        var raw=res.data||{};
        var item={id:res.id,Vendor_name:raw.Vendor_name||vendorName,Contact_name:raw.Contact_name||payload.contact||'',Phone:raw.Phone||payload.phone||'',Email:raw.Email||payload.email||'',
          Address_No:raw.Address_No||payload.addressNo||'',Address_Moo:raw.Address_Moo||payload.addressMoo||'',Address_Road:raw.Address_Road||payload.addressRoad||'',Subdistrict:raw.Subdistrict||payload.subdistrict||'',District:raw.District||payload.district||'',Province:raw.Province||payload.province||'',Postal_Code:raw.Postal_Code||payload.postalCode||'',Tax_ID:raw.Tax_ID||taxIdVal,Branch:raw.Branch||payload.branch||'สำนักงานใหญ่',Status:raw.Status||payload.status||'Active'};
        item.Address=[item.Address_No?'เลขที่ '+item.Address_No:'',item.Address_Moo?'หมู่ '+item.Address_Moo:'',item.Address_Road?'ถนน'+item.Address_Road:'',item.Subdistrict?'ตำบล/แขวง'+item.Subdistrict:'',item.District?'อำเภอ/เขต'+item.District:'',item.Province?'จังหวัด'+item.Province:'',item.Postal_Code||''].filter(Boolean).join(' ');
        item._taxStatus=(item.Tax_ID&&item.Tax_ID.length===13)?'มีเลขผู้เสียภาษีแล้ว':'ยังไม่มีเลขผู้เสียภาษี';
        var pos=cache.findIndex(function(x){return x.id===item.id;});if(pos>-1)cache[pos]=item;else cache.push(item);renderRows();notifyParentMasterDelta('vendors',item,false);'''
vendor=must_replace(vendor,vendor_save,vendor_new,'Vendor save local delta')
vendor=must_replace(vendor,vendor_save,"        var removedId=deleteId;cache=cache.filter(function(x){return x.id!==removedId;});renderRows();\n        notifyParentMasterDelta('vendors',{id:removedId},true);",'Vendor delete local delta')
write('Master_Vendors.html',vendor)

# Zone
zone=read('Master_Zones.html')
zone_old='''        loadTable();\n        notifyParentRefreshDropdowns();'''
zone_new=r'''        var raw=res.data||{},item={id:res.id,Area:raw.Area||formData.area||'',Build:raw.Build||formData.build||'',Floor:raw.Floor||formData.floor||'',Rack_no:raw.Rack_no||formData.rackNo||'',Note:raw.Note||formData.note||'',Car_ID:raw.Car_ID||'',Status:raw.Status||'Active'};
        var pos=cache.findIndex(function(x){return x.id===item.id;});if(pos>-1)cache[pos]=item;else cache.push(item);renderRows();notifyParentMasterDelta('zones',item,false);'''
zone=must_replace(zone,zone_old,zone_new,'Zone save local delta')
zone=must_replace(zone,zone_old,"        var removedId=deleteId;cache=cache.filter(function(x){return x.id!==removedId;});renderRows();\n        notifyParentMasterDelta('zones',{id:removedId},true);",'Zone delete local delta')
write('Master_Zones.html',zone)

# Cars
cars=read('Master_Cars.html')
cars_old='''        loadTable();\n        notifyParentRefreshDropdowns();'''
cars_new=r'''        var raw=res.data||{},item={id:res.id,Brand:raw.Brand||formData.brand||'',Model:raw.Model||formData.model||'',Year:raw.Year||formData.year||'',Type_Car:raw.Type_Car||formData.typeCar||'',Model_Code:raw.Model_Code||'',Note:raw.Note||''};
        item._code=item.id;item._modelCode=item.Model_Code||'';item._brand=item.Brand||'';item._model=item.Model||'';item._year=item.Year||'';item._type=item.Type_Car||'';item._note=item.Note||'';
        var pos=cache.findIndex(function(x){return x._code===item._code;});if(pos>-1)cache[pos]=item;else cache.push(item);renderRows();notifyParentMasterDelta('cars',item,false);'''
cars=must_replace(cars,cars_old,cars_new,'Cars save local delta')
cars=must_replace(cars,cars_old,"        var removedId=deleteId;cache=cache.filter(function(x){return x._code!==removedId;});renderRows();\n        notifyParentMasterDelta('cars',{id:removedId},true);",'Cars delete local delta')
write('Master_Cars.html',cars)

# Customer (no parent master refresh needed, but avoid its own full collection reread)
cust=read('Master_Customers.html')
cust_save='''        loadTable();\n        // ★ ลูกค้าไม่ใช่ dropdown ของฟอร์มไหนใน index.html และไม่กระทบสต๊อก — ไม่ต้องแจ้ง parent เลย\n        //   (เดิมเรียก notifyParentRefresh() ซึ่งทำให้ index.html รีโหลด dashboard เต็มโดยไม่จำเป็น)'''
cust_new=r'''        var raw=res.data||{},item={id:res.id,Customer_Name:raw.Customer_Name||customerName,Customer_Type:raw.Customer_Type||customerType,Phone:raw.Phone||payload.phone||'',Address_No:raw.Address_No||payload.addressNo||'',Address_Moo:raw.Address_Moo||payload.addressMoo||'',Address_Road:raw.Address_Road||payload.addressRoad||'',Subdistrict:raw.Subdistrict||payload.subdistrict||'',District:raw.District||payload.district||'',Province:raw.Province||payload.province||'',Postal_Code:raw.Postal_Code||payload.postalCode||'',Tax_ID:raw.Tax_ID||taxIdVal,Branch:raw.Branch||payload.branch||'สำนักงานใหญ่',Status:raw.Status||payload.status||'Active'};
        item.Address=[item.Address_No?'เลขที่ '+item.Address_No:'',item.Address_Moo?'หมู่ '+item.Address_Moo:'',item.Address_Road?'ถนน'+item.Address_Road:'',item.Subdistrict?'ตำบล/แขวง'+item.Subdistrict:'',item.District?'อำเภอ/เขต'+item.District:'',item.Province?'จังหวัด'+item.Province:'',item.Postal_Code||''].filter(Boolean).join(' ');item._taxStatus=(item.Tax_ID&&item.Tax_ID.length===13)?'มีเลขผู้เสียภาษี':'ไม่มีเลขผู้เสียภาษี';
        var pos=cache.findIndex(function(x){return x.id===item.id;});if(pos>-1)cache[pos]=item;else cache.push(item);renderRows();'''
cust=must_replace(cust,cust_save,cust_new,'Customer save local delta')
cust_del='''        loadTable();\n        // ★ ลูกค้าไม่ใช่ dropdown ของฟอร์มไหนใน index.html และไม่กระทบสต๊อก — ไม่ต้องแจ้ง parent เลย'''
cust=must_replace(cust,cust_del,"        var removedId=deleteId;cache=cache.filter(function(x){return x.id!==removedId;});renderRows();",'Customer delete local delta')
write('Master_Customers.html',cust)


# ---------------------------------------------------------------------------
# Audit note
# ---------------------------------------------------------------------------
audit=read('docs/CODE_AUDIT_TH.md')
audit_add=r'''

## Phase A — Post-write Read/Write Efficiency

- Product Save ไม่ reload `getAllProducts()` ทั้งใน iframe และ parent อีกต่อไป: backend คืนสินค้าที่บันทึกแล้วหนึ่งรายการ แล้ว Product table/Dashboard patch cache เฉพาะ record นั้น.
- Product Gallery ใช้ draft ฝั่ง browser สำหรับ Add/Delete/Move/Primary; ไม่มี Firestore/Drive mutation ระหว่างจัดรูป และ commit metadata ครั้งเดียวตอนกดบันทึกสินค้า. กดยกเลิกก่อนบันทึกไม่แก้ข้อมูลรูป.
- Quotation และ Tax Invoice ใช้ full bootstrap เฉพาะครั้งแรก; การเปลี่ยนปีและ refresh หลัง write ใช้ list-only endpoint จึงไม่โหลด Customer/Product master ซ้ำ.
- Quotation Save อ่านลูกค้าด้วย document ID ตรงรายการ แทนการ hydrate ลูกค้าทั้ง collection.
- Quick Add Customer ใน Tax Invoice ใช้ response ของ `saveCustomer` อัปเดต local cache ไม่เรียก `getCustomersFull()` ซ้ำ.
- Stock Issue ใช้ `issueStock().results` patch stock ในหน้าเดิม และยังใช้ Dashboard delta เดิม; ไม่ reload Product collection หลังตัดสต๊อก.
- Receive Goods คืน PO/product-stock delta จาก transaction ที่มีข้อมูลอยู่แล้ว และหน้า PO patch เฉพาะรายการที่เปลี่ยน พร้อมส่ง Dashboard delta trigger; ไม่ `loadAll()` หลังรับสินค้า.
- Brand/Category/Vendor/Zone/Car/Customer patch local table หลัง save/delete; master ที่มีผลต่อ dropdown ส่ง `MASTER_DELTA` ไป parent/Product iframe แทน reload master collections ทั้งชุด.
- Phase นี้ไม่เพิ่ม/rename/delete collection หรือ field, ไม่มี migration/backfill และไม่คำนวณ stock ย้อนหลัง. Endpoint เดิมยังคงไว้เพื่อ backward compatibility.
- การตรวจใน CI เป็น static/source verification; การพิสูจน์ Firestore quota/runtime regression ยังต้องทำ Apps Script deployment verification + UAT/telemetry บน environment จริง.
'''
if '## Phase A — Post-write Read/Write Efficiency' in audit:
    raise RuntimeError('Audit Phase A section already exists')
audit += audit_add
write('docs/CODE_AUDIT_TH.md',audit)


# ---------------------------------------------------------------------------
# Phase A invariants — fail workflow before any source commit if a patch drifts
# ---------------------------------------------------------------------------
checks = {
    'Code.gs': ['function commitProductImageDraft(', 'function getQuotationListData(', 'function getTaxInvoiceListData(', 'getCustomerById_(d.customerId)', 'productStocks:stockAdditions.map'],
    'Shared.html': ['notifyParentProductDelta', 'notifyParentMasterDelta'],
    'index.html': ["d.action==='PRODUCT_DELTA'", "d.action==='MASTER_DELTA'"],
    'Master_Products.html': ['productImageDraftDirty', "callApi('commitProductImageDraft'", 'notifyParentProductDelta'],
    'Quotation.html': ['quotationBootstrapped', "'getQuotationListData'"],
    'Master_Tax_Invoice.html': ['taxInvoiceBootstrapped', "'getTaxInvoiceListData'"],
    'Purchase_Orders.html': ['function applyReceiveGoodsDelta(', "action:'REFRESH_STOCK_FULL'"],
}
for fn, needles in checks.items():
    text=read(fn)
    for needle in needles:
        if needle not in text:
            raise RuntimeError(f'{fn}: missing invariant {needle!r}')

if "loadProducts();\n          movements = [];" in read('StockIssue.html'):
    raise RuntimeError('StockIssue still reloads the full product list after issueStock')
if "callApi('getCustomersFull', [], function(freshCustomers)" in read('Master_Tax_Invoice.html'):
    raise RuntimeError('Tax Invoice Quick Add still reloads all customers')
if "callApi('moveProductImage'" in read('Master_Products.html'):
    raise RuntimeError('Product image move still performs an immediate backend write')

print('Phase A patch applied and invariants passed')
