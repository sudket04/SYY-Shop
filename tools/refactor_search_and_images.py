from pathlib import Path
import re


def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Patch anchor not found: {label}")
    return text.replace(old, new, 1)


# Shared searchable dropdown: native select remains source of truth.
p = Path("Shared.html")
s = p.read_text(encoding="utf-8")
anchor = "function closeModal(id){\n  var el=document.getElementById(id);\n  if(el) el.classList.remove('active');\n}\n"
shared = r'''

/* ── SYY Searchable Select ────────────────────────────────────────────────
   Progressive enhancement for native <select>. Existing .value and change
   handlers remain intact. Filtering is client-side and adds no Firestore read. */
var SYYSelect=(function(){
  var registry=new WeakMap();
  function norm(v){return String(v==null?'':v).toLocaleLowerCase('th-TH').normalize('NFKC').trim();}
  function enhance(sel){
    if(!sel||registry.has(sel)||sel.multiple||sel.dataset.syyNoSearch==='true')return;
    var wrap=document.createElement('div');wrap.className='syy-select';
    var control=document.createElement('button');control.type='button';control.className='syy-select-control';
    var label=document.createElement('span');label.className='syy-select-label';
    var caret=document.createElement('span');caret.className='syy-select-caret';caret.textContent='⌄';
    control.appendChild(label);control.appendChild(caret);
    var panel=document.createElement('div');panel.className='syy-select-panel';
    var search=document.createElement('input');search.type='search';search.className='syy-select-search';search.placeholder='ค้นหา...';search.autocomplete='off';
    var list=document.createElement('div');list.className='syy-select-list';panel.appendChild(search);panel.appendChild(list);
    sel.parentNode.insertBefore(wrap,sel);wrap.appendChild(sel);wrap.appendChild(control);wrap.appendChild(panel);sel.classList.add('syy-select-native');
    function sync(){var o=sel.options[sel.selectedIndex];label.textContent=o?o.text:'เลือก...';control.disabled=sel.disabled;}
    function render(q){
      var nq=norm(q),frag=document.createDocumentFragment(),shown=0;
      Array.from(sel.options).forEach(function(o,i){
        if(o.disabled&&!o.value)return;
        if(nq&&norm(o.text).indexOf(nq)<0&&norm(o.value).indexOf(nq)<0)return;
        var b=document.createElement('button');b.type='button';b.className='syy-select-option'+(o.selected?' selected':'');b.textContent=o.text;b.dataset.index=i;
        b.onclick=function(){sel.selectedIndex=i;sel.dispatchEvent(new Event('change',{bubbles:true}));sync();close();};frag.appendChild(b);shown++;
      });
      list.innerHTML='';if(!shown){var e=document.createElement('div');e.className='syy-select-empty';e.textContent='ไม่พบข้อมูล';list.appendChild(e);}else list.appendChild(frag);
    }
    function open(){if(control.disabled)return;document.querySelectorAll('.syy-select.open').forEach(function(x){if(x!==wrap)x.classList.remove('open');});wrap.classList.add('open');search.value='';render('');setTimeout(function(){search.focus();},0);}
    function close(){wrap.classList.remove('open');}
    control.onclick=function(){wrap.classList.contains('open')?close():open();};search.oninput=function(){render(search.value);};
    function keynav(e){var opts=Array.from(list.querySelectorAll('.syy-select-option')),idx=opts.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();(opts[Math.min(idx+1,opts.length-1)]||opts[0])?.focus();}if(e.key==='ArrowUp'){e.preventDefault();(opts[Math.max(idx-1,0)]||opts[opts.length-1])?.focus();}if(e.key==='Escape'){e.preventDefault();close();control.focus();}}
    search.onkeydown=keynav;list.onkeydown=keynav;document.addEventListener('click',function(e){if(!wrap.contains(e.target))close();});
    new MutationObserver(function(){sync();if(wrap.classList.contains('open'))render(search.value);}).observe(sel,{childList:true,subtree:true,attributes:true});
    sel.addEventListener('change',sync);registry.set(sel,{sync:sync});sync();
  }
  function init(root){(root||document).querySelectorAll('select').forEach(enhance);}
  function refresh(root){init(root);(root||document).querySelectorAll('select').forEach(function(s){var x=registry.get(s);if(x)x.sync();});}
  return {init:init,refresh:refresh,enhance:enhance};
})();
document.addEventListener('DOMContentLoaded',function(){SYYSelect.init(document);new MutationObserver(function(m){if(m.some(function(x){return x.addedNodes&&x.addedNodes.length;}))SYYSelect.init(document);}).observe(document.documentElement,{childList:true,subtree:true});});
'''
s = must_replace(s, anchor, anchor + shared, "Shared closeModal")
p.write_text(s, encoding="utf-8")

