// V2 paired local measurements and accessibility audit. No production/network writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {default:AxeBuilder}=require('@axe-core/playwright');
const {setup}=require('./support/services.cjs');
const {evaluateTemplate}=require('./support/templates.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const phase=process.env.QUALITY_PHASE==='baseline'?'baseline':'after',s=setup(),calls=[],reads={},faults=[];
s.c.readTime=new Date().toISOString();s.c.getSession_=()=>({username:'quality-fixture',role:'admin',fullName:'Fixture'});
for(let i=0;i<10000;i++)s.put('Master_Products/P'+String(i).padStart(5,'0'),{Product_Name:'อะไหล่ทดสอบ ชื่อยาว '+i,Part_Number:'PN'+i,Barcode:'BC'+i,Part_Type:i%2?'แท้':'เทียบ',Brand_ID:'B0000',Current_Stock:10,Min_Stock:2,Selling_Price:200,Cost_Price:100});
for(let i=0;i<1000;i++)s.put('Master_Brands/B'+String(i).padStart(4,'0'),{Brand_Name:'แบรนด์ '+i});
const originalFetch=s.c.UrlFetchApp.fetch;
s.c.UrlFetchApp.fetch=(url,options={})=>{
 const u=new URL(url),method=(options.method||'get').toLowerCase();
 assert(u.hostname==='firestore.googleapis.com'&&u.pathname.startsWith('/v1/projects/syy-shop/'),'unexpected fixture project');
 assert(method==='get'||method==='post'&&/:(runQuery|batchGet|runAggregationQuery)$/.test(u.pathname),'write/unsupported endpoint blocked');
 const r=originalFetch(url,options);if(r.getResponseCode()===200){const b=JSON.parse(r.getContentText()),docs=Array.isArray(b)?b.map(x=>x.document||x.found).filter(Boolean):(b.documents||(b.name?[b]:[]));for(const d of docs){const col=d.name.split('/documents/')[1].split('/')[0];reads[col]=(reads[col]||0)+1;}}return r;
};
const allowed=new Set(['getAllProducts','getProductCatalogPage','getProductCatalogFacets','getProductById','getProductImageBatch','getAllMasterDropdowns','getBrands','getCategories','getVendorsFull','getCustomersFull','getZonesFull','getCarsFull','getQuotationPageData','getQuotationListData','getTaxInvoicePageData','getTaxInvoiceListData','getPurchaseOrderPageData','getDashboardBootstrap','getStockMovementPage']);
const bridge=`<script>window.Swal={fire:()=>Promise.resolve({isConfirmed:false})};window.google={script:{run:{withSuccessHandler:function(ok){var run={withFailureHandler:function(fail){run.fail=fail;return run;},apiGateway:function(token,fn,args,ua,metadata){fetch('/rpc',{method:'POST',body:JSON.stringify({fn,args,metadata})}).then(r=>r.json()).then(ok).catch(e=>run.fail(e));}};return run;}}}};</script>`;
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://127.0.0.1');if(req.method==='POST'&&u.pathname==='/rpc'){let text='';for await(const b of req)text+=b;const {fn,args,metadata}=JSON.parse(text);assert(allowed.has(fn),'unexpected RPC '+fn);const start=performance.now(),r=s.c.apiGateway('fixture',fn,args,'fixture',metadata);calls.push({fn,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(r))});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(r));return;}
 const file=u.searchParams.get('file')||'Master_Brands.html';assert(/^[A-Za-z_]+\.html$/.test(file));let html=evaluateTemplate(file,{username:'quality-fixture',userName:'Fixture',userRole:'admin',authToken:'fixture',webAppUrl:'http://127.0.0.1:'+server.address().port+'/',frameChannel:'',resetMode:'',resetToken:''});res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(html.replace('<head>','<head>'+bridge));
}catch(e){faults.push(e.message);res.writeHead(500).end('Fixture rejected');}});
let browser;
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
 browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1365,height:950}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&u.port===String(server.address().port)?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?file=Master_Brands.html');await page.waitForFunction(()=>typeof cache!=='undefined'&&cache.length===1000&&syyUxBusy===0);
 const samples=[];for(let i=0;i<30;i++)samples.push(await page.evaluate(()=>{const t=performance.now();renderRows();return performance.now()-t;}));samples.sort((a,b)=>a-b);
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 const metrics={phase,environment:'local Chrome; same context repeated render; synthetic 1000 master/10000 products; external traffic blocked; no GAS latency or billed costs',samples:samples.length,renderMs:{p50:samples[14],p95:samples[28]},masterRows:await page.locator('#tbodyMain tr[data-row-key]').count(),rpc:calls.length,payloadBytes:calls.reduce((n,x)=>n+x.bytes,0),mockDocumentReads:reads,violations:a11y.violations.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length})),errors};
 fs.writeFileSync(path.join(out,'quality-'+phase+'-measurements.json'),JSON.stringify(metrics,null,2));assert.deepEqual(errors,[]);assert.deepEqual(faults,[]);assert.equal(s.commits.length,0);
 if(phase==='after'){assert(metrics.masterRows<=25);const count=calls.length;await page.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();assert.equal(await page.locator('#tbodyMain tr[data-row-key]').first().getAttribute('data-row-key'),'B0025');assert.equal(calls.length,count);}
 console.log(JSON.stringify(metrics));await context.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
