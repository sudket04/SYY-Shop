// Local recovery rehearsal. All Firestore, Drive, Mail and Properties are fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setup:setupServices, plain, reply} = require('./support/services.cjs');
// Keep exercising previously saved v2 bundles without shipping its image-copying writer.
const setup=()=>setupServices({legacyBackup:true});
const options = {sourceProjectId:'syy-shop', targetProjectId:'staging-shop',
  confirmRestore:true, confirmStagingScript:true, restoreProperties:true};
function backup(s) {
  const result = s.c.backupAllDataToBackup_();
  assert.equal(result.success, true, JSON.stringify(result.errors));
  return {result, bundle:JSON.parse(s.files.get(result.fileId).getBlob().getDataAsString())};
}
function restore(s, id, mode='all') {
  s.c.PROJECT_ID = 'staging-shop';
  return s.c.restoreFromBackup_(id, mode, options);
}
function image(s) {
  const file = s.makeFile(Buffer.from([255,216,255,1]));
  s.put('Product_Images/P00000', {Image_Url:'https://lh3.googleusercontent.com/d/'+file.id,
    Drive_File_Id:file.id, Primary_Index:0, Audit_Note:'Preserve original metadata',
    Extra_Metadata:{source:'fixture', revision:7}});
  return file;
}

test('large recovery crosses 50 backup pages and multiple restore commits, preserves snapshot and source', () => {
  const s = setup(), productCount = 15307;
  for (const name of Array.from(s.c.BACKUP_COLLECTIONS)) {
    if (!['Master_Products','Master_Users','Product_Images'].includes(name))
      s.put(name+'/FIXTURE', {Name:name, Unknown_Field:{keep:true}});
  }
  for (let i=0; i<productCount; i++) s.put('Master_Products/P'+String(i).padStart(5,'0'),
    {Product_Name:'Part '+i, Current_Stock:i/10, Selling_Price:i%3 ? 100 : 0,
      Legacy_Metadata:{code:i, text:'อะไหล่'}});
  s.user(); const originalImage = image(s);
  const fetch = s.c.UrlFetchApp.fetch;
  let mutated = false;
  s.c.UrlFetchApp.fetch = (url, request) => {
    const response = fetch(url, request);
    if (!mutated && url.includes('transaction=')) {
      mutated = true;
      s.put('Master_Products/P00000', {Product_Name:'Changed after snapshot', Current_Stock:999});
    }
    return response;
  };
  const {result, bundle} = backup(s);
  assert.equal(result.fileSizeKB,Math.round(s.files.get(result.fileId).getSize()/1024),'Backup size uses actual bytes, including Thai text');
  assert.equal(bundle.collections.Master_Products.length, productCount);
  assert.equal(s.c.parseFirestoreValue_(bundle.collections.Master_Products[0].fields.Current_Stock), 0);
  assert.equal(s.value('Master_Products/P00000','Current_Stock'), 999);
  const reads = s.calls.filter(x => x.url.includes('transaction='));
  assert.equal(new Set(reads.map(x => new URL(x.url).searchParams.get('transaction'))).size, 1);
  assert.equal(reads.filter(x => x.url.includes('/Master_Products?')).length, 52);
  assert.equal(s.commits.length, 0);
  assert.equal(s.calls.filter(x => x.url.endsWith(':rollback')).length, 1);
  const source = plain([...s.docs]);
  const dryRun = s.c.restoreFromBackup_(result.fileId,'all');
  assert.equal(dryRun.success, true); assert.equal(dryRun.dryRun, true);
  assert.equal(s.commits.length, 0);
  const restored = restore(s, result.fileId);
  assert.equal(restored.success, true, JSON.stringify(restored.errors));
  const count = Object.values(bundle.collections).reduce((n,docs) => n+docs.length,0);
  assert.equal(s.commits.length, Math.ceil(count/450));
  assert(s.commits.every(writes => writes.length<=450 && writes.every(w => w.currentDocument.exists===false)));
  assert.deepEqual(plain([...s.docs].filter(([key]) => !key.startsWith('staging-shop::'))), source);
  for (const [name, docs] of Object.entries(bundle.collections)) for (const doc of docs) {
    const actual = plain(s.docs.get('staging-shop::'+name+'/'+doc.id).fields);
    const expected = plain(doc.fields);
    if (name==='Master_Users') {
      assert(actual.Session_Version.stringValue); delete actual.Session_Version; delete expected.Session_Version;
    }
    if (name!=='Product_Images') assert.deepEqual(actual, expected, name+'/'+doc.id);
  }
  assert.notEqual(restored.imageFileMap[originalImage.id], originalImage.id);
  assert.equal(s.value('staging-shop::Product_Images/P00000','Drive_File_Id'), restored.imageFileMap[originalImage.id]);
  assert.equal(s.c.authLogin('admin','old-password').success, true);
  const commitsBefore = s.commits.length;
  assert.equal(restore(s,result.fileId).success, false, 'Non-empty staging cannot be overwritten');
  assert.equal(s.commits.length, commitsBefore);
  const metrics = {label:'Local synthetic recovery only; no live services or billing measurement',
    collections:Object.keys(bundle.collections).length, products:productCount, documents:count,
    backupPageRequests:reads.length, productPageRequests:52,
    backupBytes:s.files.get(result.fileId).getSize(), restoreCommitRequests:commitsBefore,
    maxWritesPerCommit:Math.max(...s.commits.map(x=>x.length)), sourceUnchangedByRestore:true};
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'..','test-results','recovery-result.json'),JSON.stringify(metrics,null,2));
});

