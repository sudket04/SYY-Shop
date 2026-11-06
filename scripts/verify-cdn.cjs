// Offline by default. --download fetches only the six reviewed public assets,
// checks exact digests/CORS, and writes ignored test artifacts (never GAS/DB).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const assets=require('./cdn-assets.json'),folder=path.resolve(__dirname,'../test-results/quality-cdn-assets');
async function main(){
 fs.mkdirSync(folder,{recursive:true});
 for(const [name,asset] of Object.entries(assets)){
  const target=path.join(folder,name+'.js');let data;
  if(process.argv.includes('--download')){
   const url=new URL(asset.url);assert(['cdn.jsdelivr.net','cdn.sheetjs.com'].includes(url.hostname)&&url.protocol==='https:');
   const response=await fetch(asset.url,{redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,name);assert.equal(response.headers.get('access-control-allow-origin'),'*',name+' CORS');
   if(Number(response.headers.get('content-length'))>3000000)throw Error('Oversized asset '+name);data=Buffer.from(await response.arrayBuffer());
  }else{if(!fs.existsSync(target))throw Error('Missing cached '+name+'; run node scripts/verify-cdn.cjs --download first');data=fs.readFileSync(target);}
  assert(data.length<3000000,name);assert.equal('sha384-'+crypto.createHash('sha384').update(data).digest('base64'),asset.integrity,name+' digest');
  if(process.argv.includes('--download'))fs.writeFileSync(target,data);
  console.log('PASS: '+name+' verified '+data.length+' bytes');
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
