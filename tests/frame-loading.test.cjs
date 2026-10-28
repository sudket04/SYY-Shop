const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const script=fs.readFileSync('UiSystem.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(state,expired=false){
 const docEvents=new Map(),winEvents=new Map(),tasks=[],messages=[];
 function add(map,name,fn){if(!map.has(name))map.set(name,new Set());map.get(name).add(fn);}
 function remove(map,name,fn){map.get(name)?.delete(fn);}
 const parent={location:{origin:'https://script.google.com'},postMessage:(data,origin)=>messages.push({data,origin})};parent.parent=parent;
 const document={readyState:state,addEventListener:(name,fn)=>add(docEvents,name,fn),removeEventListener:(name,fn)=>remove(docEvents,name,fn),querySelector:selector=>({content:selector.includes('session-state')?(expired?'expired':''):'fixture-channel-123456'})};
 const window={parent,addEventListener:(name,fn)=>add(winEvents,name,fn),removeEventListener:(name,fn)=>remove(winEvents,name,fn)};
 const c={document,window,location:{origin:'https://fixture-script.googleusercontent.com'},URL,setTimeout:fn=>tasks.push(fn)};
 vm.createContext(c);vm.runInContext(script,c);
 return {c,messages,docEvents,winEvents,flush(){while(tasks.length)tasks.shift()();}};
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
