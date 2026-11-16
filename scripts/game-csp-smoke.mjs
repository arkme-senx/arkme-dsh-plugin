// Real browser regression: Tencent's Blob-worker transport must be permitted.
import {build} from '../tools/desktop-call/node_modules/esbuild/lib/main.js'
import {createServer} from 'node:http'
const {chromium}=await import(process.env.GAME_PLAYWRIGHT_MODULE||'playwright')
const compiled=await build({entryPoints:['src/game-assets.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {createGameAssetHandler}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const server=createServer(createGameAssetHandler('/game'))
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,executablePath:process.env.GAME_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage()
 await page.route('**/game.js',r=>r.fulfill({contentType:'text/javascript',body:''}))
 await page.goto('http://127.0.0.1:'+server.address().port+'/game/index.html')
 const result=await page.evaluate(()=>new Promise(resolve=>{
  const timer=setTimeout(()=>resolve('timeout'),3000)
  const url=URL.createObjectURL(new Blob(['postMessage("ready")'],{type:'application/javascript'}))
  const worker=new Worker(url)
  worker.onmessage=e=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);resolve(e.data)}
  worker.onerror=()=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);resolve('worker-error')}
 }))
 if(result!=='ready')throw Error('Game document blocks IM Blob worker: '+result)
 console.log('PASS: actual game document CSP permits Blob-worker startup')
}finally{await browser.close();await new Promise(r=>server.close(r))}
