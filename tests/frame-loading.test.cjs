const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const script=fs.readFileSync('UiBootstrap.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(state,expired=false,unavailable=false){
 const docEvents=new Map(),winEvents=new Map(),tasks=[],messages=[];
 function add(map,name,fn){if(!map.has(name))map.set(name,new Set());map.get(name).add(fn);}
 function remove(map,name,fn){map.get(name)?.delete(fn);}
 const parent={location:{origin:'https://script.google.com'},postMessage:(data,origin)=>messages.push({data,origin})};parent.parent=parent;
 const document={readyState:state,addEventListener:(name,fn)=>add(docEvents,name,fn),removeEventListener:(name,fn)=>remove(docEvents,name,fn),querySelector:selector=>({content:selector.includes('session-state')?(unavailable?'unavailable':expired?'expired':''):selector.includes('parent-origin')?'':'fixture-channel-123456'})};
 const window={parent,addEventListener:(name,fn)=>add(winEvents,name,fn),removeEventListener:(name,fn)=>remove(winEvents,name,fn)};
 const c={document,window,location:{origin:'https://fixture-script.googleusercontent.com'},URL,setTimeout:(fn,ms=0)=>{const task={fn,ms};tasks.push(task);return task;},clearTimeout:task=>{if(task)task.cancelled=true;}};
 vm.createContext(c);vm.runInContext(script,c);
 return {c,messages,docEvents,winEvents,flush(ms=0){const due=tasks.filter(t=>t.ms<=ms);due.forEach(task=>{tasks.splice(tasks.indexOf(task),1);if(!task.cancelled)task.fn();});}};
}
test('late HtmlService script installation announces readiness after DOMContentLoaded has passed',()=>{
 for(const state of ['interactive','complete']){const f=fixture(state);assert.equal(f.messages.length,0);f.flush();assert.equal(f.messages.length,1);assert.equal(f.messages[0].data.action,'PAGE_READY');assert.equal(f.messages[0].origin,'https://script.google.com');}
});
test('DOMContentLoaded and load fallback initialize once and preserve deferred declaration order',()=>{
 const f=fixture('loading');let seen='';f.c.syyOnReady(()=>seen=f.c.declaredLater);
 const dom=[...f.docEvents.get('DOMContentLoaded')],load=[...f.winEvents.get('load')];dom.forEach(fn=>fn());load.forEach(fn=>fn());f.c.declaredLater='ready';f.flush();
 assert.equal(seen,'ready');assert.equal(f.messages.length,1);
 const fallback=fixture('loading');[...fallback.winEvents.get('load')].forEach(fn=>fn());fallback.flush();assert.equal(fallback.messages.length,1);
});
test('an expired embedded route signals SESSION_EXPIRED instead of claiming page readiness',()=>{
 const f=fixture('complete',true);f.flush();assert.equal(f.messages.length,1);assert.equal(f.messages[0].data.action,'SESSION_EXPIRED');assert.equal(f.messages[0].data.channel,'fixture-channel-123456');
});
test('temporary auth infrastructure failure announces unavailable and never claims UI authentication/data success',()=>{
 const f=fixture('complete',false,true);f.flush();assert.equal(f.messages[0].data.action,'PAGE_UNAVAILABLE');assert(!f.messages.some(m=>m.data.action==='SESSION_EXPIRED'||m.data.action==='PAGE_READY'));
});
test('readiness retries are bounded, stop after a trusted ACK and do not perform any RPC',()=>{
 const f=fixture('complete');f.flush();f.flush(5000);assert.equal(f.messages.length,4);f.flush(10000);assert.equal(f.messages.length,4);
 const a=fixture('complete');a.flush();const source=a.c.window.parent;
 [...a.winEvents.get('message')].forEach(fn=>fn({source,origin:'https://script.google.com',data:{action:'PAGE_ACK',channel:'fixture-channel-123456'}}));a.flush(5000);assert.equal(a.messages.length,1);
 a.c.SYYFrameBridge.dataReady();assert.equal(a.messages.at(-1).data.action,'PAGE_DATA_READY');assert.equal(a.messages.at(-1).data.channel,'fixture-channel-123456');
});
test('a validated parent-origin hint reaches the shell across cross-origin wrappers without ancestorOrigins',()=>{
 const messages=[],tasks=[],events=[];
 const shell={postMessage:(data,origin)=>messages.push({to:'shell',data,origin})};shell.parent=shell;
 const wrapper={parent:shell,postMessage:(data,origin)=>messages.push({to:'wrapper',data,origin})};
 for(const w of [shell,wrapper])Object.defineProperty(w,'location',{get(){throw Error('cross-origin');}});
 const document={readyState:'complete',referrer:'https://wrapper-script.googleusercontent.com/panel',removeEventListener(){},querySelector:s=>s.startsWith('link')?{}:{content:s.includes('parent-origin')?'https://shell-script.googleusercontent.com':s.includes('session-state')?'':'fixture-channel-123456'}};
 const c={document,window:{parent:wrapper,removeEventListener(){},addEventListener:(n,fn)=>{if(n==='message')events.push(fn);}},location:{origin:'https://child-script.googleusercontent.com'},URL,setTimeout:(fn,ms)=>{if(!ms)tasks.push(fn);},clearTimeout(){}};
 vm.runInNewContext(script,c);while(tasks.length)tasks.shift()();assert(messages.some(m=>m.to==='shell'&&m.origin==='https://shell-script.googleusercontent.com'&&m.data.action==='PAGE_READY'));
 const before=messages.length;events.forEach(fn=>fn({source:{},origin:'https://evil.invalid',data:{action:'PAGE_ACK',channel:'fixture-channel-123456'}}));c.SYYFrameBridge.dataReady();assert(messages.slice(before).every(m=>m.origin!=='https://evil.invalid'));
 events.forEach(fn=>fn({source:shell,origin:'https://shell-script.googleusercontent.com',data:{action:'PAGE_ACK',channel:'old-channel'}}));
 events.forEach(fn=>fn({source:shell,origin:'https://shell-script.googleusercontent.com',data:{action:'PAGE_ACK',channel:'fixture-channel-123456'}}));
 const after=messages.length;c.SYYFrameBridge.post({action:'MASTER_DELTA'});assert.equal(messages.length,after+1);assert.equal(messages.at(-1).to,'shell');
});
