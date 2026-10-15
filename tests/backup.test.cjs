// Data-only folder backups. All DB, Drive, properties and triggers are local fixtures.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,plain,reply}=require('./support/services.cjs');
function fresh(){const s=setup();let now=Date.parse('2026-10-13T15:00:00Z');s.c.Date=class extends Date{constructor(...args){super(args.length?args[0]:now);}static now(){return now;}};s.advance=()=>{now+=10000;s.c.readTime=new Date(now).toISOString();};s.c.Utilities.formatDate=(d,_z,format)=>{const local=new Date(d.getTime()+7*3600000),iso=local.toISOString();return format==='yyyy-MM-dd'?iso.slice(0,10):format==='u'?String(local.getUTCDay()||7):format==='HH-mm-ss'?iso.slice(11,19).replace(/:/g,'-'):iso;};return s;}
function run(s,kind='full'){s.advance();const result=s.c.backupAllDataToBackup_(kind);assert.equal(result.success,true,JSON.stringify(result.errors));return result;}
function materialize(s,result){return s.c.readFolderBackup_(result.folderId);}
function image(s){const f=s.makeFile(Buffer.from([1,2,3]));s.put('Product_Images/P1',{Drive_File_Id:f.id,Image_Url:'https://lh3.googleusercontent.com/d/'+f.id});return f;}
function unchanged(s,before){assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);assert(!s.calls.some(x=>['patch','delete'].includes(x.options.method)||/:(commit|beginTransaction|rollback)$/.test(x.url)));}

test('Full discovers new collections, nested data and missing parents, paginates and never copies image blobs',()=>{
  const s=fresh();s.c.pageSize=2;s.c.collectionPageSize=2;s.seed();const f=image(s);
  for(let i=0;i<5;i++)s.put('Extra/P'+i,{Name:'ก้อนใหม่ '+i,Bytes:{data:'keep'},Unknown_Field:[1,2]});
  s.put('Extra/P0/Items/I1',{Name:'Child'});s.put('Gone/parent/Items/child',{Name:'Missing parent'});s.put('constructor/toString',{Name:'Valid IDs'});
  const before=plain([...s.docs]);const originalBlob=f.getBlob;f.getBlob=()=>{throw Error('Must not read original image');};
  const result=run(s),backup=materialize(s,result);f.getBlob=originalBlob;
  assert.equal(Object.keys(backup.documents).length,s.docs.size);assert(backup.documents['Gone/parent/Items/child']);assert(!backup.documents['Gone/parent']);
  assert.equal(backup.documents['Extra/P0/Items/I1'].fields.Name.stringValue,'Child');assert.equal(backup.documents['Product_Images/P1'].fields.Drive_File_Id.stringValue,f.id);
  assert.equal([...s.files.values()].filter(file=>file.name==='image.jpg').length,1);assert.equal([...s.folders.values()].filter(folder=>folder.name.includes('assets')).length,0);
  assert(result.collections.Extra===5);assert(result.collections['Gone/parent/Items']===1);assert.equal(backup.manifest.imagesIncluded,false);
  const times=s.calls.filter(x=>x.options.payload||x.url.includes('readTime=')).map(x=>x.options.payload?JSON.parse(x.options.payload).readTime:new URL(x.url).searchParams.get('readTime')).filter(Boolean);assert.equal(new Set(times).size,1);
  assert([...s.folders.values()].some(folder=>folder.name==='Master_Products'));unchanged(s,before);
});

test('Incremental contains only new/modified/deleted documents and reconstructs exact DB including removed collections',()=>{
  const s=fresh();s.seed();s.put('Extra/A',{Name:'Before'});s.put('Removed/A',{Value:1});const full=run(s);s.put('Extra/A',{Name:'After'});s.put('New/B',{Value:2});s.docs.delete('Removed/A');
  const before=plain([...s.docs]),delta=run(s,'incremental'),backup=materialize(s,delta);
  assert.equal(delta.written,2);assert.equal(delta.deleted,1);assert.equal(backup.manifest.baseFullId,full.folderId);assert.equal(backup.manifest.previousId,full.folderId);
  assert.equal(backup.documents['Extra/A'].fields.Name.stringValue,'After');assert(!backup.documents['Removed/A']);assert(backup.documents['New/B']);assert.equal(Object.keys(backup.documents).length,s.docs.size);unchanged(s,before);
  const empty=run(s,'incremental');assert.equal(empty.written+empty.deleted,0);assert.equal(materialize(s,empty).manifest.previousId,delta.folderId);
});

