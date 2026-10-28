// Synthetic Firestore only. Counts returned documents, not billed reads or network latency.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,plain,reply}=require('./support/services.cjs');
function fixture(n=10000){
 const s=setup();s.c.readTime=new Date().toISOString();
 for(let i=0;i<n;i++){
  const id='P'+String(i).padStart(5,'0');
  s.put('Master_Products/'+id,{Product_Name:'อะไหล่ ทดสอบ '+i,Part_Type:i%2?'แท้':'เทียบ',Part_Number:'PN'+i,Barcode:'BC'+i,Brand_ID:'B1',Category_ID:'C1',Default_Vendor_ID:'V1',Zone_ID:'Z1',Car_ID:'CAR1',Cost_Price:i,Selling_Price:i+10,Current_Stock:10,Min_Stock:2,Extra:'preserve'});
  s.put('Product_Images/'+id,{Image_Url:'https://example.invalid/'+id+'.jpg'});
 }
 for(const [col,id,fields] of [['Master_Brands','B1',{Brand_Name:'ยี่ห้อไทย'}],['Master_Categories','C1',{Category_Name:'หมวด'}],['Master_Vendors','V1',{Vendor_name:'ร้าน'}],['Master_Zones','Z1',{Area:'A'}],['Master_Cars','CAR1',{Brand:'รถ',Model:'รุ่น'}]])s.put(col+'/'+id,fields);
 s.reads={};const fetch=s.c.UrlFetchApp.fetch;
 s.c.UrlFetchApp.fetch=(url,o={})=>{const r=fetch(url,o);if(r.getResponseCode()===200){const b=JSON.parse(r.getContentText()),docs=url.endsWith(':batchGet')?b.filter(x=>x.found).map(x=>x.found):o.method==='get'?(b.documents||(b.name?[b]:[])):[];for(const d of docs){const col=d.name.split('/documents/')[1].split('/')[0];s.reads[col]=(s.reads[col]||0)+1;}}return r;};
 return s;
}
test('10,000 products: first page reads no full image collection, warm repeat is zero extra data reads; counts and end-of-catalog search remain global',()=>{
 const old=fixture(),legacy=old.c.getAllProducts_();const s=fixture(),first=s.c.getAllProducts_({paged:true,includeMasters:true,pageSize:50});
 assert.equal(first.total,10000);assert.equal(first.products.length,50);assert.equal(first.masters.brands[0].Name,'ยี่ห้อไทย');
 assert.equal(s.reads.Master_Products,10000);assert.equal(s.reads.Product_Images,50);assert.equal(old.reads.Product_Images,10000);
 assert.equal(s.calls.filter(c=>/Master_Products\?/.test(c.url)).length,10);
 const before={...s.reads};s.c.getAllProducts_({paged:true,includeMasters:true,pageSize:50});assert.deepEqual(s.reads,before);
 const last=s.c.getProductCatalogPage_({search:'BC9999',pageSize:25});assert.equal(last.total,1);assert.equal(last.products[0].productCode,'P09999');assert.equal(s.reads.Master_Products,10000);
 assert.equal(s.c.getProductCatalogPage_({search:'ยี่ห้อไทย'}).total,10000);
 const compact=s.c.getAllProducts_({compact:true});assert.equal(compact.rows.length,10000);
 const unpacked=s.c.unpackProductCatalog_(compact);
 for(const i of [0,4999,9999])for(const key of compact.fields)assert.deepEqual(plain(unpacked[i][key]),plain(legacy[i][key]),key);
 const bytes=x=>Buffer.byteLength(JSON.stringify(x));assert(bytes(compact)<bytes(legacy)*0.5);assert(bytes(first)<bytes(legacy)*0.02);
 require('node:fs').mkdirSync('test-results',{recursive:true});require('node:fs').writeFileSync('test-results/catalog-scale.json',JSON.stringify({products:10000,legacyReads:old.reads,firstPageReads:before,legacyBytes:bytes(legacy),firstPageBytes:bytes(first),compactCatalogBytes:bytes(compact),note:'Mock returned documents only; cold product scan remains necessary for existing substring/filter semantics. No live latency or billing measurement.'},null,2));
 let batch=s.c.getProductCatalogPage_({pageSize:200}),exported=[...batch.products];
 while(batch.hasMore){batch=s.c.getProductCatalogPage_({pageSize:200,cursor:batch.nextCursor});exported.push(...batch.products);}
 assert.equal(exported.length,10000);assert.equal(new Set(exported.map(x=>x.id)).size,10000);assert.equal(s.reads.Master_Products,10000);
 assert.equal(s.commits.length,0);
});
test('full filtered export drains stable pages, retains images and numeric sort, and global cascading facets exclude their own filter',()=>{
 const s=fixture(1100),options={filters:{partType:['แท้']},sortCol:'costPrice',sortAsc:false,pageSize:200};
 let r=s.c.getProductCatalogPage_(options),rows=[...r.products];
 while(r.hasMore){r=s.c.getProductCatalogPage_({...options,cursor:r.nextCursor});rows.push(...r.products);}
 assert.equal(rows.length,550);assert.equal(new Set(rows.map(x=>x.id)).size,550);assert.equal(rows[0].costPrice,1099);assert.equal(rows.at(-1).costPrice,1);assert(rows.every(x=>x.imageUrl.endsWith(x.id+'.jpg')));
 assert.deepEqual(plain(s.c.getProductCatalogFacets_({filters:{partType:['แท้']},search:'no match'},'partType').values).sort(),['เทียบ','แท้'].sort());
 assert.equal(s.c.getProductCatalogPage_({filters:{partType:['\u0000__NONE__']}}).total,0);
 assert.equal(s.c.getProductCatalogPage_({page:900}).page,22);
});
test('catalog cursors reject tampering, scope/project changes, expired snapshots and committed stock changes; targeted reads remain Viewer only',()=>{
 const s=fixture(70),r=s.c.getProductCatalogPage_(),token=r.nextCursor;
 for(const opts of [{cursor:token+'x'},{cursor:token,search:'different'},{cursor:token,pageSize:201},{filters:{constructor:['x']}},{search:'x'.repeat(201)}])assert.throws(()=>s.c.getProductCatalogPage_(opts));
 s.c.PROJECT_ID='other';assert.throws(()=>s.c.getProductCatalogPage_({cursor:token}));s.c.PROJECT_ID='syy-shop';
 const expired=JSON.parse(Buffer.from(token.split('.')[0],'base64').toString());expired.at=Date.now()-301000;assert.throws(()=>s.c.getProductCatalogPage_({cursor:s.c.productCatalogCursor_(expired)}));
 s.put('Master_Products/P00000',{Product_Name:'changed',Current_Stock:8});s.c.refreshChangedProductsCache_(['P00000']);
 assert.throws(()=>s.c.getProductCatalogPage_({cursor:token}),/เปลี่ยนแปลง/);assert.equal(s.c.getProductCatalogPage_().products[0].currentStock,8);
 for(const route of ['getProductCatalogPage','getProductCatalogFacets','getProductImageBatch','getProductById'])assert.equal(s.c.API_REGISTRY[route],'viewer');
 assert.equal(s.c.apiGateway('invalid','getProductCatalogPage',[]).__authError,true);
 assert.throws(()=>s.c.getProductImageBatch_(['../Master_Users/U1']));assert.throws(()=>s.c.getProductById_('../Master_Users/U1'));
 assert.equal(s.commits.length,0);
});
test('catalog chunk eviction rebuilds from raw cache without DB reads; external refresh changes cannot mix export pages',()=>{
 const s=fixture(100),r=s.c.getProductCatalogPage_({pageSize:25});
 const key=s.c.readCacheKey_('product-catalog-v1'),manifest=JSON.parse(s.cache.get(key));s.cache.delete(key+'_'+manifest.id+'_0');
 const before=s.reads.Master_Products;assert.equal(s.c.getProductCatalogPage_({cursor:r.nextCursor}).products.length,50);assert.equal(s.reads.Master_Products,before);
 s.put('Master_Products/P00001',{Product_Name:'external change',Current_Stock:3});s.cache.clear();
 assert.throws(()=>s.c.getProductCatalogPage_({cursor:r.nextCursor}),/เปลี่ยนแปลง/);
});
test('committed sale invalidates compact catalog while retaining atomic writes and targeted stock reads',()=>{
 const s=fixture(100);s.c.getAllProducts_({compact:true});const before=s.reads.Master_Products;
 const result=s.c.issueStock_({requestId:'catalog-stock-00001',reason:'ขายหน้าร้าน',items:[{productCode:'P00001',qty:2}]},'staff');
 assert.equal(result.success,true,result.message);const rows=s.c.unpackProductCatalog_(s.c.getAllProducts_({compact:true}));
 assert.equal(rows.find(p=>p.productCode==='P00001').currentStock,8);assert.equal(s.reads.Master_Products-before,2);assert.equal(s.commits.length,1);assert.equal(s.commits[0].length,4);
 assert.equal(s.value('Master_Products/P00001','Extra'),'preserve');assert.equal(s.value('Master_Products/P00001','Selling_Price'),11);
});
test('live producer cannot cause duplicate full scans after 900ms; released/failed leases recover and owner cleanup is scoped',()=>{
 const s=fixture(10),key=s.c.readCacheKey_('lease:test'),lease={owner:'other',until:Date.now()+30000};s.cache.set(key,JSON.stringify(lease));let slept=0,work=0;
 s.c.Utilities.sleep=()=>{slept++;};assert.throws(()=>s.c.withReadLease_('test',()=>null,()=>++work),/รอสักครู่/);assert.equal(work,0);assert.equal(slept,8);assert.equal(JSON.parse(s.cache.get(key)).owner,'other');
 s.c.Utilities.sleep=()=>s.cache.delete(key);assert.equal(s.c.withReadLease_('test',()=>null,()=>++work),1);assert(!s.cache.has(key));
 assert.throws(()=>s.c.withReadLease_('test',()=>null,()=>{throw Error('failed');}),/failed/);assert(!s.cache.has(key));
 s.c.CacheService.getScriptCache=()=>{throw Error('unavailable');};assert.equal(s.c.withReadLease_('test',()=>null,()=>42),42);
});
test('image failures never become a cached empty gallery; cache outage still returns complete catalog; refresh rejects a concurrent generation change',()=>{
 const s=fixture(3);s.c.failRequest=url=>url.endsWith(':batchGet')?503:0;
 assert.throws(()=>s.c.getProductCatalogPage_(),/รูป/);s.c.failRequest=null;assert(s.c.getProductCatalogPage_().products[0].imageUrl);
 s.cache.clear();s.c.CacheService.getScriptCache=()=>({get(){throw Error('offline');}});assert.equal(s.c.getProductCatalogPage_().products.length,3);
 const t=fixture(4),fetch=t.c.UrlFetchApp.fetch;t.c.UrlFetchApp.fetch=(url,o)=>{const response=fetch(url,o);if(url.endsWith(':batchGet'))t.c.clearCollectionCache_('Master_Products');return response;};assert.throws(()=>t.c.getProductCatalogPage_(),/เปลี่ยนแปลง/);
});