test('image recovery remaps gallery fields and retains unknown historical metadata', () => {
  const s=setup(); image(s); const {result,bundle}=backup(s);
  assert.equal(restore(s,result.fileId).success,true);
  assert.equal(s.value('staging-shop::Product_Images/P00000','Audit_Note'),'Preserve original metadata');
  assert.deepEqual(plain(s.docs.get('staging-shop::Product_Images/P00000').fields.Extra_Metadata),
    bundle.collections.Product_Images[0].fields.Extra_Metadata);
});

test('backup accepts valid document IDs matching JavaScript object prototype names', () => {
  const s=setup();
  for (const id of ['constructor','toString','hasOwnProperty']) s.put('Master_Products/'+id,{Product_Name:id});
  const {result,bundle}=backup(s);
  assert.equal(bundle.collections.Master_Products.length,3);
  assert.equal(restore(s,result.fileId).success,true);
  for(const id of ['constructor','toString','hasOwnProperty']) assert.equal(s.value('staging-shop::Master_Products/'+id,'Product_Name'),id);
});

test('late page failure or repeated token never publishes a partial backup', () => {
  for (const failure of ['http','repeat']) {
    const s=setup(); for(let i=0;i<601;i++) s.put('Master_Products/P'+i,{Current_Stock:i});
    const fetch=s.c.UrlFetchApp.fetch;
    s.c.UrlFetchApp.fetch=(url,request)=>{
      if(url.includes('/Master_Products?') && url.includes('pageToken=300')) {
        if(failure==='http') return reply(503,{});
        const body=JSON.parse(fetch(url,request).getContentText()); body.nextPageToken='300'; return reply(200,body);
      }
      return fetch(url,request);
    };
    const result=s.c.backupAllDataToBackup_(); assert.equal(result.success,false);
    assert.equal([...s.files.values()].filter(f=>f.name.startsWith('syy-shop-backup_')&&!f.trashed).length,0);
    assert.equal(s.commits.length,0); assert.equal(s.calls.filter(x=>x.url.endsWith(':rollback')).length,1);
  }
});