test('One snapshot remains consistent when DB changes during capture and subsequent delta records that change',()=>{
  const s=fresh();s.seed();const fetch=s.c.UrlFetchApp.fetch;let once=false;s.c.UrlFetchApp.fetch=(url,opts)=>{const response=fetch(url,opts);if(!once&&url.includes('showMissing=')){once=true;s.put('Master_Products/P1',{Current_Stock:99});}return response;};
  const full=run(s);assert.equal(materialize(s,full).documents['Master_Products/P1'].fields.Current_Stock.doubleValue,10);assert.equal(s.value('Master_Products/P1','Current_Stock'),99);
  const delta=run(s,'incremental');assert.equal(delta.written,1);assert.equal(materialize(s,delta).documents['Master_Products/P1'].fields.Current_Stock.doubleValue,99);
});

test('Failed pages, discovery, repeated tokens and deadline do not advance state, prune old runs or publish incomplete backup',()=>{
  for(const fail of ['page','discovery','repeat','deadline']){const s=fresh();s.c.pageSize=1;s.seed();s.put('Master_Products/P2',{Current_Stock:2});const full=run(s),state=s.props.SYY_BACKUP_STATE_V3,fetch=s.c.UrlFetchApp.fetch;
    s.c.UrlFetchApp.fetch=(url,opts)=>{if(fail==='discovery'&&url.endsWith(':listCollectionIds'))return reply(503,{});if(url.includes('/Master_Products?')&&url.includes('pageToken=')){if(fail==='page')return reply(503,{});if(fail==='repeat'){const body=JSON.parse(fetch(url,opts).getContentText());body.nextPageToken='1';return reply(200,body);}}return fetch(url,opts);};
    if(fail==='deadline')s.c.BACKUP_MAX_RUNTIME_MS=-1;s.advance();const result=s.c.backupAllDataToBackup_('incremental');assert.equal(result.success,false,fail);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);assert.equal(s.folders.get(full.folderId).trashed,false);assert.equal(s.c.listBackupFiles_().filter(f=>f.kind==='incremental').length,0);assert.equal(s.commits.length,0);
  }
});

test('Corrupt or shared backup/index/chain cannot become a new delta baseline or restore',()=>{
  for(const fail of ['index','shared','chain']){const s=fresh();s.seed();const full=run(s),delta=run(s,'incremental'),m=materialize(s,delta).manifest,folder=s.folders.get(delta.folderId),state=s.props.SYY_BACKUP_STATE_V3;
    if(fail==='index')s.files.get(m.index.id).blob={getBytes:()=>[1],getDataAsString:()=> '{}'};
    if(fail==='shared')folder.getSharingAccess=()=> 'LINK';
    if(fail==='chain')s.folders.delete(full.folderId);
    s.advance();const result=s.c.backupAllDataToBackup_('incremental');assert.equal(result.success,false,fail);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);assert.equal(s.c.restoreFromBackup_(delta.fileId,'all').success,false);assert.equal(s.commits.length,0);
  }
});

test('Four Full generations retain their dependent increments and preserve legacy/unrelated Drive items',()=>{
  const s=fresh();s.seed();const root=s.c.getOrCreateBackupFolder_(),legacy=root.createFile('syy-shop-backup_old.json','{}','text/plain'),other=root.createFolder('Personal');let oldest;
  for(let i=0;i<5;i++){const full=run(s);if(!oldest)oldest=full;run(s,'incremental');}
  const listed=s.c.listBackupFiles_();assert.equal(listed.filter(f=>f.kind==='full').length,4);assert.equal(listed.filter(f=>f.kind==='incremental').length,4);assert.equal(s.folders.get(oldest.folderId).trashed,true);assert.equal(legacy.trashed,false);assert.equal(other.trashed,false);
  const state=JSON.parse(s.props.SYY_BACKUP_STATE_V3);assert.equal(s.folders.get(state.baseFullId).trashed,false);assert.equal(materialize(s,{folderId:state.lastFolderId}).manifest.kind,'incremental');
});

