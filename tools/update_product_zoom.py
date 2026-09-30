from pathlib import Path

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')

if '.product-image-viewer-overlay{' not in s:
    marker='@media(max-width:640px){.product-image-slots-ui{grid-template-columns:1fr}.product-image-preview-btn,.product-image-add-ui{height:180px}.view-product-gallery,.view-product-gallery-stage{width:100%}.view-product-gallery-stage{height:min(62vw,280px)}}'
    if marker not in s:
        raise SystemExit('mobile gallery CSS marker not found')
    css='''
.product-image-viewer-overlay{position:fixed;inset:0;z-index:6000;background:rgba(2,8,23,.94);display:none;flex-direction:column;align-items:stretch;justify-content:stretch;overscroll-behavior:contain;touch-action:none}
.product-image-viewer-overlay.open{display:flex}
.product-image-viewer-toolbar{height:58px;flex:0 0 58px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;color:#fff;background:rgba(2,8,23,.82);border-bottom:1px solid rgba(255,255,255,.12)}
.product-image-viewer-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.product-image-viewer-controls{display:flex;align-items:center;gap:6px;flex-shrink:0}
.product-image-viewer-btn{height:36px;min-width:36px;padding:0 10px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:rgba(255,255,255,.10);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.product-image-viewer-btn:hover{background:rgba(255,255,255,.20)}
.product-image-viewer-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:default}
.product-image-viewer-stage.pan-enabled{cursor:grab}.product-image-viewer-stage.dragging{cursor:grabbing}
.product-image-viewer-img{display:block;max-width:92vw;max-height:calc(100dvh - 104px);width:auto;height:auto;object-fit:contain;transform-origin:center center;user-select:none;-webkit-user-drag:none;will-change:transform}
.product-image-viewer-arrow{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:54px;border:0;border-radius:11px;background:rgba(15,23,42,.62);color:#fff;font-size:30px;cursor:pointer;z-index:3}
.product-image-viewer-arrow.prev{left:12px}.product-image-viewer-arrow.next{right:12px}
.product-image-viewer-arrow:hover{background:rgba(0,80,136,.92)}
.product-image-viewer-footer{height:42px;flex:0 0 42px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:12px;background:rgba(2,8,23,.82);border-top:1px solid rgba(255,255,255,.08)}
@media(max-width:640px){.product-image-viewer-toolbar{height:auto;min-height:58px;flex-wrap:wrap}.product-image-viewer-title{width:100%}.product-image-viewer-controls{width:100%;justify-content:center}}
'''
    s=s.replace(marker,marker+css,1)

start=s.find('  function showProductImageLightbox(urls,index,title){')
end=s.find('  function openProductImageLightbox(index)',start)
if start<0 or end<0:
    raise SystemExit('old lightbox function not found')