# Shared CSS.
p = Path("Styles.html")
s = p.read_text(encoding="utf-8")
anchor = ".select{cursor:pointer;width:auto}\n"
css = r'''

/* ── Searchable select: dependency-free progressive enhancement ── */
.syy-select{position:relative;width:100%;min-width:0}
.syy-select-native{position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important}
.syy-select-control{width:100%;min-height:var(--hit);border:1px solid #cbd5e1;border-radius:var(--r-sm);background:#fff;color:var(--ink);padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;font:inherit}
.syy-select-control:focus,.syy-select.open .syy-select-control{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(0,80,136,.12)}
.syy-select-control:disabled{background:var(--line-soft);color:var(--muted);cursor:not-allowed}
.syy-select-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.syy-select-caret{color:var(--faint);flex:none}
.syy-select-panel{display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:2500;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:var(--shadow-lg);overflow:hidden;min-width:220px}
.syy-select.open .syy-select-panel{display:block}.syy-select-search{width:calc(100% - 16px);margin:8px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;outline:none;font:inherit}.syy-select-search:focus{border-color:var(--primary);box-shadow:0 0 0 2px rgba(0,80,136,.10)}
.syy-select-list{max-height:260px;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--line-soft)}
.syy-select-option{display:block;width:100%;border:0;background:#fff;text-align:left;padding:8px 11px;color:var(--text);cursor:pointer;font:inherit}.syy-select-option:hover,.syy-select-option:focus{outline:none;background:var(--primary-soft);color:var(--primary)}.syy-select-option.selected{font-weight:600;background:#f8fbfe}.syy-select-empty{padding:13px;text-align:center;color:var(--faint);font-size:12px}
.product-image-frame{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center}.product-image-frame img,.product-image-contain{width:100%;height:100%;object-fit:contain!important;object-position:center;background:#fff}.product-image-clickable{cursor:zoom-in}
'''
s = must_replace(s, anchor, anchor + css, "Styles select")
p.write_text(s, encoding="utf-8")

