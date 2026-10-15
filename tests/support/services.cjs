const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const plain=x=>JSON.parse(JSON.stringify(x)),reply=(code,body)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)}),iterator=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};
function setup(options={}){
  const docs=new Map(),cache=new Map(),props={AUTH_MASTER_KEY:'test-only-key'},calls=[],commits=[],files=new Map(),folders=new Map(),snapshots=new Map();
  let version=1,sequence=0;
  const owner={getEmail:()=> 'owner@example.invalid'};
  function blob(data){const b=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:Uint8Array.from(data));return {getBytes:()=>Array.from(b),getDataAsString:()=>b.toString('utf8')};}
  const permissions={getOwner:()=>owner,getEditors:()=>[],getViewers:()=>[],getSharingAccess:()=> 'PRIVATE'};
  function makeFile(data,name='image.jpg',parent){
    const id='file-'+(++sequence),item={...permissions,id,name,blob:blob(data),trashed:false,updated:1,
      getId(){return id;},getName(){return item.name;},setName(n){item.name=n;return item;},getBlob(){return item.blob;},
      getLastUpdated(){return new Date(item.updated);},getDateCreated:()=>new Date(sequence),getSize:()=>item.blob.getBytes().length,
      getUrl:()=> 'https://drive.invalid/'+id,setSharing(){return item;},setTrashed(v){item.trashed=v;return item;},
      getParents:()=>iterator(parent?[parent]:[])};
    files.set(id,item);if(parent)parent.files.push(item);return item;
  }
  function makeFolder(name,parent){
    const id='folder-'+(++sequence),item={...permissions,id,name,files:[],trashed:false,
      getId:()=>id,getName:()=>name,getParents:()=>iterator(parent?[parent]:[]),
      getUrl:()=> 'https://drive.invalid/'+id,getDateCreated:()=>new Date(sequence),
      getFolders:()=>iterator([...folders.values()].filter(f=>!f.trashed&&f.getParents().hasNext()&&f.getParents().next()===item)),
      getFoldersByName:n=>iterator([...folders.values()].filter(f=>!f.trashed&&f.name===n&&f.getParents().hasNext()&&f.getParents().next()===item)),
      getFiles:()=>iterator(item.files.filter(x=>!x.trashed)),
      createFolder:n=>makeFolder(n,item),createFile:(data,name,mime)=>mime?makeFile(name,data,item):makeFile(data?.getBytes?data.getBytes():data,name,item),
      getFilesByType:()=>iterator(item.files.filter(x=>!x.trashed)),getFilesByName:n=>iterator(item.files.filter(x=>x.name===n&&!x.trashed)),
      setTrashed(v){item.trashed=v;return item;}};
    folders.set(id,item);return item;
  }
  function keyFor(name){const project=name.match(/projects\/([^/]+)/)?.[1];return (project && project!=='syy-shop'?project+'::':'')+name.split('/documents/')[1];}
  function checked(doc,pre){return !pre || (pre.exists===undefined || pre.exists===!!doc) && (!pre.updateTime || doc?.updateTime===pre.updateTime);}
  function commit(writes){
    if(c.beforeCommit){const hook=c.beforeCommit;c.beforeCommit=null;hook(writes);}
    for(const w of writes){const key=keyFor(w.update?.name||w.transform?.document||w.delete);if(!checked(docs.get(key),w.currentDocument))return reply(400,{error:{status:'FAILED_PRECONDITION'}});}
    for(const w of writes){
      const name=w.update?.name||w.transform?.document||w.delete,key=keyFor(name),old=docs.get(key);
      if(w.delete){docs.delete(key);continue;}
      const doc=old?plain(old):{name,fields:{}};
      if(w.update){if(w.updateMask)w.updateMask.fieldPaths.forEach(k=>{if(w.update.fields[k])doc.fields[k]=plain(w.update.fields[k]);else delete doc.fields[k];});else doc.fields=plain(w.update.fields);}
      for(const transform of [...(w.transform?.fieldTransforms||[]),...(w.updateTransforms||[])]){
        const k=transform.fieldPath;
        if(transform.increment)doc.fields[k]={doubleValue:Number(c.parseFirestoreValue_(doc.fields[k])||0)+Number(c.parseFirestoreValue_(transform.increment))};
        if(transform.appendMissingElements){const values=doc.fields[k]?.arrayValue?.values||[];for(const x of transform.appendMissingElements.values)if(!values.some(v=>String(c.parseFirestoreValue_(v))===String(c.parseFirestoreValue_(x))))values.push(plain(x));doc.fields[k]={arrayValue:{values}};}
        if(transform.setToServerValue)doc.fields[k]={timestampValue:c.readTime};
      }
      doc.updateTime='v'+(++version);docs.set(key,doc);
    }
    commits.push(plain(writes));
    if(c.loseCommitResponse){c.loseCommitResponse=false;throw Error('network response lost after commit');}
    return reply(200,{commitTime:c.readTime});
  }
  function fetch(url,options={}){
    calls.push({url,options:plain(options)});
    if(c.failRequest){const failure=c.failRequest(url,options);if(failure)return reply(failure,{error:{status:'UNAVAILABLE'}});}
    const u=new URL(url),body=options.payload?JSON.parse(options.payload):{},project=u.pathname.match(/projects\/([^/]+)/)?.[1],key=(project && project!=='syy-shop'?project+'::':'')+decodeURIComponent(u.pathname.split('/documents/')[1]||'');
    const readTime=body.readTime||u.searchParams.get('readTime');if(readTime&&!snapshots.has(readTime))snapshots.set(readTime,new Map([...docs].map(([k,v])=>[k,plain(v)])));
    if(u.pathname.endsWith(':listCollectionIds')){
      const parent=decodeURIComponent(u.pathname.split('/documents')[1].replace(/:listCollectionIds$/,'').replace(/^\//,'')),prefix=(project!=='syy-shop'?project+'::':'')+(parent?parent+'/':'');
      const store=snapshots.get(readTime)||docs,ids=[...new Set([...store.keys()].filter(k=>k.startsWith(prefix)&&(!prefix?k.indexOf('::')<0:true)).map(k=>k.slice(prefix.length).split('/')[0]))].sort();
      const offset=Number(body.pageToken||0),size=c.collectionPageSize||body.pageSize||100;return reply(200,{collectionIds:ids.slice(offset,offset+size),...(offset+size<ids.length?{nextPageToken:String(offset+size)}:{})});
    }
    if(options.method==='get'&&u.searchParams.has('showMissing')){
      const store=snapshots.get(readTime)||docs,prefix=key+'/',all=new Map();
      for(const [docKey,doc] of store){if(!docKey.startsWith(prefix))continue;const tail=docKey.slice(prefix.length),id=tail.split('/')[0],name='projects/'+project+'/databases/(default)/documents/'+decodeURIComponent(u.pathname.split('/documents/')[1])+'/'+id;if(!tail.includes('/'))all.set(id,doc);else if(!all.has(id))all.set(id,{name});}
      const list=[...all.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v),offset=Number(u.searchParams.get('pageToken')||0),size=c.pageSize||Number(u.searchParams.get('pageSize')||100);
      return reply(200,{documents:list.slice(offset,offset+size),...(offset+size<list.length?{nextPageToken:String(offset+size)}:{})});
    }
    if(u.pathname.endsWith(':beginTransaction')){const token='snapshot-'+(++sequence);snapshots.set(token,new Map([...docs].map(([k,v])=>[k,plain(v)])));return reply(200,{transaction:token});}
    if(u.pathname.endsWith(':rollback')){snapshots.delete(body.transaction);return reply(200,{});}
    if(u.pathname.endsWith(':batchGet'))return reply(200,body.documents.map(name=>docs.has(keyFor(name))?{found:docs.get(keyFor(name))}:{missing:name}));
    if(u.pathname.endsWith(':commit'))return commit(body.writes);
    if(u.pathname.endsWith(':runQuery')){
      const q=body.structuredQuery,col=q.from[0].collectionId;
      const store=body.readTime?snapshots.get(body.readTime)||docs:docs;
      let list=[...store].filter(([k])=>k.startsWith((project!=='syy-shop'?project+'::':'')+col+'/')).map(([,v])=>v);
      let filters=q.where?.compositeFilter?.filters || (q.where?[q.where]:[]);
      for(const f of filters){const x=f.fieldFilter,k=x.field.fieldPath,want=x.value.referenceValue||c.parseFirestoreValue_(x.value);list=list.filter(doc=>{const v=k==='__name__'?doc.name:c.parseFirestoreValue_(doc.fields[k]);return v!=null && (x.op==='ARRAY_CONTAINS'?Array.isArray(v)&&v.includes(want):x.op==='IN'?want.includes(v):x.op==='EQUAL'?v===want:x.op==='LESS_THAN'?v<want:x.op==='LESS_THAN_OR_EQUAL'?v<=want:x.op==='GREATER_THAN'?v>want:v>=want);});}
      if(q.orderBy){const get=(doc,k)=>k==='__name__'?doc.name:c.parseFirestoreValue_(doc.fields[k]);
        list=list.filter(doc=>q.orderBy.every(order=>get(doc,order.field.fieldPath)!=null));
        list.sort((a,b)=>{for(const order of q.orderBy){const av=get(a,order.field.fieldPath),bv=get(b,order.field.fieldPath);if(av!==bv)return (av<bv?-1:1)*(order.direction==='DESCENDING'?-1:1);}return 0;});
        if(q.startAt)list=list.filter(doc=>{for(let i=0;i<q.orderBy.length;i++){const av=get(doc,q.orderBy[i].field.fieldPath),value=q.startAt.values[i],bv=value.referenceValue||c.parseFirestoreValue_(value);if(av!==bv)return (av<bv?-1:1)*(q.orderBy[i].direction==='DESCENDING'?-1:1)>0;}return q.startAt.before;});
      }
      if(!body.readTime)snapshots.set(c.readTime,new Map([...docs].map(([k,v])=>[k,plain(v)])));
      if(q.limit)list=list.slice(0,q.limit);
      return reply(200,list.length?list.map(document=>({document,readTime:c.readTime})):[{readTime:c.readTime}]);
    }
    if(options.method==='get' && key && !key.includes('/')){
      const store=snapshots.get(u.searchParams.get('transaction'))||docs;
      const all=[...store].filter(([k])=>k.startsWith(key+'/')).map(([,v])=>v),offset=Number(u.searchParams.get('pageToken')||0),size=c.pageSize||Number(u.searchParams.get('pageSize')||300);
      return reply(200,{documents:all.slice(offset,offset+size),...(offset+size<all.length?{nextPageToken:String(offset+size)}:{})});
    }
    if(options.method==='post' && key && !key.includes('/')){const id=u.searchParams.get('documentId');if(docs.has(key+'/'+id))return reply(409,{});const doc={name:'projects/'+project+'/databases/(default)/documents/'+key+'/'+id,fields:body.fields,updateTime:'v'+(++version)};docs.set(key+'/'+id,doc);return reply(200,doc);}
    if(options.method==='get')return docs.has(key)?reply(200,docs.get(key)):reply(404,{});
    if(options.method==='patch'){
      if(c.beforePatch){const hook=c.beforePatch;c.beforePatch=null;hook(key);}
      const pre=u.searchParams.has('currentDocument.updateTime')?{updateTime:u.searchParams.get('currentDocument.updateTime')}:u.searchParams.has('currentDocument.exists')?{exists:u.searchParams.get('currentDocument.exists')==='true'}:null;
      if(!checked(docs.get(key),pre))return reply(400,{error:{status:'FAILED_PRECONDITION'}});
      const old=docs.get(key)||{name:'projects/syy-shop/databases/(default)/documents/'+key,fields:{}},mask=u.searchParams.getAll('updateMask.fieldPaths');
      if(mask.length)mask.forEach(k=>old.fields[k]=body.fields[k]);else old.fields=body.fields;
      old.updateTime='v'+(++version);docs.set(key,old);
      if(c.losePatchResponse){c.losePatchResponse=false;throw Error('network response lost after patch');}
      return reply(200,old);
    }
    if(options.method==='delete'){
      if(!checked(docs.get(key),{updateTime:u.searchParams.get('currentDocument.updateTime')}))return reply(400,{error:{status:'FAILED_PRECONDITION'}});
      docs.delete(key);return reply(200,{});
    }
    throw Error('Unmocked '+url);
  }
  const c=vm.createContext({console:{error(){},warn(){},log(){}},
    Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:(_d,_z,format)=>format==='yyyy-MM-dd'?'2026-10-11':format==='u'?'7':format==='HH-mm-ss'?'12-00-00':'2026-10-11_12-00-00',sleep(){},
      base64Encode:x=>(typeof x==='string'?Buffer.from(x):Buffer.from(Uint8Array.from(x))).toString('base64'),base64Decode:x=>Array.from(Buffer.from(x,'base64')),newBlob:blob,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF8'},
      MacAlgorithm:{HMAC_SHA_1:'sha1'},computeHmacSignature:(algo,data,key)=>Array.from(crypto.createHmac(algo,Buffer.from(Uint8Array.from(key))).update(Buffer.from(Uint8Array.from(data))).digest()),
      computeHmacSha256Signature:(data,key)=>Array.from(crypto.createHmac('sha256',String(key)).update(String(data)).digest()),
      computeDigest:(algo,input)=>Array.from(crypto.createHash('sha256').update(typeof input==='string'?input:Buffer.from(Uint8Array.from(input))).digest())},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,getAll:keys=>Object.fromEntries(keys.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),put:(k,v)=>cache.set(k,v),putAll:values=>Object.entries(values).forEach(([k,v])=>cache.set(k,v)),remove:k=>cache.delete(k),removeAll:keys=>keys.forEach(k=>cache.delete(k))})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v,deleteProperty:k=>{delete props[k];},getProperties:()=>({...props}),setProperties:p=>Object.assign(props,p)})},
    LockService:{getScriptLock:()=>({tryLock:()=>!c.lockBusy,waitLock(){if(c.lockBusy)throw Error('busy');},releaseLock(){}}),getUserLock:()=>({tryLock:()=>!c.backupBusy,releaseLock(){}})},
    UrlFetchApp:{fetch,fetchAll:requests=>requests.map(r=>c.UrlFetchApp.fetch(r.url,r))},
    DriveApp:{Access:{PRIVATE:'PRIVATE',ANYONE_WITH_LINK:'LINK'},Permission:{VIEW:'VIEW'},getFileById:id=>{if(!files.has(id))throw Error('Missing file');return files.get(id);},getFolderById:id=>folders.get(id),getFoldersByName:n=>iterator([...folders.values()].filter(f=>f.name===n)),createFolder:makeFolder},
    ScriptApp:{getOAuthToken:()=> 'mock',getService:()=>({getUrl:()=> 'https://example.invalid/shop'})},
    Session:{getEffectiveUser:()=>owner,getActiveUser:()=>owner},MimeType:{PLAIN_TEXT:'text/plain'},MailApp:{sendEmail(){}}
  });
  for(const file of ['Code.gs','ProductImagesV2.gs'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..','..',file),'utf8'),c);
  c.BACKUP_FOLDER_ID=''; // Fixtures never target the user's actual Drive destination.
  if(options.legacyBackup)vm.runInContext('backupAllDataToBackup_ = '+require('./legacy-backup.cjs').toString(),c);
  c.readTime='2026-10-11T05:10:00.000Z';c.logActivity_=()=>{};
  const put=(key,data)=>docs.set(key,{name:'projects/syy-shop/databases/(default)/documents/'+key,fields:c.mapToFirestoreFields_(data),updateTime:'v'+(++version)});
  const value=(key,field)=>c.parseFirestoreValue_(docs.get(key)?.fields[field]);
  const seed=()=>{put('Master_Products/P1',{Product_Name:'Part',Current_Stock:10,Min_Stock:2,Cost_Price:100,Selling_Price:200});put('Master_Vendors/V1',{Vendor_name:'Vendor'});};
  function user(overrides={}){const data={Username:'admin',Role:'admin',Status:'Active',Full_Name:'Admin',Email:'admin@example.invalid',Salt:'salt',Password_Hash:c.hashPassword_('old-password','salt'),Password_Changed_At:new Date().toISOString(),...overrides};put('Master_Users/U1',data);return c.readAuthUser_('U1');}
  return {c,docs,cache,props,calls,commits,put,value,seed,user,makeFile,makeFolder,files,folders};
}
module.exports={setup,plain,reply};
