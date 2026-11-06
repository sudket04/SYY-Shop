const test=require('node:test'),assert=require('node:assert/strict');const {setup,plain}=require('./support/services.cjs');
function fixture(){const s=setup();s.c.readTime=new Date().toISOString();for(let i=0;i<160;i++)s.put('Master_Products/P'+String(i).padStart(4,'0'),{Product_Name:'อะไหล่ '+i,Brand_ID:'B1',Category_ID:'C1',Current_Stock:10,Selling_Price:200});s.put('Master_Brands/B1',{Brand_Name:'แบรนด์'});s.put('Master_Categories/C1',{Category_Name:'หมวด'});return s;}
const references=s=>s.calls.filter(x=>x.url.endsWith(':batchGet')&&JSON.parse(x.options.payload).documents.some(name=>/\/(Master_Brands|Master_Categories)\//.test(name)));
test('bounded browse pages share reference DTO cache without caching an incomplete collection',()=>{
 const s=fixture(),before=plain([...s.docs]);let page=s.c.getProductCatalogPage_({cursorMode:true,pageSize:50,includeImages:false});const ids=page.products.map(p=>p.id);
 for(let n=2;n<=3;n++){page=s.c.getProductCatalogPage_({cursorMode:true,page:n,pageSize:50,cursor:page.nextCursor,includeImages:false});ids.push(...page.products.map(p=>p.id));assert.equal(page.products[0].brandName,'แบรนด์');}
 assert.equal(new Set(ids).size,150);assert.equal(references(s).length,2,'one request per reference collection, reused across three pages');assert.equal(s.c.peekCollectionDocsCache_('Master_Brands'),null);assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);assert(s.calls.every(x=>!/:commit|:batchWrite/.test(x.url)&&!['patch','delete'].includes(x.options.method)));
});
test('reference generation invalidation refreshes changed labels; projection caches cannot leak full vendor fields',()=>{
 const s=fixture();s.put('Master_Vendors/V1',{Vendor_name:'ผู้จำหน่าย',Tax_ID:'private-fixture'});
 let result=s.c.readProductReferenceDocs_({Master_Vendors:['V1'],Master_Brands:[]},true);assert.equal(s.c.parseFirestoreValue_(result.Master_Vendors[0].fields.Vendor_name),'ผู้จำหน่าย');assert.equal(result.Master_Vendors[0].fields.Tax_ID,undefined);
 const full=s.c.readProductReferenceDocs_({Master_Vendors:['V1']},false);assert.equal(s.c.parseFirestoreValue_(full.Master_Vendors[0].fields.Tax_ID),'private-fixture');
 s.put('Master_Vendors/V1',{Vendor_name:'เปลี่ยนแล้ว',Tax_ID:'private-fixture'});s.c.clearCollectionCache_('Master_Vendors');result=s.c.readProductReferenceDocs_({Master_Vendors:['V1'],Master_Brands:[]},true);assert.equal(s.c.parseFirestoreValue_(result.Master_Vendors[0].fields.Vendor_name),'เปลี่ยนแล้ว');assert.equal(result.Master_Vendors[0].fields.Tax_ID,undefined);assert.deepEqual(plain(result.Master_Brands),[]);assert.equal(s.commits.length,0);
});
test('invalid references fail before any reads, empty sets retain their response shape',()=>{
 const s=fixture();for(const refs of [{Users:['U1']},{Master_Brands:'B1'},{Master_Brands:['bad/id']},{Master_Brands:[{}]}]){const n=s.calls.length;assert.throws(()=>s.c.readProductReferenceDocs_(refs,true));assert.equal(s.calls.length,n);}
 assert.deepEqual(plain(s.c.readProductReferenceDocs_({Master_Brands:[],Master_Cars:[]},true)),{Master_Brands:[],Master_Cars:[]});
});
test('projected references from a warm full collection never expose or erase private cached fields',()=>{
 const s=fixture();s.put('Master_Vendors/V1',{Vendor_name:'Vendor',Phone:'private-phone',Tax_ID:'private-tax'});s.c.fetchCollectionDocsCached_('Master_Vendors');const before=plain([...s.docs]),count=s.calls.length;
 const result=s.c.readProductReferenceDocs_({Master_Vendors:['V1']},true);assert.equal(s.calls.length,count);assert.deepEqual(Object.keys(result.Master_Vendors[0].fields),['Vendor_name']);
 assert.equal(s.c.parseFirestoreValue_(s.c.peekCollectionDocsCache_('Master_Vendors')[0].fields.Tax_ID),'private-tax');assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);
});