# Backend product image metadata: max 3 images, keep legacy primary fields.
p = Path("Code.gs")
s = p.read_text(encoding="utf-8")
old = '''function saveProductImageDoc_(productCode, imageUrl, driveFileId) {\n  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID\n          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);\n  UrlFetchApp.fetch(url, {\n    method             : "patch",\n    headers            : getAuthHeader(),\n    payload            : JSON.stringify({ fields: mapToFirestoreFields({ Image_Url: imageUrl, Drive_File_Id: driveFileId }) }),\n    muteHttpExceptions : true\n  });\n  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);\n}\n'''
new = '''function saveProductImageDoc_(productCode, imageUrl, driveFileId, imageUrls, driveFileIds, primaryIndex) {\n  imageUrls = Array.isArray(imageUrls) ? imageUrls.slice(0, 3) : (imageUrl ? [imageUrl] : []);\n  driveFileIds = Array.isArray(driveFileIds) ? driveFileIds.slice(0, 3) : (driveFileId ? [driveFileId] : []);\n  primaryIndex = Math.max(0, Math.min(parseInt(primaryIndex, 10) || 0, Math.max(0, imageUrls.length - 1)));\n  imageUrl = imageUrls[primaryIndex] || imageUrls[0] || "";\n  driveFileId = driveFileIds[primaryIndex] || driveFileIds[0] || "";\n  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID\n          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);\n  UrlFetchApp.fetch(url, {method:"patch",headers:getAuthHeader(),payload:JSON.stringify({fields:mapToFirestoreFields({Image_Url:imageUrl,Drive_File_Id:driveFileId,Image_Urls:imageUrls,Drive_File_Ids:driveFileIds,Primary_Index:primaryIndex})}),muteHttpExceptions:true});\n  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);\n}\n'''
s = must_replace(s, old, new, "saveProductImageDoc")
old = '''function getProductImageUrlMap_() {\n  var map = {};\n  try {\n    var docs = fetchCollectionDocsCached(PRODUCT_IMAGES_COLLECTION);\n    docs.forEach(function (doc) {\n      var url = parseFirestoreValue((doc.fields || {}).Image_Url);\n      if (url) map[doc.id] = url;\n    });\n  } catch (e) {\n    console.error("getProductImageUrlMap_ error:", e);\n  }\n  return map;\n}\n'''
new = '''function getProductImageUrlMap_() {\n  var map = {};\n  try {\n    var docs = fetchCollectionDocsCached(PRODUCT_IMAGES_COLLECTION);\n    docs.forEach(function (doc) {\n      var f=doc.fields||{}, urls=parseFirestoreValue(f.Image_Urls);\n      if(!Array.isArray(urls)||!urls.length){var legacy=parseFirestoreValue(f.Image_Url);urls=legacy?[legacy]:[];}\n      var pi=parseInt(parseFirestoreValue(f.Primary_Index),10)||0;pi=Math.max(0,Math.min(pi,Math.max(0,urls.length-1)));\n      if(urls.length)map[doc.id]={primary:urls[pi]||urls[0],urls:urls.slice(0,3),primaryIndex:pi};\n    });\n  } catch(e){console.error("getProductImageUrlMap_ error:",e);}\n  return map;\n}\n'''
s = must_replace(s, old, new, "image map")
m = re.search(r"function uploadProductImage\(productCode, base64Data\) \{.*?\n\}\n\nfunction deleteProductImage\(productCode\) \{.*?\n\}\n", s, re.S)
if not m:
    raise SystemExit("Patch anchor not found: upload/delete")
