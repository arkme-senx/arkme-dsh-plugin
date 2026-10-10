// Run using Electron, with the QA bundle directory as argv[2]. Uses a synthetic screen only.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const directory=process.argv[2];const window=new BrowserWindow({width:1200,height:800,show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const run=code=>window.webContents.executeJavaScript(code);
 try{
  await window.loadFile(path.join(directory,'index.html'));
  for(let i=0;i<100&&!await run('!!window.qa?.ready');i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(await run('window.qa.ready'),true);
  const target=await run(`(()=>{const r=document.querySelector('[data-arkme-screenshot-stage]').getBoundingClientRect();return {x:Math.round(r.left+800*r.width/1200),y:Math.round(r.top+300*r.height/800)}})()`);
  window.webContents.sendInputEvent({type:'mouseMove',...target});await new Promise(r=>setTimeout(r,80));
  assert.equal(await run(`!!document.querySelector('[data-arkme-screenshot-window-hover]')`),true);
  await fs.writeFile(path.join(directory,'window-hover.png'),(await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...target});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...target});await new Promise(r=>setTimeout(r,80));
  const snap=await run(`(()=>{const el=document.querySelector('[data-arkme-screenshot-selection]'),r=document.querySelector('[data-arkme-screenshot-stage]').getBoundingClientRect();return {x:Math.round(parseFloat(el.style.left)*1200/r.width),y:Math.round(parseFloat(el.style.top)*800/r.height),width:Math.round(parseFloat(el.style.width)*1200/r.width),height:Math.round(parseFloat(el.style.height)*800/r.height)}})()`);
  assert.deepEqual(snap,{x:700,y:260,width:340,height:120});
  await fs.writeFile(path.join(directory,'window-selected.png'),(await window.webContents.capturePage()).toPNG());
  const toolbarBefore=await run(`(()=>{const r=document.querySelector('[role="toolbar"]').getBoundingClientRect();const h=document.querySelector('[aria-label="拖动截图工具栏"]').getBoundingClientRect();return {left:r.left,top:r.top,x:Math.round(h.left+h.width/2),y:Math.round(h.top+h.height/2),selection:document.querySelector('[data-arkme-screenshot-selection]').style.cssText}})()`);
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:toolbarBefore.x,y:toolbarBefore.y});
  window.webContents.sendInputEvent({type:'mouseMove',x:toolbarBefore.x-80,y:toolbarBefore.y+60});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:toolbarBefore.x-80,y:toolbarBefore.y+60});await new Promise(r=>setTimeout(r,80));
  const toolbarAfter=await run(`(()=>{const r=document.querySelector('[role="toolbar"]').getBoundingClientRect();return {left:r.left,top:r.top,selection:document.querySelector('[data-arkme-screenshot-selection]').style.cssText}})()`);
  assert.equal(toolbarAfter.left,toolbarBefore.left-80);assert.equal(toolbarAfter.top,toolbarBefore.top+60);assert.equal(toolbarAfter.selection,toolbarBefore.selection);
  await fs.writeFile(path.join(directory,'toolbar-drag.png'),(await window.webContents.capturePage()).toPNG());

  await run(`document.querySelector('button[aria-label="重选"]').click()`);await new Promise(r=>setTimeout(r,30));
  const arrows=await run('(()=>{try{return window.qa.arrowPixelTest()}catch(e){return {error:e.message}}})()');
  assert.equal(arrows.error,undefined);
  await fs.writeFile(path.join(directory,'arrows.png'),Buffer.from((await run('window.qa.arrowPreview')).split(',')[1],'base64'));
  const pixels=await run('window.qa.pixelTest()');
  await fs.writeFile(path.join(directory,'export.png'),Buffer.from((await run('window.qa.pixelExport')).split(',')[1],'base64'));
  // Pointer capture is browser input bookkeeping, not geometry; native input is tested separately.
  await run(`window.drag=(x1,y1,x2,y2)=>{const el=document.querySelector('[data-arkme-screenshot-stage]');el.setPointerCapture=()=>{};el.releasePointerCapture=()=>{};
   for(const [type,x,y] of [['pointerdown',x1,y1],['pointermove',x2,y2],['pointerup',x2,y2]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,button:0,clientX:x,clientY:y}));};
   window.clickTool=name=>document.querySelector('button[aria-label="'+name+'"]').click();window.drag(100,200,1080,700);`);
  await new Promise(r=>setTimeout(r,60));
  for(const name of ['矩形','圆形','箭头','画笔','马赛克']){
   await run(`window.clickTool('${name}')`);await new Promise(r=>setTimeout(r,20));
   const i=['矩形','圆形','箭头','画笔','马赛克'].indexOf(name);
   await run(`window.drag(${200+i*120},300,${290+i*120},${400+i*30})`);await new Promise(r=>setTimeout(r,20));
  }
  await run(`window.clickTool('文本')`);await new Promise(r=>setTimeout(r,20));await run('window.drag(220,570,220,570)');await new Promise(r=>setTimeout(r,20));
  await run(`const ta=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta,'截图工具已就绪');ta.dispatchEvent(new Event('input',{bubbles:true}));`);
  await new Promise(r=>setTimeout(r,20));await run(`document.querySelector('textarea').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));`);await new Promise(r=>setTimeout(r,30));
  assert.equal(await run(`document.querySelector('button[aria-label="撤销"]').disabled`),false);
  await run(`window.clickTool('撤销')`);await new Promise(r=>setTimeout(r,20));assert.equal(await run(`document.querySelector('button[aria-label="重做"]').disabled`),false);
  await run(`window.clickTool('重做')`);await new Promise(r=>setTimeout(r,20));
  await fs.writeFile(path.join(directory,'editor.png'),(await window.webContents.capturePage()).toPNG());
  assert.equal(await run(`document.querySelector('[aria-label="问dsh"]').title`),'问dsh');
  await run(`window.clickTool('问dsh')`);await new Promise(r=>setTimeout(r,80));
  assert.equal(await run('window.qa.asked'),1);assert.ok(await run('window.qa.askSize>0'));
  assert.equal(await run('window.qa.saved'),0);assert.equal(await run('window.qa.completed'),0);
  await run(`window.clickTool('保存')`);await new Promise(r=>setTimeout(r,80));assert.equal(await run('window.qa.saved'),1);
  await run(`window.clickTool('完成')`);await new Promise(r=>setTimeout(r,80));assert.equal(await run('window.qa.completed'),1);
  // Small viewport and top-edge selection keep every icon reachable and tooltips below.
  window.setSize(360,640);await new Promise(r=>setTimeout(r,80));
  await run(`window.clickTool('重选')`);await new Promise(r=>setTimeout(r,20));await run('window.drag(10,10,340,600)');await new Promise(r=>setTimeout(r,50));
  const bounds=await run(`(()=>{const r=document.querySelector('[role=toolbar]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
  assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height,JSON.stringify(bounds));
  await fs.writeFile(path.join(directory,'editor-narrow.png'),(await window.webContents.capturePage()).toPNG());
  assert.deepEqual(await run('window.qa.errors'),[]);
  console.log(JSON.stringify({windowSnap:true,arrows,pixels,toolbar:true,text:true,undoRedo:true,save:true,complete:true,errors:[]},null,2));
 }catch(e){console.error(e);app.exitCode=1}finally{window.destroy();app.exit(app.exitCode||0)}
});
