import type {IncomingMessage,ServerResponse} from 'node:http'
export const SCREENSHOT_EDITOR_PATH='/arkme-self/screenshot'
export const SCREENSHOT_EDITOR_ASSET_PATH='/arkme-self/screenshot/editor.js'
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>截图</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script defer src="${SCREENSHOT_EDITOR_ASSET_PATH}"></script></body></html>`
/** Static editor only. Pixels remain in the desktop's authorized IPC lease. */
export function createScreenshotEditorRoutes(bundle:Buffer) {
 const handler=(content:Buffer|string,type:string)=>(request:IncomingMessage,response:ServerResponse)=>{
  if(request.method!=='GET'&&request.method!=='HEAD'){
   response.writeHead(405,{Allow:'GET, HEAD','Cache-Control':'no-store'}).end();return
  }
  response.writeHead(200,{
   'Content-Type':type,'Cache-Control':'no-store','X-Arkme-Screenshot-Editor':'1',
   'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
   'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  })
  response.end(request.method==='HEAD'?undefined:content)
 }
 return [
  {kind:'exact' as const,path:SCREENSHOT_EDITOR_PATH,handler:handler(html,'text/html; charset=utf-8')},
  {kind:'exact' as const,path:SCREENSHOT_EDITOR_ASSET_PATH,handler:handler(bundle,'application/javascript; charset=utf-8')},
 ]
}