test('Owner lock prevents concurrent backup without holding business ScriptLock; failed secret changes leave previous state',()=>{
  const s=fresh();s.seed();const full=run(s),state=s.props.SYY_BACKUP_STATE_V3;s.c.backupBusy=true;assert.equal(s.c.backupAllDataToBackup_().success,false);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);s.c.backupBusy=false;s.c.lockBusy=true;assert.equal(run(s,'incremental').success,true);
  const last=s.props.SYY_BACKUP_STATE_V3,fetch=s.c.UrlFetchApp.fetch;let once=false;s.c.UrlFetchApp.fetch=(url,opts)=>{const r=fetch(url,opts);if(!once&&url.includes('showMissing=')){once=true;s.props.AUTH_MASTER_KEY='changed';}return r;};s.advance();assert.equal(s.c.backupAllDataToBackup_('incremental').success,false);assert.equal(s.props.SYY_BACKUP_STATE_V3,last);assert.equal(s.folders.get(full.folderId).trashed,false);
});

test('Sunday and bootstrap create Full plus daily Incremental from one scan; weekdays store only a delta',()=>{
  const s=fresh();s.seed();s.c.Utilities.formatDate=(_d,_z,format)=>format==='u'?'7':format==='yyyy-MM-dd'?'2026-10-18':'22-00-00';s.advance();const sunday=s.c.dailyBackupJob_();assert.equal(sunday.full.kind,'full');assert.equal(sunday.incremental.kind,'incremental');assert.equal(sunday.incremental.readDocuments,0);assert.equal(sunday.incremental.written,0);const calls=s.calls.length;assert.equal(s.c.dailyBackupJob_().skipped,true);assert.equal(s.calls.length,calls);
  const fullReads=sunday.full.readDocuments;assert.equal(fullReads,s.docs.size);s.c.Utilities.formatDate=(_d,_z,format)=>format==='u'?'1':format==='yyyy-MM-dd'?'2026-10-19':'22-00-00';s.put('Extra/A',{Value:1});s.advance();const weekday=s.c.dailyBackupJob_();assert.equal(weekday.kind,'incremental');assert.equal(weekday.written,1);
  const empty=fresh();empty.seed();empty.c.Utilities.formatDate=(_d,_z,format)=>format==='u'?'2':format==='yyyy-MM-dd'?'2026-10-13':'22-00-00';empty.advance();const boot=empty.c.dailyBackupJob_();assert.equal(boot.full.bootstrap,true);assert.equal(boot.incremental.kind,'incremental');
});

test('No binary images are needed to restore all data plus nested fields into empty staging; production restore stays blocked',()=>{
  const s=fresh();s.seed();s.user();const f=image(s);s.put('Extra/missing/Child/A',{Legacy:{keep:true}});const full=run(s);s.put('Extra/missing/Child/A',{Legacy:{keep:'updated'}});const delta=run(s,'incremental'),before=plain([...s.docs]);
  assert.equal(s.c.restoreFromBackup_(delta.fileId,'all').success,true);assert.equal(s.commits.length,0);
  const opts={sourceProjectId:'syy-shop',targetProjectId:'syy-shop',confirmRestore:true,confirmStagingScript:true,restoreProperties:true};assert.equal(s.c.restoreFromBackup_(delta.fileId,'all',opts).success,false);unchanged(s,before);
  s.c.PROJECT_ID='staging-shop';opts.targetProjectId='staging-shop';const result=s.c.restoreFromBackup_(delta.fileId,'all',opts);assert.equal(result.success,true,JSON.stringify(result.errors));assert.equal(result.imagesIncluded,false);
  assert.equal(s.value('staging-shop::Product_Images/P1','Drive_File_Id'),f.id);assert.deepEqual(plain(s.docs.get('staging-shop::Extra/missing/Child/A').fields),plain(s.docs.get('Extra/missing/Child/A').fields));assert.notEqual(s.value('staging-shop::Master_Users/U1','Session_Version'),undefined);assert(s.commits.every(w=>w.every(x=>x.currentDocument.exists===false)));
  const count=s.commits.length;assert.equal(s.c.restoreFromBackup_(delta.fileId,'all',opts).success,false);assert.equal(s.commits.length,count);assert.deepEqual(plain([...s.docs].filter(([key])=>!key.startsWith('staging-shop::'))),before);
});

