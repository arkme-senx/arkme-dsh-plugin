import {build} from '../tools/desktop-call/node_modules/esbuild/lib/main.js'
import {createServer} from 'node:http'
const {chromium}=await import(process.env.GAME_PLAYWRIGHT_MODULE||'playwright')
const js=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import{useMoveAnimation}from'./src/client/game/use-move-animation';import{createBoard,move}from'./src/client/game/checkers';
const board=createBoard(['a','b'],1000);board.pieces={'0,0':'a','1,0':'b','3,0':'b'};const path=[[0,0],[2,0],[4,0]];
const initial={version:1,round:'r',count:2,players:['a','b'],ready:[],board};const next={...initial,version:2,board:move(board,'a',path,2000),lastMove:{version:2,player:'a',path}};
window.segments=[];
function App(){const [s,set]=useState(initial);const animation=useMoveAnimation(s,0,false);useEffect(()=>{if(animation)window.segments.push(animation.segment)},[animation?.segment]);return <><button onClick={()=>set({...next})}>move</button><span id="animation">{animation?animation.segment:'idle'}</span><span id="version">{s.version}</span></>};createRoot(document.getElementById('app')).render(<App/>);
`},bundle:true,write:false,format:'iife',platform:'browser'})
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js.outputFiles[0].text:'<div id="app"></div><script src="/app.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,executablePath:process.env.GAME_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 for(const reducedMotion of ['no-preference','reduce']){
  const context=await browser.newContext({reducedMotion});const page=await context.newPage();await page.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);let first=true;window.requestAnimationFrame=cb=>raf(t=>{if(first){first=false;cb(t-1000)}else cb(t)})});await page.goto('http://127.0.0.1:'+server.address().port)
  await page.getByRole('button',{name:'move'}).click();await page.waitForFunction(()=>document.querySelector('#version').textContent==='2'&&document.querySelector('#animation').textContent==='idle')
  const segments=await page.evaluate(()=>window.segments)
  if(reducedMotion==='reduce'?segments.length!==0:JSON.stringify(segments)!=='[0,1]')throw Error('unexpected segments '+JSON.stringify(segments))
  await page.getByRole('button',{name:'move'}).click();await page.waitForTimeout(100)
  if(JSON.stringify(await page.evaluate(()=>window.segments))!==JSON.stringify(segments))throw Error('duplicate snapshot replayed')
  await context.close()
 }
 console.log('PASS: two sequential jump segments, duplicate suppression, reduced-motion fallback')
}finally{await browser.close();await new Promise(r=>server.close(r))}
