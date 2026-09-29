from pathlib import Path

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')
old="""  function viewImgFallback() {\n    document.getElementById('viewImgBox').innerHTML = '<span style=\"font-size:36px;color:var(--faint)\">📦</span>';\n  }\n"""
new="""  function viewImgFallback() {\n    document.getElementById('viewImgBox').innerHTML = '<span style=\"font-size:36px;color:var(--faint)\">📦</span>';\n  }\n  var viewProductImageUrls=[];\n  function openViewProductImageLightbox(index){\n    if(!viewProductImageUrls.length)return;\n    index=Math.max(0,Math.min(parseInt(index,10)||0,viewProductImageUrls.length-1));\n    var html='<div style=\"display:flex;align-items:center;justify-content:center;min-height:50vh\"><img src=\"'+esc(viewProductImageUrls[index])+'\" style=\"max-width:90vw;max-height:72vh;object-fit:contain\"></div><div style=\"margin-top:8px\">รูป '+(index+1)+' / '+viewProductImageUrls.length+'</div>';\n    Swal.fire({html:html,width:'min(960px,96vw)',showConfirmButton:false,showCloseButton:true,allowOutsideClick:true,allowEscapeKey:true});\n  }\n"""
if old not in s: raise SystemExit('viewImgFallback anchor missing')
s=s.replace(old,new,1)
anchor="""    viewingDocId = item.id || docId;\n\n    document.getElementById('viewProductName').innerText = item.productName || '(ไม่มีชื่อ)';\n"""
rep="""    viewingDocId = item.id || docId;\n    viewProductImageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls.slice(0,3) : (item.imageUrl ? [item.imageUrl] : []);\n\n    document.getElementById('viewProductName').innerText = item.productName || '(ไม่มีชื่อ)';\n"""
if anchor not in s: raise SystemExit('openViewModal anchor missing')
s=s.replace(anchor,rep,1)
old2="""    var imgBox = document.getElementById('viewImgBox');\n    imgBox.innerHTML = item.imageUrl\n      ? '<img src=\"' + esc(item.imageUrl) + '\" style=\"width:100%;height:100%;object-fit:cover\" onerror=\"viewImgFallback()\">'\n      : '<span style=\"font-size:36px;color:var(--faint)\">📦</span>';\n"""
new2="""    var imgBox = document.getElementById('viewImgBox');\n    var viewPrimaryIndex = Math.max(0, viewProductImageUrls.indexOf(item.imageUrl));\n    imgBox.innerHTML = item.imageUrl\n      ? '<img src=\"' + esc(item.imageUrl) + '\" class=\"product-image-clickable\" style=\"width:100%;height:100%;object-fit:contain;background:#fff\" onclick=\"openViewProductImageLightbox(' + viewPrimaryIndex + ')\" onerror=\"viewImgFallback()\">'\n      : '<span style=\"font-size:36px;color:var(--faint)\">📦</span>';\n"""
if old2 not in s: raise SystemExit('view image block missing')
s=s.replace(old2,new2,1)
if 'object-fit:cover' in s[s.find("function openViewModal"):s.find("function openViewModal")+6000]:
    raise SystemExit('cover still exists in product detail section')
p.write_text(s,encoding='utf-8')
print('Product detail gallery fixed')