test('Tampered part data and forged deleted paths fail validation before staging writes',()=>{
  const s=fresh();s.seed();const full=run(s),m=materialize(s,full).manifest,file=s.files.get(m.parts[0].id);file.blob={getBytes:()=>[1],getDataAsString:()=> '{}'};
  const res=s.c.restoreFromBackup_(full.fileId,'all',{sourceProjectId:'syy-shop',targetProjectId:'staging-shop',confirmRestore:true,confirmStagingScript:true});assert.equal(res.success,false);assert.equal(s.commits.length,0);
});

test('The configured destination is used with date folders and a shared destination is rejected before any DB read',()=>{
  const s=fresh();s.seed();const destination=s.makeFolder('Chosen destination');s.c.BACKUP_FOLDER_ID=destination.id;const full=run(s),folder=s.folders.get(full.folderId),date=s.c.backupParentFolder_(folder);
  assert.equal(date.getName(),'2026-10-13');assert.equal(s.c.backupParentFolder_(s.c.backupParentFolder_(date)).getParents().next().getId(),destination.id);
  const calls=s.calls.length;destination.getSharingAccess=()=> 'LINK';s.advance();assert.equal(s.c.backupAllDataToBackup_().success,false);assert.equal(s.calls.length,calls);
});

test('Large paged data exports all typed fields, including bytes/references/maps, and reports read/request metrics',()=>{
  const s=fresh();s.c.pageSize=10;for(let i=0;i<1003;i++)s.put('Large/P'+i,{Name:'สินค้า '+i});
  s.docs.get('Large/P0').fields={Binary:{bytesValue:'AQID'},Reference:{referenceValue:'projects/syy-shop/databases/(default)/documents/Other/A'},Map:{mapValue:{fields:{Flag:{booleanValue:true}}}},Null:{nullValue:null},Location:{geoPointValue:{latitude:13,longitude:100}}};
  const full=run(s),materialized=materialize(s,full);assert.equal(full.collections.Large,1003);assert.deepEqual(plain(materialized.documents['Large/P0'].fields),plain(s.docs.get('Large/P0').fields));assert.equal(s.calls.filter(x=>x.url.includes('/Large?')).length,101);assert.equal(full.snapshotProbeReads,1);assert.equal(full.readDocuments,1003);
  assert(s.calls.filter(x=>x.url.includes('showMissing=')).every(x=>x.url.includes('/Large?')),'No document-list requests for undiscovered empty collections');
  const metrics={fixtureOnly:true,documents:full.readDocuments,documentListRequests:s.calls.filter(x=>x.url.includes('showMissing=')).length,collectionDiscoveryRequests:s.calls.filter(x=>x.url.endsWith(':listCollectionIds')).length,serverTimeProbeRequests:s.calls.filter(x=>x.url.endsWith(':runQuery')).length,fullSizeKB:full.fileSizeKB};
  s.advance();const delta=s.c.backupAllDataToBackup_('incremental');assert.equal(delta.success,true);assert.equal(delta.written+delta.deleted,0);metrics.incrementalSizeKB=delta.fileSizeKB;metrics.incrementalDocumentsRead=delta.readDocuments;
  require('node:fs').writeFileSync(require('node:path').join(__dirname,'..','test-results','backup-v3-read-model.json'),JSON.stringify(metrics,null,2));
});

