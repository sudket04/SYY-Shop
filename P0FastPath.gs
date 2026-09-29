// ============================================================
// SYY Shop P0 Fast Path
// Critical write endpoints that return a single affected product without
// re-reading the whole Product_Images collection.
// ============================================================

function p0FastProduct_(productCode) {
  try { return getProductById(String(productCode || '').trim()); }
  catch (e) { console.error('p0FastProduct_:', e); return null; }
}

function p0SaveProductFast_(d) {
  d=d||{};
  var docId=d.productCode||d.docId||null, existing=docId?p0GetDoc_('Master_Products',docId):null;
  var name=String(d.productName||'').trim();
  if(!name)return p0Fail_('กรุณากรอกชื่อสินค้า','ข้อมูลไม่ครบ');
  var pn=String(d.partNumber||'').trim(), bc=String(d.barcode||'').trim();
  if(pn&&p0QueryEqual_('Master_Products','Part_Number',pn,10).some(function(x){return x.id!==docId;}))return p0Fail_('รหัสจากผู้ผลิต (Part Number) "'+pn+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');
  if(bc&&p0QueryEqual_('Master_Products','Barcode',bc,10).some(function(x){return x.id!==docId;}))return p0Fail_('บาร์โค้ด "'+bc+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');

  var carIds=Array.isArray(d.carIds)?d.carIds.filter(Boolean):[];
  var oldFields=existing?existing.fields:{}, oldBarcode=String(parseFirestoreValue(oldFields.Barcode)||'').trim();
  var oldGenerated=parseFirestoreValue(oldFields.Barcode_Generated)==='true';
  // Existing stock is immutable in Product Master. Stock changes must go through transaction endpoints.
  var currentStock=existing?parseFloat(parseFirestoreValue(oldFields.Current_Stock)||0):Math.max(0,parseFloat(d.currentStock||0));
  var obj={
    Product_Name:name,Part_Type:String(d.partType||'').trim()||'PENDING',Part_Number:pn,Barcode:bc,
    Brand_ID:String(d.brandId||''),Category_ID:String(d.categoryId||''),Default_Vendor_ID:String(d.vendorId||''),Zone_ID:String(d.zoneId||'').trim()||'PENDING',
    Car_IDs:carIds,Cost_Price:parseFloat(d.costPrice||0),Selling_Price:parseFloat(d.sellingPrice||0),Current_Stock:currentStock,
    Min_Stock:parseFloat(d.minStock||0),Status:String(d.status||'Active'),Barcode_Generated:(oldGenerated&&oldBarcode&&oldBarcode===bc)?'true':'false'
  };
  var r=p0SaveMasterData_('Master_Products','P',docId,obj,null);
  if(r.success){p0InvalidateProducts_();r.product=p0FastProduct_(r.id);r.stockProtected=!!existing;}
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
    if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return {success:true,message:'ปรับยอดสต๊อกเรียบร้อย',productCode:code,before:info.stock,after:target,delta:delta,docNo:docNo,product:p0FastProduct_(code)};}
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('ปรับยอดไม่สำเร็จ: '+commit.message);
    Utilities.sleep(100*attempt);
  }
  return p0Fail_('ปรับยอดไม่สำเร็จ กรุณาลองใหม่');
}

function p0GatewayFast(token, fnName, args, userAgent) {
  try {
    var session=getSession_(token,userAgent);
    if(!session)return {__authError:true,success:false,message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'};
    var a=Array.isArray(args)?args:[],result;
    if(fnName==='saveProduct'){
      if(!p0RoleAllowed_(session.role,'staff'))return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result=p0SaveProductFast_(a[0]||{});
      if(ACTIVITY_ACTIONS&&ACTIVITY_ACTIONS.saveProduct)logActivity_(session.username,'saveProduct',a,result);
      return result;
    }
    if(fnName==='adjustProductStock'){
      if(!p0RoleAllowed_(session.role,'staff'))return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result=p0AdjustProductStockFast_(a[0]||{},session.username);
      p0AuditWrite_(session.username,'adjustProductStock','ปรับยอดสต๊อก',(a[0]||{}).productCode,!!(result&&result.success));
      return result;
    }
    return p0GatewayV2(token,fnName,a,userAgent);
  }catch(e){console.error('p0GatewayFast ['+fnName+']:',e);return p0Fail_(friendlyErrorMessage_(e),'ข้อผิดพลาด');}
}
