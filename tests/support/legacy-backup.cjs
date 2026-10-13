// Historical v2 writer used only to generate legacy recovery fixtures. Never shipped to Apps Script.
module.exports = function backupAllDataToBackup_() {
  var result={success:false,collections:{},errors:[]},transaction="",assetFolder=null,manifest=null;
  var endpoint="https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents";
  try {
    var folder=getOrCreateBackupFolder_();assertPrivateBackupFolder_(folder);
    var properties=backupScriptProperties_();
    var begin=UrlFetchApp.fetch(endpoint+":beginTransaction",{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({options:{readOnly:{}}}),muteHttpExceptions:true});
    if(begin.getResponseCode()!==200)throw new Error("เริ่ม Backup snapshot ไม่สำเร็จ");
    transaction=JSON.parse(begin.getContentText()).transaction;
    if(!transaction)throw new Error("ไม่พบ Backup transaction");
    var snapshot={};BACKUP_COLLECTIONS.forEach(function(name){snapshot[name]=fetchBackupSnapshotCollection_(name,transaction);result.collections[name]=snapshot[name].length;});
    var ids={};snapshot.Product_Images.forEach(function(doc){imageDataFromFields_(doc.fields).ids.forEach(function(id){if(!id)throw new Error("รูปสินค้ามี URL แต่ไม่มี Drive File ID");ids[id]=true;});});
    var suffix=Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd_HH-mm-ss")+"_"+Utilities.getUuid();
    assetFolder=folder.createFolder("syy-shop-assets_"+suffix);assertPrivateBackupFolder_(assetFolder);
    var assets=[];
    Object.keys(ids).forEach(function(id){
      var original=DriveApp.getFileById(id),before=original.getLastUpdated().getTime(),blob=original.getBlob(),digest=backupDigest_(blob.getBytes());
      var copy=assetFolder.createFile(blob).setName(original.getName());assertPrivateBackupItem_(copy);
      if(original.getLastUpdated().getTime()!==before || backupDigest_(copy.getBlob().getBytes())!==digest)throw new Error("รูปสินค้าถูกแก้ไขระหว่าง Backup");
      assets.push({originalId:id,backupId:copy.getId(),digest:digest});
    });
    if(backupJsonDigest_(properties)!==backupJsonDigest_(backupScriptProperties_()))throw new Error("Script Properties เปลี่ยนแปลงระหว่าง Backup กรุณาลองใหม่");
    var bundle={schemaVersion:2,complete:true,backupDate:new Date().toISOString(),projectId:PROJECT_ID,collections:snapshot,scriptProperties:properties,assets:assets,assetFolderId:assetFolder.getId()};
    bundle.digest=backupJsonDigest_({collections:snapshot,scriptProperties:properties,assets:assets,assetFolderId:bundle.assetFolderId});
    validateBackupBundle_(bundle);
    result.fileName="syy-shop-backup_"+suffix+".json";
    var text=JSON.stringify(bundle);manifest=folder.createFile(result.fileName,text,MimeType.PLAIN_TEXT);assertPrivateBackupItem_(manifest);
    result.fileSizeKB=Math.round(manifest.getSize()/1024);result.fileId=manifest.getId();result.success=true;

  } catch(e) {
    result.errors.push(e.message);
    if(manifest){try{manifest.setTrashed(true);}catch(ignore){}}
    if(assetFolder){try{assetFolder.setTrashed(true);}catch(ignore){}}
  } finally {
    if(transaction){try{UrlFetchApp.fetch(endpoint+":rollback",{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({transaction:transaction}),muteHttpExceptions:true});}catch(ignore){}}
  }
  return result;
};
