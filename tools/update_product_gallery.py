from pathlib import Path

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')

# Gallery/edit CSS
if '.view-product-gallery{' not in s:
    marker='@media(max-width:640px){.product-image-slots-ui{grid-template-columns:1fr}.product-image-preview-btn,.product-image-add-ui{height:180px}}'
    if marker not in s:
        raise SystemExit('image CSS marker not found')
    css='''
.product-image-slot-ui,.product-image-preview-btn,.product-image-add-ui{box-sizing:border-box;max-width:100%}
.product-image-slot-ui{overflow:hidden}
.product-image-preview-btn img{display:block;max-width:100%;max-height:100%}
.product-image-position-ui{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;font-size:11px;color:var(--muted)}
.product-image-order-ui{display:flex;gap:5px;margin-top:6px}
.product-image-order-ui .btn{flex:1;padding:4px 7px;min-height:28px}
.view-product-gallery{width:220px;max-width:100%;flex-shrink:0}
.view-product-gallery-stage{position:relative;width:220px;max-width:100%;height:220px;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.view-product-gallery-main{width:100%;height:100%;border:0;padding:8px;background:#fff;display:flex;align-items:center;justify-content:center;cursor:zoom-in}
.view-product-gallery-main img{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center}
.view-product-gallery-nav{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:38px;border:0;border-radius:9px;background:rgba(15,23,42,.70);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2}
.view-product-gallery-nav:hover{background:rgba(0,80,136,.92)}
.view-product-gallery-nav.prev{left:7px}.view-product-gallery-nav.next{right:7px}
.view-product-gallery-count{position:absolute;right:7px;bottom:7px;background:rgba(15,23,42,.72);color:#fff;border-radius:12px;padding:2px 7px;font-size:10.5px;pointer-events:none}
.view-product-gallery-thumbs{display:flex;gap:6px;margin-top:7px;min-height:50px;overflow-x:auto;padding:1px}
.view-product-gallery-thumb{width:50px;height:50px;flex:0 0 50px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:3px;cursor:pointer;overflow:hidden}
.view-product-gallery-thumb img{display:block;width:100%;height:100%;object-fit:contain}
.view-product-gallery-thumb.active{border:2px solid var(--primary);padding:2px;box-shadow:0 0 0 2px rgba(0,80,136,.10)}
'''
    s=s.replace(marker,css+'@media(max-width:640px){.product-image-slots-ui{grid-template-columns:1fr}.product-image-preview-btn,.product-image-add-ui{height:180px}.view-product-gallery,.view-product-gallery-stage{width:100%}.view-product-gallery-stage{height:min(62vw,280px)}}',1)

# Detail modal single image -> gallery
old='''          <div id="viewImgBox" style="width:140px;height:140px;border:1px solid var(--line);border-radius:12px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--bg);box-shadow:0 1px 3px rgba(0,0,0,.08)">
            <span style="font-size:36px;color:var(--faint)">📦</span>
          </div>'''
new='''          <div class="view-product-gallery">
            <div id="viewImgBox" class="view-product-gallery-stage"><span style="font-size:36px;color:var(--faint)">📦</span></div>
            <div id="viewImgThumbs" class="view-product-gallery-thumbs"></div>
          </div>'''
if old in s:
    s=s.replace(old,new,1)
elif 'class="view-product-gallery"' not in s:
    raise SystemExit('view gallery markup marker not found')

# Edit image slots: instant preview + primary + left/right order
start=s.find('  function renderProductImageSlots(docId){')
end=s.find('  function pickProductImage(slot)',start)
if start<0 or end<0:
    raise SystemExit('edit image renderer not found')