viewer='''  var PRODUCT_VIEWER={urls:[],index:0,title:'รูปสินค้า',scale:1,x:0,y:0,drag:false,startX:0,startY:0,baseX:0,baseY:0};
  function ensureProductImageViewer(){
    var overlay=document.getElementById('productImageViewer');if(overlay)return overlay;
    overlay=document.createElement('div');overlay.id='productImageViewer';overlay.className='product-image-viewer-overlay';overlay.innerHTML=
      '<div class="product-image-viewer-toolbar"><div class="product-image-viewer-title" id="productImageViewerTitle">รูปสินค้า</div><div class="product-image-viewer-controls">'+
      '<button type="button" class="product-image-viewer-btn" onclick="zoomProductImageViewer(-0.25)" aria-label="ซูมออก">−</button>'+
      '<button type="button" class="product-image-viewer-btn" id="productImageViewerScale" onclick="resetProductImageViewer()" title="รีเซ็ตการซูม">100%</button>'+
      '<button type="button" class="product-image-viewer-btn" onclick="zoomProductImageViewer(0.25)" aria-label="ซูมเข้า">+</button>'+
      '<button type="button" class="product-image-viewer-btn" onclick="resetProductImageViewer()">Reset</button>'+
      '<button type="button" class="product-image-viewer-btn" onclick="closeProductImageViewer()" aria-label="ปิด">✕</button></div></div>'+
      '<div class="product-image-viewer-stage" id="productImageViewerStage"><button type="button" class="product-image-viewer-arrow prev" id="productImageViewerPrev" onclick="stepProductImageViewer(-1)">‹</button><img id="productImageViewerImg" class="product-image-viewer-img" alt="รูปสินค้า" draggable="false"><button type="button" class="product-image-viewer-arrow next" id="productImageViewerNext" onclick="stepProductImageViewer(1)">›</button></div>'+
      '<div class="product-image-viewer-footer" id="productImageViewerFooter">หมุนล้อเมาส์เพื่อ Zoom · ลากรูปเมื่อซูม</div>';
    document.body.appendChild(overlay);
    var stage=document.getElementById('productImageViewerStage');
    stage.addEventListener('wheel',function(e){e.preventDefault();zoomProductImageViewer(e.deltaY<0?0.15:-0.15);},{passive:false});
    stage.addEventListener('pointerdown',function(e){if(PRODUCT_VIEWER.scale<=1||e.target.tagName==='BUTTON')return;PRODUCT_VIEWER.drag=true;PRODUCT_VIEWER.startX=e.clientX;PRODUCT_VIEWER.startY=e.clientY;PRODUCT_VIEWER.baseX=PRODUCT_VIEWER.x;PRODUCT_VIEWER.baseY=PRODUCT_VIEWER.y;stage.classList.add('dragging');stage.setPointerCapture(e.pointerId);});
    stage.addEventListener('pointermove',function(e){if(!PRODUCT_VIEWER.drag)return;PRODUCT_VIEWER.x=PRODUCT_VIEWER.baseX+(e.clientX-PRODUCT_VIEWER.startX);PRODUCT_VIEWER.y=PRODUCT_VIEWER.baseY+(e.clientY-PRODUCT_VIEWER.startY);applyProductImageViewerTransform();});
    function endDrag(e){if(!PRODUCT_VIEWER.drag)return;PRODUCT_VIEWER.drag=false;stage.classList.remove('dragging');try{stage.releasePointerCapture(e.pointerId);}catch(_){}}
    stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
    return overlay;
  }
  function showProductImageLightbox(urls,index,title){
    urls=(Array.isArray(urls)?urls:[]).filter(Boolean).slice(0,3);if(!urls.length)return;
    if(window.SYYSelect)SYYSelect.closeActive();
    var active=document.activeElement;if(active&&active.blur)active.blur();
    PRODUCT_VIEWER.urls=urls;PRODUCT_VIEWER.index=Math.max(0,Math.min(parseInt(index,10)||0,urls.length-1));PRODUCT_VIEWER.title=title||'รูปสินค้า';
    ensureProductImageViewer().classList.add('open');document.body.style.overflow='hidden';renderProductImageViewer();
  }
  function renderProductImageViewer(){
    var img=document.getElementById('productImageViewerImg');if(!img)return;
    resetProductImageViewer(false);img.src=PRODUCT_VIEWER.urls[PRODUCT_VIEWER.index]||'';img.alt=PRODUCT_VIEWER.title+' '+(PRODUCT_VIEWER.index+1);
    document.getElementById('productImageViewerTitle').textContent=PRODUCT_VIEWER.title;
    var multi=PRODUCT_VIEWER.urls.length>1;document.getElementById('productImageViewerPrev').style.display=multi?'':'none';document.getElementById('productImageViewerNext').style.display=multi?'':'none';
    document.getElementById('productImageViewerFooter').textContent='รูป '+(PRODUCT_VIEWER.index+1)+' / '+PRODUCT_VIEWER.urls.length+' · หมุนล้อเมาส์เพื่อ Zoom · ลากรูปเมื่อซูม';
  }
  function applyProductImageViewerTransform(){
    var img=document.getElementById('productImageViewerImg'),stage=document.getElementById('productImageViewerStage');if(!img)return;
    img.style.transform='translate('+PRODUCT_VIEWER.x+'px,'+PRODUCT_VIEWER.y+'px) scale('+PRODUCT_VIEWER.scale+')';
    var scale=document.getElementById('productImageViewerScale');if(scale)scale.textContent=Math.round(PRODUCT_VIEWER.scale*100)+'%';
    if(stage)stage.classList.toggle('pan-enabled',PRODUCT_VIEWER.scale>1);
  }
  function zoomProductImageViewer(delta){
    var next=Math.max(0.5,Math.min(5,Math.round((PRODUCT_VIEWER.scale+delta)*100)/100));PRODUCT_VIEWER.scale=next;
    if(next<=1){PRODUCT_VIEWER.x=0;PRODUCT_VIEWER.y=0;}applyProductImageViewerTransform();
  }
  function resetProductImageViewer(apply){PRODUCT_VIEWER.scale=1;PRODUCT_VIEWER.x=0;PRODUCT_VIEWER.y=0;PRODUCT_VIEWER.drag=false;if(apply!==false)applyProductImageViewerTransform();else setTimeout(applyProductImageViewerTransform,0);}
  function stepProductImageViewer(delta){if(PRODUCT_VIEWER.urls.length<=1)return;PRODUCT_VIEWER.index=(PRODUCT_VIEWER.index+delta+PRODUCT_VIEWER.urls.length)%PRODUCT_VIEWER.urls.length;renderProductImageViewer();}
  function closeProductImageViewer(){var o=document.getElementById('productImageViewer');if(o)o.classList.remove('open');PRODUCT_VIEWER.drag=false;document.body.style.overflow='';}
  document.addEventListener('keydown',function(e){var o=document.getElementById('productImageViewer');if(!o||!o.classList.contains('open'))return;if(e.key==='Escape')closeProductImageViewer();else if(e.key==='+'||e.key==='=')zoomProductImageViewer(0.25);else if(e.key==='-')zoomProductImageViewer(-0.25);else if(e.key==='ArrowLeft')stepProductImageViewer(-1);else if(e.key==='ArrowRight')stepProductImageViewer(1);});
'''
s=s[:start]+viewer+s[end:]
p.write_text(s,encoding='utf-8')
