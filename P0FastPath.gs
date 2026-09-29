// ============================================================
// SYY Shop P0 Fast Path
// Critical write helpers that return a single affected product without
// re-reading the whole Product_Images collection.
// Public UI traffic continues through p0GatewayV2 only.
// ============================================================

function p0FastProduct_(productCode) {
  try { return getProductById(String(productCode || '').trim()); }
  catch (e) { console.error('p0FastProduct_:', e); return null; }
}

function p0FiniteNonNegative_(value, fieldLabel) {
  var n = Number(value == null || value === '' ? 0 : value);
  if (!isFinite(n) || n < 0) throw new Error((fieldLabel || 'ตัวเลข') + ' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return n;
}

function p0SaveProductFast_(d) {
  d=d||{};
  var docId=d.productCode||d.docId||null;
  var existing=docId?p0GetDoc_('Master_Products',docId):null;
  if(docId&&!existing)return p0Fail_('ไม่พบสินค้าที่ต้องการแก้ไข','ไม่พบข้อมูล');

  var name=String(d.productName||'').trim();
  if(!name)return p0Fail_('กรุณากรอกชื่อสินค้า','ข้อมูลไม่ครบ');
  var pn=String(d.partNumber||'').trim(), bc=String(d.barcode||'').trim();
  if(pn&&p0QueryEqual_('Master_Products','Part_Number',pn,10).some(function(x){return x.id!==docId;}))return p0Fail_('รหัสจากผู้ผลิต (Part Number) "'+pn+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');
  if(bc&&p0QueryEqual_('Master_Products','Barcode',bc,10).some(function(x){return x.id!==docId;}))return p0Fail_('บาร์โค้ด "'+bc+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');

  var costPrice,sellingPrice,minStock,openingStock;
  try {
    costPrice=p0FiniteNonNegative_(d.costPrice,'ราคาทุน');
    sellingPrice=p0FiniteNonNegative_(d.sellingPrice,'ราคาขาย');
    minStock=p0FiniteNonNegative_(d.minStock,'Minimum Stock');
    openingStock=p0FiniteNonNegative_(d.currentStock,'สต๊อกเริ่มต้น');
  } catch(e) { return p0Fail_(e.message,'ข้อมูลไม่ถูกต้อง'); }

  var carIds=Array.isArray(d.carIds)?d.carIds.filter(Boolean):[];
  var oldFields=existing?existing.fields:{};
  var oldBarcode=String(parseFirestoreValue(oldFields.Barcode)||'').trim();
  var oldGenerated=parseFirestoreValue(oldFields.Barcode_Generated)==='true';
  var obj={
    Product_Name:name,
    Part_Type:String(d.partType||'').trim()||'PENDING',
    Part_Number:pn,
    Barcode:bc,
    Brand_ID:String(d.brandId||''),
    Category_ID:String(d.categoryId||''),
    Default_Vendor_ID:String(d.vendorId||''),
    Zone_ID:String(d.zoneId||'').trim()||'PENDING',
    Car_IDs:carIds,
    Cost_Price:costPrice,
    Selling_Price:sellingPrice,
    Min_Stock:minStock,
    Status:String(d.status||'Active'),
    Barcode_Generated:(oldGenerated&&oldBarcode&&oldBarcode===bc)?'true':'false'
  };

  // CRITICAL: never include Current_Stock in an edit PATCH. A sale/receipt can update
  // stock after this form was opened; writing the stale value here would roll back that
  // transaction. Only a newly-created product receives the opening value from this form.
  if(!existing)obj.Current_Stock=openingStock;

  var r=p0SaveMasterData_('Master_Products','P',docId,obj,null);
  if(r.success){
    p0InvalidateProductDataOnly_(false);
    r.product=p0FastProduct_(r.id);
    r.stockProtected=!!existing;
  }
  return r;
}

function p0AdjustProductStockFast_(d,callerUsername){
  d=d||{};var code=String(d.productCode||'').trim(),target=parseFloat(d.newStock),reason=String(d.reason||'').trim(),note=String(d.note||'').trim();
  if(!code)return p0Fail_('ไม่พบรหัสสินค้า');
  if(!isFinite(target)||target<0)return p0Fail_('ยอดสต๊อกใหม่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  if(reason.length<3)return p0Fail_('กรุณาระบุเหตุผลในการปรับยอดสต๊อก');
  for(var attempt=1;attempt<=3;attempt++){
    var stockMap=getProductStockMap_([code]),info=stockMap[code];if(!info)return p0Fail_('ไม่พบสินค้า '+code);
    var delta=target-info.stock;
    if(delta===0)return {success:true,message:'ยอดสต๊อกไม่เปลี่ยนแปลง',productCode:code,before:info.stock,after:target,delta:0,product:p0FastProduct_(code)};
    var nowIso=new Date().toISOString(),docNo='ADJ'+Utilities.formatDate(new Date(),'Asia/Bangkok','yyMMdd-HHmmss')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,4).toUpperCase();
    var writes=[
      {update:{name:fsDocPath_('Master_Products',code),fields:{Current_Stock:{doubleValue:target}}},updateMask:{fieldPaths:['Current_Stock']},currentDocument:{updateTime:info.updateTime}},
      {update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,docNo+'-01'),fields:{Doc_No:{stringValue:docNo},Type:{stringValue:delta>0?'IN':'OUT'},Product_Code:{stringValue:code},Product_Name:{stringValue:info.name},Qty:{doubleValue:Math.abs(delta)},Stock_Before:{doubleValue:info.stock},Stock_After:{doubleValue:target},Cost_Price:{doubleValue:info.costPrice||0},Reason:{stringValue:'ปรับยอดสต๊อก: '+reason},Ref_No:{stringValue:'STOCK-ADJUST'},Note:{stringValue:note},User:{stringValue:callerUsername||getCurrentUsername_()},Timestamp:{stringValue:nowIso}}},currentDocument:{exists:false}}
    ];
    var commit=fsCommit_(writes);
    if(commit.ok){p0InvalidateStockData_();return {success:true,message:'ปรับยอดสต๊อกเรียบร้อย',productCode:code,before:info.stock,after:target,delta:delta,docNo:docNo,product:p0FastProduct_(code)};}
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('ปรับยอดไม่สำเร็จ: '+commit.message);
    Utilities.sleep(100*attempt);
  }
  return p0Fail_('ปรับยอดไม่สำเร็จ กรุณาลองใหม่');
}
