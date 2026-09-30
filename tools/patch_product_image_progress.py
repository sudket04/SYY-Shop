from pathlib import Path

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')

old='''<div id="imgUploadProgress" style="display:none;margin-top:8px"><div class="img-upload-progress-track"><div class="img-upload-progress-bar"></div></div><div style="font-size:11px;color:var(--faint);margin-top:4px">กำลังประมวลผลและอัปโหลดรูป...</div></div>'''
new='''<div id="imgUploadProgress" style="display:none;margin-top:8px">
              <div class="img-upload-progress-track"><div class="img-upload-progress-bar" id="imgUploadProgressBar"></div></div>
              <div class="img-upload-progress-status"><span id="imgUploadProgressText">กำลังเตรียมรูป...</span><strong id="imgUploadProgressPercent">0%</strong></div>
            </div>'''
if old not in s:
    raise SystemExit('progress html marker not found')
s=s.replace(old,new,1)

old='''.img-upload-progress-bar{height:100%;width:35%;background:var(--primary);border-radius:4px;animation:imgUploadSlide 1.1s ease-in-out infinite}'''
new='''.img-upload-progress-bar{height:100%;width:0;background:var(--primary);border-radius:4px;transition:width .22s ease}
  .img-upload-progress-status{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--faint);margin-top:4px}
  .img-upload-progress-status strong{color:var(--primary);font-variant-numeric:tabular-nums;min-width:38px;text-align:right}'''
if old not in s:
    raise SystemExit('progress css marker not found')
s=s.replace(old,new,1)

start=s.index('  function pickProductImage(slot)')
end=s.index('  function syncProductImageCache(primary)', start)
old=s[start:end]
new=r'''  function setImageUploadProgress(percent,text,visible){
    var wrap=document.getElementById('imgUploadProgress'),bar=document.getElementById('imgUploadProgressBar'),pct=document.getElementById('imgUploadProgressPercent'),label=document.getElementById('imgUploadProgressText');
    percent=Math.max(0,Math.min(100,parseInt(percent,10)||0));
    if(wrap)wrap.style.display=visible===false?'none':'block';
    if(bar)bar.style.width=percent+'%';
    if(pct)pct.textContent=percent+'%';
    if(label&&text)label.textContent=text;
  }
  function resetImageUploadProgress(){setImageUploadProgress(0,'กำลังเตรียมรูป...',false);}
  function pickProductImage(slot){
    if(!editingDocId){swyWarning('บันทึกสินค้าก่อน');return;}
    if(window.SYYSelect)SYYSelect.closeActive();
    pendingImageSlot=slot;resetImageUploadProgress();
    var i=document.getElementById('inp_imageFile');i.value='';i.click();
  }
  function onProductImageSelected(input){
    var file=input.files&&input.files[0];if(!file)return;
    if(!editingDocId){swyWarning('บันทึกสินค้าก่อน');input.value='';return;}
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){swyWarning('ไฟล์ไม่ถูกต้อง','รองรับ JPG, PNG และ WebP เท่านั้น');input.value='';return;}
    if(file.size>5*1024*1024){swyWarning('ไฟล์ใหญ่เกินไป','ไฟล์ต้นฉบับต้องไม่เกิน 5MB');input.value='';return;}
    setImageUploadProgress(10,'กำลังอ่านไฟล์...',true);
    var reader=new FileReader();
    reader.onload=function(e){
      setImageUploadProgress(25,'กำลังตรวจสอบรูป...',true);
      var img=new Image();
      img.onload=function(){
        var w=img.naturalWidth,h=img.naturalHeight;
        if(w<100||h<100){resetImageUploadProgress();swyWarning('รูปมีความละเอียดต่ำ','กรุณาใช้รูปอย่างน้อย 100×100 พิกเซล');return;}
        setImageUploadProgress(40,'กำลังปรับขนาดรูป...',true);
        if(w>PROD_IMG_MAX_DIM||h>PROD_IMG_MAX_DIM){if(w>=h){h=Math.round(h*PROD_IMG_MAX_DIM/w);w=PROD_IMG_MAX_DIM;}else{w=Math.round(w*PROD_IMG_MAX_DIM/h);h=PROD_IMG_MAX_DIM;}}
        var c=document.createElement('canvas');c.width=w;c.height=h;var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
        setImageUploadProgress(60,'เตรียมอัปโหลดรูป...',true);
        uploadProductImageNow(c.toDataURL('image/jpeg',PROD_IMG_QUALITY).split(',')[1],pendingImageSlot);
      };
      img.onerror=function(){resetImageUploadProgress();swyError('เปิดรูปไม่สำเร็จ');};
      img.src=e.target.result;
    };
    reader.onerror=function(){resetImageUploadProgress();input.value='';swyError('อ่านไฟล์ไม่สำเร็จ');};
    reader.readAsDataURL(file);
  }
  function uploadProductImageNow(base64,slot){
    var input=document.getElementById('inp_imageFile');
    setImageUploadProgress(80,'กำลังอัปโหลดและบันทึก...',true);
    callApi('uploadProductImage',[editingDocId,base64,slot],function(res){
      if(input)input.value='';
      if(res&&res.success){
        productImageUrls=Array.isArray(res.imageUrls)?res.imageUrls.slice(0,3):productImageUrls;
        productPrimaryImageIndex=Math.max(0,Math.min(parseInt(res.primaryIndex,10)||0,Math.max(0,productImageUrls.length-1)));
        syncProductImageCache(res.imageUrl);renderProductImageSlots(editingDocId);filterAndRenderTable();
        setImageUploadProgress(100,'อัปโหลดสำเร็จ',true);toast('อัปโหลดรูปสำเร็จ');
        setTimeout(resetImageUploadProgress,700);
      }else{resetImageUploadProgress();swyError('อัปโหลดไม่สำเร็จ',(res&&res.message)||'ไม่สามารถบันทึกรูปได้');}
    },function(err){if(input)input.value='';resetImageUploadProgress();swyError('เกิดข้อผิดพลาด',esc(JSON.stringify(err)));});
  }
'''
s=s[:start]+new+s[end:]