new_funcs = r'''function getProductImageDocData_(productCode) {
  try {
    var url="https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents/"+PRODUCT_IMAGES_COLLECTION+"/"+encodeURIComponent(productCode);
    var res=UrlFetchApp.fetch(url,{method:"get",headers:getAuthHeader(),muteHttpExceptions:true});if(res.getResponseCode()!==200)return {urls:[],ids:[],primaryIndex:0};
    var f=(JSON.parse(res.getContentText()).fields||{}),urls=parseFirestoreValue(f.Image_Urls),ids=parseFirestoreValue(f.Drive_File_Ids);
    if(!Array.isArray(urls)||!urls.length){var u=parseFirestoreValue(f.Image_Url);urls=u?[u]:[];}if(!Array.isArray(ids)||!ids.length){var i=parseFirestoreValue(f.Drive_File_Id);ids=i?[i]:[];}
    return {urls:urls.slice(0,3),ids:ids.slice(0,3),primaryIndex:parseInt(parseFirestoreValue(f.Primary_Index),10)||0};
  }catch(e){return {urls:[],ids:[],primaryIndex:0};}
}
function uploadProductImage(productCode,base64Data,slot){
  try {
    productCode=String(productCode||"").trim();slot=Math.max(0,Math.min(parseInt(slot,10)||0,2));if(!productCode)return {success:false,message:"ไม่พบรหัสสินค้า"};if(!base64Data)return {success:false,message:"ไม่พบข้อมูลรูปภาพ"};
    var bytes=Utilities.base64Decode(base64Data);if(bytes.length>5*1024*1024)return {success:false,message:"ไฟล์รูปใหญ่เกินไป"};if(!(bytes.length>3&&(bytes[0]&255)===255&&(bytes[1]&255)===216&&(bytes[2]&255)===255))return {success:false,message:"รูปหลังประมวลผลไม่ใช่ JPEG ที่ถูกต้อง"};
    var cur=getProductImageDocData_(productCode),folder=getProductImageFolder_();if(cur.ids[slot]){try{DriveApp.getFileById(cur.ids[slot]).setTrashed(true);}catch(e){}}
    var file=folder.createFile(Utilities.newBlob(bytes,"image/jpeg",productCode+"_"+(slot+1)+".jpg"));file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);var imageUrl="https://lh3.googleusercontent.com/d/"+file.getId();cur.urls[slot]=imageUrl;cur.ids[slot]=file.getId();
    while(cur.urls.length&&!cur.urls[cur.urls.length-1])cur.urls.pop();while(cur.ids.length&&!cur.ids[cur.ids.length-1])cur.ids.pop();if(cur.primaryIndex>=cur.urls.length)cur.primaryIndex=0;saveProductImageDoc_(productCode,"","",cur.urls,cur.ids,cur.primaryIndex);return {success:true,imageUrl:imageUrl,imageUrls:cur.urls,primaryIndex:cur.primaryIndex,slot:slot};
  }catch(e){return {success:false,message:e.message};}
}
function deleteProductImage(productCode,slot){
  try {productCode=String(productCode||"").trim();if(!productCode)return {success:false,message:"ไม่พบรหัสสินค้า"};var cur=getProductImageDocData_(productCode);if(slot===undefined||slot===null||slot===''){cur.ids.forEach(function(id){try{DriveApp.getFileById(id).setTrashed(true);}catch(e){}});deleteProductImageDoc_(productCode);return {success:true,imageUrls:[]};}slot=Math.max(0,Math.min(parseInt(slot,10)||0,2));if(cur.ids[slot]){try{DriveApp.getFileById(cur.ids[slot]).setTrashed(true);}catch(e){}}cur.urls.splice(slot,1);cur.ids.splice(slot,1);if(!cur.urls.length){deleteProductImageDoc_(productCode);return {success:true,imageUrls:[]};}if(cur.primaryIndex===slot)cur.primaryIndex=0;else if(cur.primaryIndex>slot)cur.primaryIndex--;saveProductImageDoc_(productCode,"","",cur.urls,cur.ids,cur.primaryIndex);return {success:true,imageUrls:cur.urls,primaryIndex:cur.primaryIndex};}catch(e){return {success:false,message:e.message};}
}
function setPrimaryProductImage(productCode,slot){
  try{var cur=getProductImageDocData_(String(productCode||"").trim());slot=Math.max(0,Math.min(parseInt(slot,10)||0,2));if(!cur.urls[slot])return {success:false,message:"ไม่พบรูป"};cur.primaryIndex=slot;saveProductImageDoc_(productCode,"","",cur.urls,cur.ids,slot);return {success:true,imageUrl:cur.urls[slot],imageUrls:cur.urls,primaryIndex:slot};}catch(e){return {success:false,message:e.message};}
}
'''
s = s[:m.start()] + new_funcs + s[m.end():]
s = must_replace(s, '  deleteProductImage       : "staff",\n', '  deleteProductImage       : "staff",\n  setPrimaryProductImage   : "staff",\n', "permission registry")
s = must_replace(s, '  deleteProductImage        : deleteProductImage,\n', '  deleteProductImage        : deleteProductImage,\n  setPrimaryProductImage    : setPrimaryProductImage,\n', "function registry")
s = must_replace(s, '  deleteProductImage          : { action: "delete", label: "ลบรูปสินค้า" },\n', '  deleteProductImage          : { action: "delete", label: "ลบรูปสินค้า" },\n  setPrimaryProductImage      : { action: "update", label: "ตั้งรูปสินค้าหลัก" },\n', "activity registry")
s = s.replace('imageUrl     : imageUrlMap[doc.id] || "",', 'imageUrl     : (imageUrlMap[doc.id] && (imageUrlMap[doc.id].primary || imageUrlMap[doc.id])) || "",\n          imageUrls    : (imageUrlMap[doc.id] && imageUrlMap[doc.id].urls) || [],\n          primaryImageIndex: (imageUrlMap[doc.id] && imageUrlMap[doc.id].primaryIndex) || 0,')
p.write_text(s, encoding="utf-8")

