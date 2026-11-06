const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shared=fs.readFileSync('Shared.html','utf8'),users=fs.readFileSync('Manage_Users.html','utf8');
function helpers(source){const code=['esc','escJs'].map(name=>source.match(new RegExp('^function '+name+'\\([^\\n]+','m'))?.[0]).join('\n');const c={};vm.createContext(c);vm.runInContext(code,c);return c;}
function decodeOnce(value){return value.replace(/&(amp|lt|gt|quot);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"'}[name]));}
test('legacy JS attribute encoding preserves hostile strings without code execution in both helper copies',()=>{
 const values=[String.raw`x\');marker=true;//`,String.raw`x\\');marker=true;//`,'\'"<&>\r\n\u2028\u2029','</script><img src=x onerror="marker=true">','&#39;);marker=true;//','อะไหล่ \\ ไทย',null,0];
 for(const source of [shared,users]){const c=helpers(source);for(const value of values){const sandbox={marker:false,capture:v=>{sandbox.actual=v;}};vm.createContext(sandbox);vm.runInContext("capture('"+decodeOnce(c.escJs(value))+"')",sandbox);assert.equal(sandbox.marker,false);assert.equal(sandbox.actual,String(value??''));}}
});
test('reviewed deferred assets have exact URLs, SHA384 integrity and CORS protection',()=>{
 const assets=require('../scripts/cdn-assets.json');assert.equal(Object.keys(assets).length,6);
 for(const [name,asset] of Object.entries(assets)){const url=new URL(asset.url);assert.equal(url.protocol,'https:');assert(['cdn.jsdelivr.net','cdn.sheetjs.com'].includes(url.hostname));assert.equal(Buffer.from(asset.integrity.replace(/^sha384-/,''),'base64').length,48);assert(shared.includes(JSON.stringify({url:asset.url,integrity:asset.integrity})),name);assert.equal(asset.cors[0],'*');assert(asset.license);}
 assert(shared.includes("script.crossOrigin='anonymous'"));assert(shared.includes('script.integrity=assets[name].integrity'));assert(!shared.includes('qrcode@1.5.3/build'));assert(!shared.includes('sweetalert2@11"'));
});
test('dynamic master/product actions use data and explicit listeners, status chips use text nodes',()=>{
 for(const name of ['Brands','Cars','Categories','Customers','Vendors','Zones']){const source=fs.readFileSync('Master_'+name+'.html','utf8');assert(source.includes('syyDelegateActions(tbody'));assert(source.includes('data-syy-action="edit"'));assert(!/onclick="openEditModal\([^\n]*escJs\(it\./.test(source));}
 const quote=fs.readFileSync('Quotation.html','utf8'),render=quote.slice(quote.indexOf('function renderStatusFilterBar'),quote.indexOf('function setListFilter'));
 assert(render.includes('button.textContent=s'));assert(!render.includes('innerHTML'));assert(render.includes("button.type='button'"));
});
