// Shared Firestore reads. Authorization and stock transactions stay in Code.gs.
function queryByEqualityField_(collectionName, fieldPath, value, limit, operator) {
  var docs = [];
  try {
    var query = {
      structuredQuery: {
        from  : [{ collectionId: collectionName }],
        where : { fieldFilter: { field: { fieldPath: fieldPath }, op: operator||"EQUAL", value: { stringValue: String(value) } } },
        limit : limit||10
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader_(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลไม่สำเร็จ (" + res.getResponseCode() + ")");
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) docs.push({ id: row.document.name.split('/').pop(), fields: row.document.fields || {},updateTime:row.document.updateTime||"" });
      });
    } else {
      console.error("queryByEqualityField_ " + collectionName + "." + fieldPath + " HTTP " + res.getResponseCode());
    }
  } catch (e) { console.error("queryByEqualityField_ read failed", e); throw e; }
  return docs;
}

function fetchAllPagesRaw_(collectionName, firstPageJson) {
  var docs = [], pageToken = "", guard = 0, json = firstPageJson || null;
  try {
    do {
      if (!json) {
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                + "/databases/(default)/documents/" + collectionName + "?pageSize=1000"
                + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) {
          console.error("fetchAllPagesRaw " + collectionName + " HTTP " + res.getResponseCode());
          return { ok: false, docs: [] };
        }
        json = JSON.parse(res.getContentText());
      }
      (json.documents || []).forEach(function(doc) {
        docs.push({ id: doc.name.split('/').pop(), fields: doc.fields || {}, updateTime:doc.updateTime || "" });
      });
      pageToken = json.nextPageToken || "";
      json = null;
      guard++;
    } while (pageToken && guard < 50);
  } catch (e) {
    console.error("fetchAllPagesRaw error:", e);
    return { ok: false, docs: [] };
  }
  return { ok: !pageToken, docs: pageToken ? [] : docs };
}

// Reads for edits fail closed: never recreate a deleted record or allocate a new document number.
function readExistingDocument_(collection, docId) {
  if(!validDocumentId_(String(docId || ""))) throw new Error("รหัสเอกสารไม่ถูกต้อง");
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
    + "/databases/(default)/documents/" + collection + "/" + encodeURIComponent(docId);
  var res = UrlFetchApp.fetch(url, { method:"get", headers:getAuthHeader_(), muteHttpExceptions:true });
  if (res.getResponseCode() !== 200) { var error = new Error("อ่านข้อมูลเดิมไม่สำเร็จ กรุณารีเฟรชก่อนแก้ไขอีกครั้ง"); error.httpStatus = res.getResponseCode(); throw error; }
  var doc = JSON.parse(res.getContentText());
  if (!doc.updateTime) throw new Error("ตรวจสอบเวอร์ชันข้อมูลเดิมไม่สำเร็จ กรุณาลองใหม่");
  return doc;
}