# Master Product: replace image form and image handlers.
p = Path("Master_Products.html")
s = p.read_text(encoding="utf-8")
m = re.search(r'          <div class="section-label">รูปสินค้า</div>.*?(?=\n          <div class="section-label">สถานะ)', s, re.S)
if not m:
    m = re.search(r'          <div class="section-label">รูปสินค้า</div>.*?(?=\n        </div>\n        <div class="modal-footer">)', s, re.S)
if not m:
    raise SystemExit("Patch anchor not found: product image section")
section = '''          <div class="section-label">รูปสินค้า (สูงสุด 3 รูป)</div>\n          <div class="form-group full">\n            <div id="productImageSlots" style="display:grid;grid-template-columns:repeat(3,minmax(90px,1fr));gap:10px"></div>\n            <input type="file" id="inp_imageFile" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="onProductImageSelected(this)">\n            <div id="imgUploadProgress" style="display:none;margin-top:8px"><div class="img-upload-progress-track"><div class="img-upload-progress-bar"></div></div><div style="font-size:11px;color:var(--faint);margin-top:4px">กำลังประมวลผลและอัปโหลดรูป...</div></div>\n            <div class="field-hint" id="imageHint">บันทึกสินค้าก่อน จึงจะอัปโหลดรูปได้ · JPG/PNG/WebP · ต้นฉบับไม่เกิน 5MB</div>\n          </div>'''
s = s[:m.start()] + section + s[m.end():]
s = s.replace('object-fit:cover;border-radius:6px;border:1px solid var(--line)', 'object-fit:contain;background:#fff;border-radius:6px;border:1px solid var(--line)')
m = re.search(r'  // ==========================================\n  // รูปสินค้า.*?(?=  // ==========================================\n  // สร้างบาร์โค้ด)', s, re.S)
if not m:
    raise SystemExit("Patch anchor not found: product image JS")
