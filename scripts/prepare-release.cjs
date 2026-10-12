// Builds a local review/staging bundle. Never logs in, pushes, syncs or deploys.
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const vm=require('node:vm'), {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
function replaceVariable(source,name,value) {
  const pattern=new RegExp('\\bvar\\s+'+name+'\\s*=\\s*(["\\\'])([^"\\\']*)\\1\\s*;','g');
  const matches=[...source.matchAll(pattern)];
  if(matches.length!==1)throw Error('Expected one '+name+' declaration');
  return source.replace(pattern,'var '+name+' = '+JSON.stringify(value)+';');
}
function readProject(source) {
  const matches=[...source.matchAll(/\bvar\s+PROJECT_ID\s*=\s*(["'])([^"']+)\1\s*;/g)];
  if(matches.length!==1)throw Error('Expected one PROJECT_ID declaration');
  return matches[0][2];
}
function stagingSource(source,project,mailbox) {
  source=replaceVariable(source,'PROJECT_ID',project);
  source=replaceVariable(source,'PRODUCT_IMAGE_FOLDER_NAME','SYY Shop - STAGING '+project+' - Product Images');
  source=replaceVariable(source,'PRODUCT_IMAGE_FOLDER_PROP_KEY','STAGING_'+project+'_PRODUCT_IMAGE_DRIVE_FOLDER_ID');
  source=replaceVariable(source,'BACKUP_FOLDER_NAME','SYY Shop - STAGING '+project+' - Backups');
  source=replaceVariable(source,'ADMIN_EMAIL',mailbox);
  if(source.includes('function sendStagingMail_'))throw Error('Staging mail wrapper already exists');
  const sends=[...source.matchAll(/\bMailApp\.sendEmail\s*\(/g)];
  if(sends.length!==4)throw Error('Mail paths changed; review staging mail isolation');
  source=source.replace(/\bMailApp\.sendEmail\s*\(/g,'sendStagingMail_(');
  return source+'\n// Generated staging-only mail sink; use synthetic accounts and data.\n'+
    'function sendStagingMail_(recipient, subject, body) {\n'+
    '  if(typeof subject!=="string" || typeof body!=="string")throw new Error("Unsupported staging mail format");\n'+
    '  MailApp.sendEmail('+JSON.stringify(mailbox)+', "[STAGING] " + subject, body);\n}\n';
}
function validateSources(files) {
  for(const name of ['Code.gs','ProductImagesV2.gs','index.html','login.html','Shared.html','appsscript.json'])
    if(!files.has(name))throw Error('Missing release dependency: '+name);
  for(const [name,bytes] of files) {
    const source=bytes.toString('utf8');
    if(name.endsWith('.gs'))new vm.Script(source,{filename:name});
    if(name.endsWith('.html')) {
      for(const match of source.matchAll(/\binclude_\(\s*['"]([^'"]+)['"]\s*\)/g))
        if(!files.has(match[1]+'.html'))throw Error('Missing HTML include: '+match[1]);
      for(const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
        new vm.Script(script[1].replace(/<\?[\s\S]*?\?>/g,'template'),{filename:name});
    }
  }
  const code=files.get('Code.gs').toString('utf8'), routes=code.match(/var files\s*=\s*\{([\s\S]*?)\};/);
  if(!routes)throw Error('Route map missing');
  for(const match of routes[1].matchAll(/['"][^'"]+['"]\s*:\s*['"]([^'"]+)['"]/g))
    if(!files.has(match[1]+'.html'))throw Error('Missing routed page: '+match[1]);
  const manifest=JSON.parse(files.get('appsscript.json'));
  if(manifest.runtimeVersion!=='V8'||manifest.timeZone!=='Asia/Bangkok')throw Error('Unexpected runtime/time zone');
}
function prepareRelease({stagingProjectId,stagingMailbox,outputDir}={}) {
  const names=git(['ls-files','--','*.gs','*.html','appsscript.json']).split(/\r?\n/)
    .filter(name=>name&&!name.includes('/')).sort();
  const files=new Map(names.map(name=>{
    const sourcePath=path.join(root,name);
    if(!inside(fs.realpathSync(root),fs.realpathSync(sourcePath)))throw Error('Source must stay in repository');
    return [name,fs.readFileSync(sourcePath)];
  }));
  validateSources(files);
  const productionProjectId=readProject(files.get('Code.gs').toString('utf8'));
  const staging=stagingProjectId!==undefined||stagingMailbox!==undefined;
  if(staging) {
    if(typeof stagingProjectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(stagingProjectId)||stagingProjectId===productionProjectId)
      throw Error('Provide a separate staging project ID (6–30 characters)');
    if(typeof stagingMailbox!=='string'||!/^[-\w.+]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(stagingMailbox))
      throw Error('Provide a controlled staging mailbox');
  }
  const originalHashes=Object.fromEntries([...files].map(([name,bytes])=>[name,digest(bytes)]));
  if(staging)files.set('Code.gs',Buffer.from(stagingSource(files.get('Code.gs').toString('utf8'),stagingProjectId,stagingMailbox)));
  validateSources(files);
  const commit=git(['rev-parse','HEAD']), branch=git(['branch','--show-current']);
  const dirty=git(['status','--porcelain','--untracked-files=no','--',...names])!=='';
  const outputs=path.join(root,'test-results','releases');fs.mkdirSync(outputs,{recursive:true});
  if(!inside(fs.realpathSync(root),fs.realpathSync(outputs)))throw Error('Output must stay in repository');
  const destination=outputDir?path.resolve(outputDir):path.join(outputs,(staging?'staging':'review')+'-'+commit.slice(0,12)+'-'+crypto.randomUUID());
  if(!inside(outputs,destination))throw Error('Output must stay in test-results/releases');
  if(fs.existsSync(destination))throw Error('Refusing to overwrite an existing release bundle');
  // Each package lives directly below outputs; no deletion or recursive path creation.
  if(path.dirname(destination)!==outputs)throw Error('Release output must be a direct child of releases');
  fs.mkdirSync(destination);const sourceDir=path.join(destination,'source');fs.mkdirSync(sourceDir);
  const inventory=[];
  for(const [name,bytes] of files) {
    fs.writeFileSync(path.join(sourceDir,name),bytes,{flag:'wx'});
    inventory.push({name,bytes:bytes.length,sha256:digest(bytes),originalSha256:originalHashes[name]});
  }
  const ignore='# Generated release whitelist; no credentials/config/tests/docs\n**/**\n'+names.map(name=>'!'+name).join('\n')+'\n';
  fs.writeFileSync(path.join(sourceDir,'.claspignore'),ignore,{flag:'wx'});
  const metadata={schemaVersion:1,createdAt:new Date().toISOString(),commit,branch,
    mode:staging?'staging':'review',sourceDirty:dirty,sourceProjectId:productionProjectId,
    targetProjectId:staging?stagingProjectId:null,stagingMailbox:staging?stagingMailbox:null,
    deployed:false,requiresTargetVerification:true,
    stagingOverrides:staging?['Firestore project','Drive folder names and image property key','first-admin email','all outbound email to controlled mailbox']:[],
    files:inventory,claspIgnoreSha256:digest(ignore)};
  fs.writeFileSync(path.join(destination,'release.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  verifyRelease(destination);
  return {directory:destination,...metadata};
}
function verifyRelease(directory) {
  const metadata=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8'));
  if(metadata.schemaVersion!==1||!Array.isArray(metadata.files))throw Error('Invalid release manifest');
  const sourceDir=path.join(directory,'source'), names=new Set(metadata.files.map(x=>x.name));
  if(names.size!==metadata.files.length)throw Error('Duplicate release file');
  const files=new Map();
  for(const entry of metadata.files) {
    if(!/^(?:[A-Za-z0-9_]+\.(?:gs|html)|appsscript\.json)$/.test(entry.name))throw Error('Invalid release path');
    const filename=path.join(sourceDir,entry.name);
    if(!inside(fs.realpathSync(sourceDir),fs.realpathSync(filename)))throw Error('Release symlink escaped source');
    const bytes=fs.readFileSync(filename);
    if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error('Release checksum failed: '+entry.name);
    files.set(entry.name,bytes);
  }
  if(fs.readdirSync(sourceDir).some(name=>!names.has(name)&&name!=='.claspignore'))throw Error('Unexpected file in release source');
  if(digest(fs.readFileSync(path.join(sourceDir,'.claspignore')))!==metadata.claspIgnoreSha256)throw Error('Release whitelist changed');
  validateSources(files);
  const project=readProject(files.get('Code.gs').toString('utf8'));
  if(project!==(metadata.mode==='staging'?metadata.targetProjectId:metadata.sourceProjectId))throw Error('Release project mismatch');
  return metadata;
}
if(require.main===module) {
  try {
    const args=process.argv.slice(2), allowed=['--staging-project','--staging-mailbox','--verify'];
    const values={};
    for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||values[args[i]])throw Error('Usage: node scripts/prepare-release.cjs [--staging-project ID --staging-mailbox EMAIL] | --verify DIRECTORY');values[args[i]]=args[i+1];}
    if(values['--verify']&&args.length!==2)throw Error('Verify cannot be combined with build options');
    const result=values['--verify']?verifyRelease(path.resolve(values['--verify'])):
      prepareRelease({stagingProjectId:values['--staging-project'],stagingMailbox:values['--staging-mailbox']});
    console.log(JSON.stringify({directory:result.directory,commit:result.commit,mode:result.mode,
      sourceDirty:result.sourceDirty,files:result.files.length,deployed:false},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={prepareRelease,verifyRelease};