test('durable secret changes abort backup while transient cache and rate changes do not', () => {
  for(const changed of ['AUTH_MASTER_KEY','cache_gen_Master_Products','auth_rate_login_1']) {
    const s=setup(); s.seed(); const fetch=s.c.UrlFetchApp.fetch; let once=false;
    s.c.UrlFetchApp.fetch=(url,request)=>{
      const response=fetch(url,request);
      if(!once && url.includes('transaction=')){once=true;s.props[changed]='changed';} return response;
    };
    const result=s.c.backupAllDataToBackup_(); assert.equal(result.success,changed!=='AUTH_MASTER_KEY');
    if(result.success) {
      const bundle=JSON.parse(s.files.get(result.fileId).getBlob().getDataAsString());
      assert(!Object.hasOwn(bundle.scriptProperties,changed));
    }
  }
});

test('failed or lost second restore commit stops later batches and refuses automatic restart', () => {
  for(const lost of [false,true]) {
    const s=setup(); for(let i=0;i<1001;i++) s.put('Master_Products/P'+i,{Current_Stock:i});
    const {result}=backup(s), source=plain([...s.docs]); const fetch=s.c.UrlFetchApp.fetch; let commits=0;
    s.c.UrlFetchApp.fetch=(url,request)=>{
      if(url.endsWith(':commit') && ++commits===2) {
        if(!lost) return reply(503,{error:{status:'UNAVAILABLE'}});
        s.c.loseCommitResponse=true;
      }
      return fetch(url,request);
    };
    const restored=restore(s,result.fileId);
    assert.equal(restored.success,false); assert.equal(restored.restored.Master_Products.restored,450);
    assert.equal(commits,2);
    assert.equal([...s.docs.keys()].filter(x=>x.startsWith('staging-shop::')).length,lost?900:450);
    assert.deepEqual(plain([...s.docs].filter(([key])=>!key.startsWith('staging-shop::'))),source);
    assert.equal(restore(s,result.fileId).success,false); assert.equal(commits,2);
  }
});

test('expired and cross-project document cursors are rejected before any query', () => {
  const s=setup(); s.c.readTime=new Date().toISOString();
  for(let i=0;i<60;i++)s.put('Master_Tax_Invoice/T'+i,{Invoice_Date:'2026-10-11'});
  const page=s.c.queryDocumentPage_('Master_Tax_Invoice','Invoice_Date',2569,{});
  const cursor=JSON.parse(Buffer.from(page.pageInfo.nextCursor,'base64').toString());
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64');
  for(const bad of [{...cursor,readTime:new Date(Date.now()-3300001).toISOString()},
    {...cursor,readTime:new Date(Date.now()+120000).toISOString()},
    {...cursor,name:cursor.name.replace('projects/syy-shop/','projects/staging-shop/')}]) {
    const requests=s.calls.length;
    assert.throws(()=>s.c.queryDocumentPage_('Master_Tax_Invoice','Invoice_Date',2569,{cursor:encode(bad)}),/หมดอายุ|ไม่ถูกต้อง/);
    assert.equal(s.calls.length,requests);
  }
});

test('restore batches bound UTF-8 payload size as well as the number of writes', () => {
  const s=setup(), payload='ก'.repeat(50000);
  for(let i=0;i<72;i++) s.put('Master_Products/P'+i,{Product_Name:'Part '+i,Note:payload});
  const {result}=backup(s), fetch=s.c.UrlFetchApp.fetch, requestSizes=[];
  s.c.UrlFetchApp.fetch=(url,request)=>{
    if(url.endsWith(':commit')) {
      const size=Buffer.byteLength(request.payload);requestSizes.push(size);
      if(size>10*1024*1024)return reply(413,{error:{status:'RESOURCE_EXHAUSTED'}});
    }
    return fetch(url,request);
  };
  const restored=restore(s,result.fileId);
  assert.equal(restored.success,true,JSON.stringify(restored.errors));
  assert.equal(restored.restored.Master_Products.restored,72);
  assert(requestSizes.length>1);assert(requestSizes.every(bytes=>bytes<=8*1024*1024));
  for(let i=0;i<72;i++)assert.equal(s.value('staging-shop::Master_Products/P'+i,'Note'),payload);
});