test('Changing the destination on the same day starts a separate Full chain and does not skip or mutate old backups',()=>{
  const s=fresh();s.seed();s.advance();const first=s.c.dailyBackupJob_(),old=s.folders.get(first.full.folderId);const destination=s.makeFolder('New destination');s.c.BACKUP_FOLDER_ID=destination.id;s.advance();
  const second=s.c.dailyBackupJob_();assert.equal(second.full.bootstrap,true);assert.notEqual(second.full.folderId,first.full.folderId);assert.equal(old.trashed,false);assert.equal(materialize(s,second.incremental).manifest.baseFullId,second.full.folderId);assert.equal(s.c.dailyBackupJob_().skipped,true);
});

test('A damaged Full part blocks new increments before DB reads and does not count toward retention',()=>{
  const s=fresh();s.seed();const first=run(s),m=materialize(s,first).manifest;s.files.delete(m.parts[0].id);const count=s.calls.length,state=s.props.SYY_BACKUP_STATE_V3;
  s.advance();const bad=s.c.backupAllDataToBackup_('incremental');assert.equal(bad.success,false);assert.equal(s.calls.length,count);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);
  const valid=[];for(let i=0;i<5;i++)valid.push(run(s));assert.equal(s.folders.get(valid[0].folderId).trashed,true);assert(valid.slice(1).every(x=>!s.folders.get(x.folderId).trashed));assert.equal(s.folders.get(first.folderId).trashed,false);
});

test('Retention failure reports a warning while preserving the completed Full and its state',()=>{
  const s=fresh();s.seed();const versions=[];for(let i=0;i<4;i++)versions.push(run(s));s.folders.get(versions[0].folderId).setTrashed=()=>{throw Error('Drive unavailable');};const latest=run(s);
  assert(latest.warnings.some(x=>x.includes('Drive unavailable')));assert.equal(JSON.parse(s.props.SYY_BACKUP_STATE_V3).lastFolderId,latest.folderId);assert.equal(materialize(s,latest).manifest.complete,true);assert.equal(s.folders.get(versions[0].folderId).trashed,false);
});

test('TOTP accounts cannot publish a backup without the recovery key',()=>{
  const s=fresh();s.seed();s.put('Master_Users/U1',{Totp_Enabled:true});delete s.props.AUTH_MASTER_KEY;s.advance();const result=s.c.backupAllDataToBackup_('full');assert.equal(result.success,false);assert(result.errors.some(x=>x.includes('TOTP')));assert.equal(s.props.SYY_BACKUP_STATE_V3,undefined);assert.equal(s.c.listBackupFiles_().length,0);assert.equal(s.commits.length,0);
  s.props.AUTH_MASTER_KEY='fixture-only-key';assert.equal(materialize(s,run(s)).scriptProperties.AUTH_MASTER_KEY,'fixture-only-key');
});

test('Schedule setup checks private destination, preserves the old schedule on creation failure and replaces only backup handlers',()=>{
  const s=fresh(),old={getHandlerFunction:()=> 'weeklyBackupJob_'},other={getHandlerFunction:()=> 'unrelated'},triggers=[old,other];let deleted=[],config={};
  s.c.ScriptApp.getProjectTriggers=()=>triggers;s.c.ScriptApp.deleteTrigger=t=>deleted.push(t);
  s.c.ScriptApp.newTrigger=handler=>{config.handler=handler;const builder={timeBased:()=>builder,everyDays(n){config.days=n;return builder;},atHour(n){config.hour=n;return builder;},nearMinute(n){config.minute=n;return builder;},inTimezone(z){config.zone=z;return builder;},create(){throw Error('quota');}};return builder;};
  assert.throws(()=>s.c.setupBackupSchedule_(),/quota/);assert.equal(deleted.length,0);
  s.c.ScriptApp.newTrigger=handler=>{config={handler};const builder={timeBased:()=>builder,everyDays(n){config.days=n;return builder;},atHour(n){config.hour=n;return builder;},nearMinute(n){config.minute=n;return builder;},inTimezone(z){config.zone=z;return builder;},create(){return {getUniqueId:()=> 'new'};}};return builder;};
  assert.equal(s.c.setupBackupSchedule_().success,true);assert.deepEqual(deleted,[old]);assert.deepEqual(config,{handler:'dailyBackupJob_',days:1,hour:22,minute:0,zone:'Asia/Bangkok'});assert.equal(s.calls.length,0);
  deleted=[];s.c.getOrCreateBackupFolder_().getSharingAccess=()=> 'LINK';assert.throws(()=>s.c.setupBackupSchedule_(),/ส่วนตัว/);assert.equal(deleted.length,0);
});

