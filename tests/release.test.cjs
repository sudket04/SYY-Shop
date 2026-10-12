const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto');
const {prepareRelease,verifyRelease}=require('../scripts/prepare-release.cjs');
const {setup}=require('./support/services.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const root=path.resolve(__dirname,'..');
const staging={stagingProjectId:'fixture-staging-shop',stagingMailbox:'tester@example.invalid'};

test('review bundle includes complete client/backend, checksums, routes and manifest without credentials',()=>{
  const before=sha(fs.readFileSync(path.join(root,'Code.gs'))),result=prepareRelease();
  assert.equal(result.mode,'review');assert.equal(result.targetProjectId,null);assert.equal(result.deployed,false);
  assert.equal(result.files.length,24);
  const metadata=verifyRelease(result.directory);
  assert.equal(metadata.commit,result.commit);
  assert(metadata.files.every(f=>f.sha256===f.originalSha256));
  assert(!metadata.files.some(f=>/tests|docs|clasp|secret|credential/i.test(f.name)));
  assert.equal(sha(fs.readFileSync(path.join(root,'Code.gs'))),before);
});

test('staging build requires a separate project and controlled mailbox, rejects injection and partial options',()=>{
  for(const bad of [{stagingProjectId:'syy-shop',stagingMailbox:staging.stagingMailbox},
    {stagingProjectId:'fixture-staging-shop'}, {stagingMailbox:staging.stagingMailbox},
    {...staging,stagingProjectId:'fixture\";PROJECT_ID=\"syy-shop'},
    {...staging,stagingMailbox:'tester@example.invalid\nBcc:someone@example.invalid'}])
    assert.throws(()=>prepareRelease(bad),/staging project|staging mailbox/);
});

test('generated staging source isolates Firestore, Drive folders/properties and all outbound mail',()=>{
  const before=sha(fs.readFileSync(path.join(root,'Code.gs'))),result=prepareRelease(staging),s=setup(),mail=[];
  const productionImages=s.makeFolder(s.c.PRODUCT_IMAGE_FOLDER_NAME),productionBackups=s.makeFolder(s.c.BACKUP_FOLDER_NAME);
  s.props.PRODUCT_IMAGE_DRIVE_FOLDER_ID=productionImages.getId();
  s.c.MailApp.sendEmail=(...args)=>mail.push(args);
  for(const file of ['Code.gs','ProductImagesV2.gs'])
    vm.runInContext(fs.readFileSync(path.join(result.directory,'source',file),'utf8'),s.c);
  assert.equal(s.c.PROJECT_ID,staging.stagingProjectId);
  assert.notEqual(s.c.getProductImageFolder_().getId(),productionImages.getId());
  assert.notEqual(s.c.getOrCreateBackupFolder_().getId(),productionBackups.getId());
  assert.equal(s.props.PRODUCT_IMAGE_DRIVE_FOLDER_ID,productionImages.getId());
  s.c.sendStagingMail_('other@example.invalid','Subject','Body');
  assert.deepEqual(mail[0],[staging.stagingMailbox,'[STAGING] Subject','Body']);
  assert(result.stagingOverrides.length===4);
  const code=fs.readFileSync(path.join(result.directory,'source','Code.gs'),'utf8');
  assert.equal((code.match(/MailApp\.sendEmail\s*\(/g)||[]).length,1);
  assert.equal((code.match(/sendStagingMail_\(/g)||[]).length,5);
  assert.equal(sha(fs.readFileSync(path.join(root,'Code.gs'))),before);
  assert.equal(verifyRelease(result.directory).mode,'staging');
});

test('release verification rejects tampered source, whitelist and unexpected files',()=>{
  for(const change of ['source','whitelist','extra']) {
    const result=prepareRelease(),source=path.join(result.directory,'source');
    if(change==='source')fs.appendFileSync(path.join(source,'Code.gs'),'\n// changed\n');
    if(change==='whitelist')fs.appendFileSync(path.join(source,'.claspignore'),'!secret.json\n');
    if(change==='extra')fs.writeFileSync(path.join(source,'secret.json'),'{}');
    assert.throws(()=>verifyRelease(result.directory),/checksum|whitelist|Unexpected/);
  }
});

test('release builder never overwrites bundles or writes outside its output directory',()=>{
  const result=prepareRelease();
  assert.throws(()=>prepareRelease({outputDir:result.directory}),/overwrite/);
  assert.throws(()=>prepareRelease({outputDir:path.join(root,'source-copy')}),/Output must stay/);
});
