/*
 * SYY Shop Control — Dashboard bootstrap V2
 * Keeps the existing dashboard response contract while preventing lifetime scans.
 * The UI currently exposes current year + 4 previous years, so query exactly that horizon.
 */
var DASHBOARD_V2_YEARS_BACK = 4;

function dashboardRangeStartV2_() {
  var now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - DASHBOARD_V2_YEARS_BACK, 0, 1, 0, 0, 0)).toISOString();
}

function fetchDashboardStockMovementsV2_() {
  var out = [];
  var fromIso = dashboardRangeStartV2_();
  try {
    var query = {
      structuredQuery: {
        from: [{ collectionId: STOCK_MOVEMENT_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "Timestamp" },
            op: "GREATER_THAN_OR_EQUAL",
            value: { stringValue: fromIso }
          }
        },
        orderBy: [{ field: { fieldPath: "Timestamp" }, direction: "DESCENDING" }]
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      headers: getAuthHeader(),
      payload: JSON.stringify(query),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      console.error("fetchDashboardStockMovementsV2_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
      return out;
    }
    (JSON.parse(res.getContentText()) || []).forEach(function (row) {
      if (!row.document) return;
      var f = row.document.fields || {};
      var ts = parseFirestoreValue(f.Timestamp);
      if (!ts) return;
      out.push({
        docNo       : parseFirestoreValue(f.Doc_No)       || "",
        type        : parseFirestoreValue(f.Type)         || "OUT",
        productCode : parseFirestoreValue(f.Product_Code) || "",
        productName : parseFirestoreValue(f.Product_Name) || "",
        qty         : parseFloat(parseFirestoreValue(f.Qty))         || 0,
        stockAfter  : parseFloat(parseFirestoreValue(f.Stock_After)) || 0,
        unitPrice   : parseFloat(parseFirestoreValue(f.Unit_Price))  || 0,
        costPrice   : parseFloat(parseFirestoreValue(f.Cost_Price))  || 0,
        reason      : parseFirestoreValue(f.Reason) || "",
        refNo       : parseFirestoreValue(f.Ref_No) || "",
        note        : parseFirestoreValue(f.Note)   || "",
        user        : parseFirestoreValue(f.User)   || "",
        timestamp   : ts
      });
    });
  } catch (e) {
    console.error("fetchDashboardStockMovementsV2_ error:", e);
  }
  return out;
}

function getDashboardBootstrapV2_() {
  var poVendorMap = {};
  try {
    getPurchaseOrders().forEach(function (po) { poVendorMap[po.poId] = po.vendorName; });
  } catch (e) {
    console.error("getDashboardBootstrapV2_: โหลดผู้จัดจำหน่ายของ PO ไม่สำเร็จ:", e);
  }
  return {
    products: getAllProducts(),
    movements: fetchDashboardStockMovementsV2_(),
    poVendorMap: poVendorMap,
    bounded: true,
    rangeStart: dashboardRangeStartV2_()
  };
}

function apiDashboardBootstrap(token, userAgent) {
  try {
    var session = getSession_(token, userAgent);
    if (!session) {
      return { __authError: true, success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };
    }
    return getDashboardBootstrapV2_();
  } catch (e) {
    console.error("apiDashboardBootstrap error:", e);
    return { success: false, message: (typeof friendlyErrorMessage_ === "function" ? friendlyErrorMessage_(e) : e.message) };
  }
}