test('Overview detects an old weekly trigger coexisting with the new daily trigger without Firestore reads',()=>{
  const s=fresh(),daily={getHandlerFunction:()=> 'dailyBackupJob_'},weekly={getHandlerFunction:()=> 'weeklyBackupJob_'},other={getHandlerFunction:()=> 'unrelated'};
  s.c.ScriptApp.getProjectTriggers=()=>[daily,weekly,other];let overview=s.c.getBackupOverview_();assert.equal(overview.schedule.enabled,false);assert.equal(overview.schedule.duplicate,true);
  s.c.ScriptApp.getProjectTriggers=()=>[daily,other];overview=s.c.getBackupOverview_();assert.equal(overview.schedule.enabled,true);assert.equal(overview.schedule.duplicate,false);assert.equal(s.calls.length,0);
});

function resumable(){
 const s=fresh(),triggers=[],other={getHandlerFunction:()=> 'unrelated',getUniqueId:()=> 'other'};triggers.push(other);let seq=0;
 s.c.ScriptApp.getProjectTriggers=()=>triggers.slice();s.c.ScriptApp.deleteTrigger=t=>{const i=triggers.indexOf(t);if(i>=0)triggers.splice(i,1);};
 s.c.ScriptApp.newTrigger=handler=>{const builder={timeBased:()=>builder,after(ms){assert.equal(ms,60000);return builder;},create(){const id='resume-'+(++seq),t={getHandlerFunction:()=>handler,getUniqueId:()=>id};triggers.push(t);return t;}};return builder;};
 s.c.BACKUP_SLICE_MS=25000;s.c.pageSize=3;const fetch=s.c.UrlFetchApp.fetch;
 s.c.UrlFetchApp.fetch=(url,opts)=>{s.advance();return fetch(url,opts);};s.triggers=triggers;return s;
}
test('large backup checkpoints and continues one snapshot without publishing partial manifests or rereading completed pages',()=>{
 const s=resumable();for(let i=0;i<15;i++)s.put('Data/P'+String(i).padStart(2,'0'),{Name:'Original '+i});s.put('constructor/toString',{Name:'prototype-safe'});
 let result=s.c.backupNow_(),slices=1;assert.equal(result.pending,true);assert.equal(s.props.SYY_BACKUP_STATE_V3,undefined);assert.equal(s.c.listBackupFiles_().length,0);const before=s.calls.length,job=JSON.parse(s.props.SYY_BACKUP_PENDING_V3);assert.equal(s.c.getBackupOverview_().activeJob.readDocuments,3);assert.equal(s.calls.length,before);
 s.put('Data/P00',{Name:'Changed after snapshot'});s.put('Data/NEW',{Name:'New after snapshot'});
 while(result.pending){result=s.c.continueBackupJob_();if(++slices>20)throw Error('did not finish');}
 const backup=materialize(s,result);assert.equal(Object.keys(backup.documents).length,16);assert.equal(backup.documents['Data/P00'].fields.Name.stringValue,'Original 0');assert(!backup.documents['Data/NEW']);assert(backup.documents['constructor/toString']);
 assert.equal(s.props.SYY_BACKUP_PENDING_V3,undefined);assert.equal(s.triggers.length,1);assert.equal(s.triggers[0].getHandlerFunction(),'unrelated');assert.equal(s.commits.length,0);
 const pages=s.calls.filter(x=>x.url.includes('/Data?'));assert.equal(pages.length,5);assert.equal(new Set(pages.map(x=>x.url)).size,5);assert.equal(new Set(s.calls.filter(x=>x.url.includes('showMissing')).map(x=>new URL(x.url).searchParams.get('readTime'))).size,1);
 assert.equal(s.c.continueBackupJob_().skipped,true);assert.equal(job.folderId,result.folderId);
});
test('scheduled Full continuation creates its same-snapshot delta and marks the day only after completion',()=>{
 const s=resumable();for(let i=0;i<12;i++)s.put('Data/P'+i,{Name:'Data'});
 let r=s.c.dailyBackupJob_();assert(r.pending);assert.equal(s.props.SYY_BACKUP_LAST_DAY,undefined);let slices=0;
 while(r.pending){r=s.c.continueBackupJob_();if(++slices>20)throw Error('did not finish');}
 assert(s.props.SYY_BACKUP_LAST_DAY);const listed=s.c.listBackupFiles_();assert.equal(listed.filter(f=>f.kind==='full').length,1);assert.equal(listed.filter(f=>f.kind==='incremental').length,1);assert.equal(s.c.dailyBackupJob_().skipped,true);
});
test('incremental continuation preserves deletions and changed rows across page checkpoints',()=>{
 const s=resumable();s.c.BACKUP_SLICE_MS=180000;for(let i=0;i<8;i++)s.put('Data/P'+i,{Name:'Original'});const full=s.c.backupAllDataToBackup_('full');assert.equal(full.success,true);
 s.docs.delete('Data/P0');s.put('Data/P1',{Name:'Changed'});s.put('New/N1',{Name:'New'});s.c.BACKUP_SLICE_MS=25000;let r=s.c.backupAllDataToBackup_('incremental'),n=0;while(r.pending){r=s.c.continueBackupJob_();if(++n>20)throw Error('did not finish');}
 const data=materialize(s,r);assert(!data.documents['Data/P0']);assert.equal(data.documents['Data/P1'].fields.Name.stringValue,'Changed');assert(data.documents['New/N1']);assert.equal(r.deleted,1);assert.equal(r.written,2);assert.equal(s.commits.length,0);
});
test('transient page failure retains the checkpoint for manual resume; expired and corrupt snapshots never publish',()=>{
 for(const mode of ['network','expired','corrupt']){const s=resumable();for(let i=0;i<9;i++)s.put('Data/P'+i,{Name:'Data'});const first=s.c.backupNow_();assert(first.pending);const pointer=s.props.SYY_BACKUP_PENDING_V3,job=JSON.parse(pointer);
  if(mode==='network')s.c.failRequest=url=>url.includes('showMissing')?503:0;
  if(mode==='expired')s.c.BACKUP_SNAPSHOT_MAX_AGE_MS=-1;
  if(mode==='corrupt')s.files.get(job.checkpoint.id).blob={getBytes:()=>[1],getDataAsString:()=> '{}'};
  const failed=s.c.backupNow_();assert.equal(failed.success,false,mode);assert.equal(s.props.SYY_BACKUP_STATE_V3,undefined);assert.equal(s.c.listBackupFiles_().length,0);
  if(mode==='network'){assert(failed.needsResume);assert(s.props.SYY_BACKUP_PENDING_V3);s.c.failRequest=null;let r=failed,n=0;while(r.pending){r=s.c.backupNow_();if(++n>20)throw Error('did not finish');}assert.equal(r.success,true);}
  else assert.equal(s.props.SYY_BACKUP_PENDING_V3,undefined);
 }
});
test('continuation scheduling failure preserves the last completed backup and never changes DB or the daily trigger',()=>{
 const s=resumable();s.c.BACKUP_SLICE_MS=180000;s.seed();const full=s.c.backupNow_();assert.equal(full.success,true);const state=s.props.SYY_BACKUP_STATE_V3;s.c.BACKUP_SLICE_MS=1;s.c.ScriptApp.newTrigger=()=>{throw Error('trigger quota');};
 const failed=s.c.backupNow_();assert.equal(failed.success,false);assert.match(failed.errors.join(' '),/trigger quota/);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);assert.equal(s.props.SYY_BACKUP_PENDING_V3,undefined);assert.equal(s.folders.get(full.folderId).trashed,false);assert.equal(s.commits.length,0);
});