repl='''  function renderProductImageSlots(docId){
    var box=document.getElementById('productImageSlots');if(!box)return;
    box.className='product-image-slots-ui';
    var count=productImageUrls.length;
    box.innerHTML=[0,1,2].map(function(i){
      var url=productImageUrls[i]||'',main=!!url&&i===productPrimaryImageIndex;
      if(!url)return '<div class="product-image-slot-ui"><div class="product-image-position-ui"><span>ตำแหน่ง '+(i+1)+'</span></div><button type="button" class="product-image-add-ui" '+(!docId?'disabled':'')+' onclick="pickProductImage('+i+')">+ เพิ่มรูป '+(i+1)+'</button></div>';
      var order='<div class="product-image-order-ui"><button type="button" class="btn btn-ghost" '+(i<=0?'disabled':'')+' onclick="moveProductImageNow('+i+','+(i-1)+')">← ซ้าย</button><button type="button" class="btn btn-ghost" '+(i>=count-1?'disabled':'')+' onclick="moveProductImageNow('+i+','+(i+1)+')">ขวา →</button></div>';
      return '<div class="product-image-slot-ui"><div class="product-image-position-ui"><span>ตำแหน่ง '+(i+1)+'</span>'+(main?'<span class="badge badge-ok">รูปหลัก</span>':'')+'</div><button type="button" class="product-image-preview-btn" title="คลิกเพื่อดูรูปขนาดใหญ่" onclick="openProductImageLightbox('+i+')"><img src="'+esc(url)+'" alt="รูปสินค้า '+(i+1)+'"><span class="product-image-zoom-hint">🔍 ขยาย</span></button><div class="product-image-actions-ui"><button type="button" class="btn btn-ghost" style="padding:4px 7px;min-height:28px" onclick="pickProductImage('+i+')">เปลี่ยน</button><button type="button" class="btn btn-ghost" style="padding:4px 7px;min-height:28px" onclick="deleteProductImageNow('+i+')">ลบ</button>'+(main?'':'<button type="button" class="btn btn-soft" style="padding:4px 7px;min-height:28px" onclick="setPrimaryProductImageNow('+i+')">ตั้งรูปหลัก</button>')+'</div>'+order+'</div>';
    }).join('');
  }
'''
s=s[:start]+repl+s[end:]

if 'function moveProductImageNow(fromSlot,toSlot)' not in s:
    marker='  function showProductImageLightbox(urls,index,title){'
    pos=s.find(marker)
    if pos<0:
        raise SystemExit('lightbox marker not found')
    fn='''  function moveProductImageNow(fromSlot,toSlot){
    if(!editingDocId)return;
    fromSlot=parseInt(fromSlot,10);toSlot=parseInt(toSlot,10);
    if(fromSlot===toSlot||fromSlot<0||toSlot<0||fromSlot>=productImageUrls.length||toSlot>=productImageUrls.length)return;
    callApi('moveProductImage',[editingDocId,fromSlot,toSlot],function(res){
      if(res&&res.success){
        productImageUrls=Array.isArray(res.imageUrls)?res.imageUrls.slice(0,3):productImageUrls;
        productPrimaryImageIndex=Math.max(0,Math.min(parseInt(res.primaryIndex,10)||0,Math.max(0,productImageUrls.length-1)));
        syncProductImageCache(res.imageUrl);renderProductImageSlots(editingDocId);filterAndRenderTable();toast('ปรับตำแหน่งรูปแล้ว');
      }else swyError('ปรับตำแหน่งรูปไม่สำเร็จ',(res&&res.message)||'');
    },function(err){swyError('เกิดข้อผิดพลาด',esc(JSON.stringify(err)));});
  }
'''
    s=s[:pos]+fn+s[pos:]