image_js = r'''  // ==========================================
  // รูปสินค้า — สูงสุด 3 รูป, แสดงเต็มภาพโดยไม่ crop
  // ==========================================
  var PROD_IMG_MAX_DIM=1600,PROD_IMG_QUALITY=0.82;
  var productImageUrls=[],productPrimaryImageIndex=0,pendingImageSlot=0;
  function updateImageSectionForEdit(docId,imageUrl,imageUrls,primaryIndex){productImageUrls=Array.isArray(imageUrls)&&imageUrls.length?imageUrls.slice(0,3):(imageUrl?[imageUrl]:[]);productPrimaryImageIndex=Math.max(0,Math.min(parseInt(primaryIndex,10)||0,Math.max(0,productImageUrls.length-1)));document.getElementById('imageHint').innerText=docId?'เพิ่มได้สูงสุด 3 รูป · คลิกรูปเพื่อขยาย · รูปหลักใช้ในตารางและหน้าค้นหา':'บันทึกสินค้าก่อน จึงจะอัปโหลดรูปได้';renderProductImageSlots(docId);}
  function renderProductImageSlots(docId){var box=document.getElementById('productImageSlots');if(!box)return;box.innerHTML=[0,1,2].map(function(i){var url=productImageUrls[i]||'',main=url&&i===productPrimaryImageIndex;return '<div style="border:1px solid var(--line);border-radius:10px;padding:7px;background:#fff"><div class="product-image-frame" style="height:120px">'+(url?'<img class="product-image-clickable" src="'+esc(url)+'" onclick="openProductImageLightbox('+i+')">':'<button type="button" class="btn btn-ghost" style="width:100%;height:100%;border:0" '+(!docId?'disabled':'')+' onclick="pickProductImage('+i+')">+ รูป '+(i+1)+'</button>')+'</div>'+(url?'<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px"><button type="button" class="btn btn-ghost" style="padding:4px 7px;min-height:28px" onclick="pickProductImage('+i+')">เปลี่ยน</button><button type="button" class="btn btn-ghost" style="padding:4px 7px;min-height:28px" onclick="deleteProductImageNow('+i+')">ลบ</button>'+(main?'<span class="badge badge-ok">รูปหลัก</span>':'<button type="button" class="btn btn-soft" style="padding:4px 7px;min-height:28px" onclick="setPrimaryProductImageNow('+i+')">ตั้งรูปหลัก</button>')+'</div>':'')+'</div>';}).join('');}
  function pickProductImage(slot){if(!editingDocId){swyWarning('บันทึกสินค้าก่อน');return;}pendingImageSlot=slot;var i=document.getElementById('inp_imageFile');i.value='';i.click();}
  function onProductImageSelected(input){var file=input.files&&input.files[0];if(!file)return;if(!editingDocId){swyWarning('บันทึกสินค้าก่อน');input.value='';return;}if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){swyWarning('ไฟล์ไม่ถูกต้อง','รองรับ JPG, PNG และ WebP เท่านั้น');input.value='';return;}if(file.size>5*1024*1024){swyWarning('ไฟล์ใหญ่เกินไป','ไฟล์ต้นฉบับต้องไม่เกิน 5MB');input.value='';return;}var reader=new FileReader();reader.onload=function(e){var img=new Image();img.onload=function(){var w=img.naturalWidth,h=img.naturalHeight;if(w<100||h<100){swyWarning('รูปมีความละเอียดต่ำ','กรุณาใช้รูปอย่างน้อย 100×100 พิกเซล');return;}if(w>PROD_IMG_MAX_DIM||h>PROD_IMG_MAX_DIM){if(w>=h){h=Math.round(h*PROD_IMG_MAX_DIM/w);w=PROD_IMG_MAX_DIM;}else{w=Math.round(w*PROD_IMG_MAX_DIM/h);h=PROD_IMG_MAX_DIM;}}var c=document.createElement('canvas');c.width=w;c.height=h;var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);uploadProductImageNow(c.toDataURL('image/jpeg',PROD_IMG_QUALITY).split(',')[1],pendingImageSlot);};img.onerror=function(){swyError('เปิดรูปไม่สำเร็จ');};img.src=e.target.result;};reader.readAsDataURL(file);}
  function uploadProductImageNow(base64,slot){var progress=document.getElementById('imgUploadProgress');progress.style.display='block';callApi('uploadProductImage',[editingDocId,base64,slot],function(res){progress.style.display='none';if(res&&res.success){productImageUrls=res.imageUrls||productImageUrls;productPrimaryImageIndex=res.primaryIndex||0;syncProductImageCache(res.imageUrl);renderProductImageSlots(editingDocId);toast('อัปโหลดรูปสำเร็จ');filterAndRenderTable();}else swyError('อัปโหลดไม่สำเร็จ',(res&&res.message)||'');},function(err){progress.style.display='none';swyError('เกิดข้อผิดพลาด',esc(JSON.stringify(err)));});}
  function syncProductImageCache(primary){var c=productsCache.find(function(p){return p.id===editingDocId;});if(c){c.imageUrls=productImageUrls.slice();c.primaryImageIndex=productPrimaryImageIndex;c.imageUrl=primary||productImageUrls[productPrimaryImageIndex]||productImageUrls[0]||'';}}
  function deleteProductImageNow(slot){if(!editingDocId)return;swyConfirm({icon:'warning',title:'ลบรูปสินค้า?',confirmText:'ลบรูป',danger:true}).then(function(ok){if(!ok)return;callApi('deleteProductImage',[editingDocId,slot],function(res){if(res&&res.success){productImageUrls=res.imageUrls||[];productPrimaryImageIndex=res.primaryIndex||0;syncProductImageCache();renderProductImageSlots(editingDocId);filterAndRenderTable();toast('ลบรูปเรียบร้อย');}else swyError('ลบไม่สำเร็จ',(res&&res.message)||'');});});}
  function setPrimaryProductImageNow(slot){if(!editingDocId)return;callApi('setPrimaryProductImage',[editingDocId,slot],function(res){if(res&&res.success){productPrimaryImageIndex=res.primaryIndex||0;productImageUrls=res.imageUrls||productImageUrls;syncProductImageCache(res.imageUrl);renderProductImageSlots(editingDocId);filterAndRenderTable();toast('ตั้งรูปหลักแล้ว');}else swyError('ตั้งรูปหลักไม่สำเร็จ',(res&&res.message)||'');});}
  function openProductImageLightbox(index){if(!productImageUrls[index])return;var html='<div style="display:flex;align-items:center;justify-content:center;min-height:50vh"><img src="'+esc(productImageUrls[index])+'" style="max-width:90vw;max-height:72vh;object-fit:contain"></div><div style="margin-top:8px">รูป '+(index+1)+' / '+productImageUrls.length+'</div>';Swal.fire({html:html,width:'min(960px,96vw)',showConfirmButton:false,showCloseButton:true,allowOutsideClick:true,allowEscapeKey:true});}

'''
s = s[:m.start()] + image_js + s[m.end():]
s = s.replace("updateImageSectionForEdit(null, '');", "updateImageSectionForEdit(null, '', [], 0);")
s = s.replace("updateImageSectionForEdit(res.id, '');", "updateImageSectionForEdit(res.id, '', [], 0);")
s = re.sub(r"updateImageSectionForEdit\(editingDocId,\s*item\.imageUrl\s*\|\|\s*''\s*\);", "updateImageSectionForEdit(editingDocId,item.imageUrl||'',item.imageUrls||[],item.primaryImageIndex||0);", s)
p.write_text(s, encoding="utf-8")

