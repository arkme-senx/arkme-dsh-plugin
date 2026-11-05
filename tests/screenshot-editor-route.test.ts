import {createServer} from 'node:http'
import {afterEach,expect,it} from 'vitest'
import {createScreenshotEditorRoutes,SCREENSHOT_EDITOR_PATH,SCREENSHOT_EDITOR_ASSET_PATH} from '../src/screenshot-editor-route.js'
const servers:ReturnType<typeof createServer>[]=[]
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))))})
async function start(){
 const routes=createScreenshotEditorRoutes(Buffer.from('/* standalone editor */'))
 const server=createServer((req,res)=>{const route=routes.find(r=>r.path===new URL(req.url!,'http://localhost').pathname);if(route)route.handler(req,res);else res.writeHead(404).end()})
 servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address() as {port:number};return `http://127.0.0.1:${address.port}`
}
it('serves a standalone document with no Harness boot graph or business network access',async()=>{
 const base=await start(),response=await fetch(base+SCREENSHOT_EDITOR_PATH+'?arkmeScreenshot=1'),html=await response.text()
 expect(response.headers.get('x-arkme-screenshot-editor')).toBe('1')
 expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'")
 expect(html).toContain(SCREENSHOT_EDITOR_ASSET_PATH)
 expect(html).not.toMatch(/__DSH_BOOT__|__ModuleLoader__|client\.js|iframe|websocket/i)
 expect(html.match(/<script/g)).toHaveLength(1)
 const asset=await fetch(base+SCREENSHOT_EDITOR_ASSET_PATH)
 expect(await asset.text()).toBe('/* standalone editor */')
})
it('supports capability HEAD probes without transferring the bundle and rejects writes',async()=>{
 const base=await start()
 for(const path of [SCREENSHOT_EDITOR_PATH,SCREENSHOT_EDITOR_ASSET_PATH]){
  const head=await fetch(base+path,{method:'HEAD'})
  expect(head.status).toBe(200);expect(await head.text()).toBe('')
  expect((await fetch(base+path,{method:'POST'})).status).toBe(405)
 }
})