# Detail gallery JS
old='''  function viewImgFallback() {
    document.getElementById('viewImgBox').innerHTML = '<span style="font-size:36px;color:var(--faint)">📦</span>';
  }
  var viewProductImageUrls=[];
  function openViewProductImageLightbox(index){showProductImageLightbox(viewProductImageUrls,index,'รูปสินค้า');}
'''
new='''  function viewImgFallback() {
    var box=document.getElementById('viewImgBox');if(box)box.innerHTML='<span style="font-size:36px;color:var(--faint)">📦</span>';
  }
  var viewProductImageUrls=[],viewProductImageIndex=0;
  function renderViewProductGallery(){
    var box=document.getElementById('viewImgBox'),thumbs=document.getElementById('viewImgThumbs');if(!box||!thumbs)return;
    if(!viewProductImageUrls.length){box.innerHTML='<span style="font-size:36px;color:var(--faint)">📦</span>';thumbs.innerHTML='';return;}
    viewProductImageIndex=Math.max(0,Math.min(viewProductImageIndex,viewProductImageUrls.length-1));
    var url=viewProductImageUrls[viewProductImageIndex],multi=viewProductImageUrls.length>1;
    box.innerHTML='<button type="button" class="view-product-gallery-main" title="คลิกเพื่อดูรูปขนาดใหญ่" onclick="openViewProductImageLightbox('+viewProductImageIndex+')"><img src="'+esc(url)+'" alt="รูปสินค้า '+(viewProductImageIndex+1)+'" onerror="viewImgFallback()"></button>'+(multi?'<button type="button" class="view-product-gallery-nav prev" onclick="stepViewProductImage(-1)">‹</button><button type="button" class="view-product-gallery-nav next" onclick="stepViewProductImage(1)">›</button>':'')+'<span class="view-product-gallery-count">'+(viewProductImageIndex+1)+' / '+viewProductImageUrls.length+'</span>';
    thumbs.innerHTML=viewProductImageUrls.map(function(u,i){return '<button type="button" class="view-product-gallery-thumb'+(i===viewProductImageIndex?' active':'')+'" onclick="setViewProductImage('+i+')"><img src="'+esc(u)+'" alt="รูปย่อ '+(i+1)+'"></button>';}).join('');
  }
  function setViewProductImage(index){if(!viewProductImageUrls.length)return;viewProductImageIndex=Math.max(0,Math.min(parseInt(index,10)||0,viewProductImageUrls.length-1));renderViewProductGallery();}
  function stepViewProductImage(delta){if(viewProductImageUrls.length<=1)return;viewProductImageIndex=(viewProductImageIndex+delta+viewProductImageUrls.length)%viewProductImageUrls.length;renderViewProductGallery();}
  function openViewProductImageLightbox(index){showProductImageLightbox(viewProductImageUrls,index,'รูปสินค้า');}
'''
if old in s:
    s=s.replace(old,new,1)
elif 'function renderViewProductGallery()' not in s:
    raise SystemExit('detail gallery helper marker not found')

old='''    viewingDocId = item.id || docId;
    viewProductImageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls.slice(0,3) : (item.imageUrl ? [item.imageUrl] : []);
'''
new='''    viewingDocId = item.id || docId;
    viewProductImageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls.slice(0,3) : (item.imageUrl ? [item.imageUrl] : []);
    viewProductImageIndex = Math.max(0, Math.min(parseInt(item.primaryImageIndex,10)||0, Math.max(0,viewProductImageUrls.length-1)));
    if(item.imageUrl){var preferred=viewProductImageUrls.indexOf(item.imageUrl);if(preferred>=0)viewProductImageIndex=preferred;}
'''
if old in s:
    s=s.replace(old,new,1)
elif 'var preferred=viewProductImageUrls.indexOf(item.imageUrl)' not in s:
    raise SystemExit('detail image state marker not found')

old='''    var imgBox = document.getElementById('viewImgBox');
    var viewPrimaryIndex = Math.max(0, viewProductImageUrls.indexOf(item.imageUrl));
    imgBox.innerHTML = item.imageUrl
      ? '<img src="' + esc(item.imageUrl) + '" class="product-image-clickable" style="width:100%;height:100%;object-fit:contain;background:#fff" onclick="openViewProductImageLightbox(' + viewPrimaryIndex + ')" onerror="viewImgFallback()">'
      : '<span style="font-size:36px;color:var(--faint)">📦</span>';

    renderViewBarcodeSection(item);'''
new='''    renderViewProductGallery();

    renderViewBarcodeSection(item);'''
if old in s:
    s=s.replace(old,new,1)
elif '    renderViewProductGallery();\n\n    renderViewBarcodeSection(item);' not in s:
    raise SystemExit('detail image render marker not found')

s=s.replace("'เพิ่มได้สูงสุด 3 รูป · คลิกรูปเพื่อขยาย · รูปหลักใช้ในตารางและหน้าค้นหา'","'เพิ่มได้สูงสุด 3 รูป · คลิกรูปเพื่อขยาย/Zoom · เลื่อนซ้าย/ขวาเพื่อจัดตำแหน่ง · เลือกรูปหลักได้'",1)
p.write_text(s,encoding='utf-8')