# Make product images contain rather than crop in related transaction pages.
for name in ["StockIssue.html", "Quotation.html", "Purchase_Orders.html", "Master_Tax_Invoice.html"]:
    p = Path(name)
    if p.exists():
        x = p.read_text(encoding="utf-8").replace("object-fit:cover", "object-fit:contain").replace("object-fit: cover", "object-fit: contain")
        p.write_text(x, encoding="utf-8")

# Audit note.
p = Path("docs/CODE_AUDIT_TH.md")
if p.exists():
    x = p.read_text(encoding="utf-8")
    x += "\n\n## Phase 3 — Searchable Dropdown และ Product Gallery\n\n- native select ทุกหน้าถูก progressive-enhance เป็น searchable select จาก `Shared.html`; ค่าเดิมและ change handler เดิมยังเป็น source of truth\n- การค้นหา dropdown ทำฝั่ง client จึงไม่เพิ่ม Firestore read ต่อ keystroke\n- Product Images รองรับสูงสุด 3 รูป พร้อม Primary Image และ backward compatibility ผ่าน `Image_Url`/`Drive_File_Id`\n- รูปสินค้าใช้ `object-fit: contain` เพื่อแสดงภาพครบโดยไม่ crop และ Master Product คลิกรูปเพื่อเปิดภาพใหญ่ได้\n- client resize เป็น JPEG สูงสุด 1600px และ server ตรวจ JPEG signature/ขนาดก่อนบันทึก\n"
    p.write_text(x, encoding="utf-8")

print("Refactor completed")
