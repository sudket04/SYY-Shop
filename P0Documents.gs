// P0 document endpoints: keep business document-number logic, eliminate internal document-ID full scans.
function p0SaveTaxInvoice(token, userAgent, d) {
  var auth = p0Session_(token, userAgent, 'viewer');
  if (!auth.ok) return { success:false, message:auth.message };
  d = p0Clone_(d || {});
  if (!d.docId) {
    var rid = p0ReserveNextMasterId_('Master_Tax_Invoice','TX');
    if (!rid.ok) return { success:false, title:'ล้มเหลว', message:rid.message };
    d.docId = rid.id;
  }
  var res = saveTaxInvoice(d);
  if (res && res.success) {
    var doc = p0GetDocument_('Master_Tax_Invoice', res.id || d.docId);
    if (doc) res.record = mapTaxInvoiceQueryDoc_(doc);
    res.p0Optimized = true;
  }
  return res;
}

function p0SaveQuotation(token, userAgent, d) {
  var auth = p0Session_(token, userAgent, 'viewer');
  if (!auth.ok) return { success:false, message:auth.message };
  d = p0Clone_(d || {});
  if (!d.docId) {
    var rid = p0ReserveNextMasterId_(QUOTATION_COLLECTION,QUOTATION_PREFIX);
    if (!rid.ok) return { success:false, title:'ล้มเหลว', message:rid.message };
    d.docId = rid.id;
  }
  var res = saveQuotation(d, auth.session.username);
  if (res && res.success) {
    var doc = p0GetDocument_(QUOTATION_COLLECTION, res.id || d.docId);
    if (doc) res.record = mapQuotationDoc_({id:doc.name.split('/').pop(),fields:doc.fields||{}});
    res.p0Optimized = true;
  }
  return res;
}

function p0GetDocument_(collectionName, docId) {
  if (!docId) return null;
  try {
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + collectionName + '/' + encodeURIComponent(docId);
    var res = UrlFetchApp.fetch(url,{method:'get',headers:getAuthHeader(),muteHttpExceptions:true});
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    console.error('p0GetDocument_ error:',e);
    return null;
  }
}
