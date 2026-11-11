import fs from 'node:fs';import p from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import http from 'node:http';import {once} from 'node:events';import assert from 'node:assert/strict';
const win=process.platform==='win32',root=fs.mkdtempSync(p.join(os.tmpdir(),'arkme-ask-dsh-')),user=p.join(root,'browser');
const srv=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync('app.js'))}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<body style="font-family:Arial"><div id="root"></div><div data-arkme-owned="deepseek-harness-surface" data-arkme-account-id="42" data-arkme-account-scope="test:42" style="display:none"><iframe style="width:95vw;height:600px" src="about:blank"></iframe></div><script type="module" src="/app.js"></script></body>')});srv.listen(0,'127.0.0.1');await once(srv,'listening');const url='http://127.0.0.1:'+srv.address().port;
const browser=spawn(win?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+user,'--window-size=900,700','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let i=0;i<150;i++){let v=await fn();if(v)return v;await sleep(100)}throw Error('timeout: '+fn.toString())}
try{const port=await until(()=>{try{return fs.readFileSync(p.join(user,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{}});const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const ws=new WebSocket(tabs.find(t=>t.url==='about:blank').webSocketDebuggerUrl);await once(ws,'open');let ids=0, pending=new Map();ws.onmessage=e=>{let m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};async function cmd(method,params={}){let id=++ids;let res=new Promise(r=>pending.set(id,r));ws.send(JSON.stringify({id,method,params}));let m=await res;if(m.error)throw Error(JSON.stringify(m.error));return m.result}async function ev(expression){let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
await cmd('Page.bringToFront');await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});await cmd('Browser.grantPermissions',{origin:url,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});

const btn=k=>'document.querySelector(\'[data-arkme-quarantine-action="'+k+'"]\')';
await cmd('Page.navigate',{url});await until(()=>ev('!!'+btn('details')));
await ev(btn('details')+'.click()');
assert.equal(await ev(btn('copy')+'.innerText'),'复制诊断信息');
assert.equal(await ev(btn('ask-dsh')+'.innerText'),'发送给 Deepseek Harness 排查');
fs.writeFileSync(process.platform+'-buttons.png',Buffer.from((await cmd('Page.captureScreenshot')).data,'base64'));
await ev(btn('copy')+'.click()');await until(()=>ev(btn('copy')+'.innerText==="已复制诊断"'));
const copied=(await ev('navigator.clipboard.readText()')).replaceAll('\r\n','\n');
assert.ok(copied.includes('arkme-arrangement-line: loading'));
await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});
assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);
fs.writeFileSync(process.platform+'-narrow.png',Buffer.from((await cmd('Page.captureScreenshot')).data,'base64'));
await cmd('Emulation.clearDeviceMetricsOverride');
await ev('window.fail=true;'+btn('ask-dsh')+'.click()');
await until(()=>ev('document.body.innerText.includes("测试连接失败")'));
assert.equal((await ev('window.evidence()')).created,0);
await ev('window.fail=false;'+btn('ask-dsh')+'.click();'+btn('ask-dsh')+'.click()');
await until(()=>ev('window.evidence().mode==="harness"'));
const result=await ev('window.evidence()');
assert.equal(result.created,1);assert.equal(result.sends,0);assert.equal(result.old,'原会话保留的草稿');assert.equal(result.draft,copied);assert.notEqual(result.current,'old');
assert.equal(await ev('document.querySelector("iframe").contentDocument.querySelector("textarea").value'),copied);
assert.equal(await ev('!!document.querySelector("[data-arkme-owned=extension-recovery-notice]")'),false);
fs.writeFileSync(process.platform+'-draft.png',Buffer.from((await cmd('Page.captureScreenshot')).data,'base64'));
console.log(process.platform,'PASS: labels / clipboard / narrow layout / failure retry / double-click / new session / exact draft / old draft retained / zero sends');
await cmd('Browser.close').catch(()=>{});ws.close();
}finally{browser.kill();srv.closeAllConnections();srv.close()}