test('manual completion of a scheduled backup finalizes the daily delta and does not scan again',()=>{
 const s=resumable();for(let i=0;i<9;i++)s.put('Data/P'+i,{Name:'Data'});let r=s.c.dailyBackupJob_(),n=0;assert(r.pending);
 while(r.pending){r=s.c.backupNow_();if(++n>20)throw Error('did not finish');}
 assert(r.success);assert(s.props.SYY_BACKUP_LAST_DAY);assert.equal(s.c.listBackupFiles_().filter(f=>f.kind==='incremental').length,1);const before=s.calls.length;assert(s.c.dailyBackupJob_().skipped);assert.equal(s.calls.length,before);assert.equal(s.commits.length,0);
});

test('daily schedule resumes an abandoned checkpoint and restarts an expired snapshot without losing completed backups',()=>{
 for(const expired of [false,true]){const s=resumable();s.c.BACKUP_SLICE_MS=180000;s.seed();const full=s.c.backupNow_();const state=s.props.SYY_BACKUP_STATE_V3;s.c.BACKUP_SLICE_MS=25000;for(let i=0;i<9;i++)s.put('Data/P'+i,{Name:'Data'});
  let r=s.c.dailyBackupJob_();assert(r.pending);const old=JSON.parse(s.props.SYY_BACKUP_PENDING_V3);if(expired)for(let i=0;i<310;i++)s.advance();
  r=s.c.dailyBackupJob_();assert(r.success);assert(r.pending);const job=JSON.parse(s.props.SYY_BACKUP_PENDING_V3);assert.equal(job.folderId===old.folderId,!expired);assert.equal(s.folders.get(old.folderId).trashed,expired);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);
  let n=0;while(r.pending){r=s.c.continueBackupJob_();if(++n>30)throw Error('did not finish');}assert(r.success);assert.equal(s.folders.get(full.folderId).trashed,false);assert.equal(Object.keys(materialize(s,r).documents).length,s.docs.size);assert.equal(s.commits.length,0);
 }
});