old="""  function deleteProductImageNow(slot){if(!editingDocId)return;swyConfirm({icon:'warning',title:'ลบรูปสินค้า?',confirmText:'ลบรูป',danger:true}).then(function(ok){if(!ok)return;callApi('deleteProductImage',[editingDocId,slot],function(res){if(res&&res.success){productImageUrls=res.imageUrls||[];productPrimaryImageIndex=res.primaryIndex||0;syncProductImageCache();renderProductImageSlots(editingDocId);filterAndRenderTable();toast('ลบรูปเรียบร้อย');}else swyError('ลบไม่สำเร็จ',(res&&res.message)||'');});});}"""
new="""  function deleteProductImageNow(slot){
    if(!editingDocId)return;
    if(window.SYYSelect)SYYSelect.closeActive();
    var active=document.activeElement;if(active&&active.blur)active.blur();
    function doDelete(){
      callApi('deleteProductImage',[editingDocId,slot],function(res){
        if(res&&res.success){productImageUrls=res.imageUrls||[];productPrimaryImageIndex=res.primaryIndex||0;syncProductImageCache();renderProductImageSlots(editingDocId);filterAndRenderTable();toast('ลบรูปเรียบร้อย');}
        else swyError('ลบไม่สำเร็จ',(res&&res.message)||'');
      });
    }
    if(window.Swal&&Swal.fire){
      Swal.fire({icon:'warning',title:'ลบรูปสินค้า?',text:'รูปนี้จะถูกลบออกจากรายการรูปสินค้า',showCancelButton:true,confirmButtonText:'ลบรูป',cancelButtonText:'ยกเลิก',reverseButtons:true,focusCancel:true,customClass:{popup:'swy-popup',title:'swy-title',confirmButton:'swy-confirm-btn danger',cancelButton:'swy-cancel-btn'},buttonsStyling:false}).then(function(r){if(r&&r.isConfirmed)doDelete();});
    }else if(window.confirm('ยืนยันลบรูปสินค้า?'))doDelete();
  }"""
if old not in s:
    raise SystemExit('delete function marker not found')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