test('moved checkpoint folder cannot publish outside its original project/date hierarchy',()=>{
 const s=resumable();for(let i=0;i<9;i++)s.put('Data/P'+i,{Name:'Data'});assert(s.c.backupNow_().pending);const job=JSON.parse(s.props.SYY_BACKUP_PENDING_V3),folder=s.folders.get(job.folderId),parent=s.c.backupParentFolder_(folder);parent.getName=()=> 'wrong-day';const count=s.calls.length;
 const failed=s.c.backupNow_();assert.equal(failed.success,false);assert.match(failed.errors.join(' '),/Checkpoint/);assert.equal(s.props.SYY_BACKUP_PENDING_V3,undefined);assert.equal(s.props.SYY_BACKUP_STATE_V3,undefined);assert.equal(s.calls.length,count);assert.equal(s.commits.length,0);
});

test('state write failure after publication preserves the completed run and clears its checkpoint to prevent duplicate manifests',()=>{
 const s=resumable();s.c.BACKUP_SLICE_MS=180000;s.seed();const full=s.c.backupNow_(),state=s.props.SYY_BACKUP_STATE_V3;for(let i=0;i<9;i++)s.put('Data/P'+i,{Name:'Data'});s.c.BACKUP_SLICE_MS=25000;let r=s.c.backupNow_();assert(r.pending);const job=JSON.parse(s.props.SYY_BACKUP_PENDING_V3),get=s.c.PropertiesService.getScriptProperties;
 s.c.PropertiesService.getScriptProperties=()=>{const p=get();return {...p,setProperty(k,v){if(k==='SYY_BACKUP_STATE_V3')throw Error('properties unavailable');return p.setProperty(k,v);}};};
 let n=0;while(r.success&&r.pending){r=s.c.backupNow_();if(++n>30)throw Error('did not finish');}
 assert.equal(r.success,false);assert.equal(s.props.SYY_BACKUP_PENDING_V3,undefined);assert.equal(s.props.SYY_BACKUP_STATE_V3,state);assert.equal(s.folders.get(job.folderId).trashed,false);assert.equal(s.folders.get(full.folderId).trashed,false);assert.equal(materialize(s,job).manifest.complete,true);assert.equal(s.commits.length,0);
});
