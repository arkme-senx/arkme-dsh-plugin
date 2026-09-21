import {afterEach,expect,it,vi} from 'vitest'
import {captureNativeScreenshot,nativeScreenshotBridge} from '../src/client/native-screenshot.js'
afterEach(()=>vi.unstubAllGlobals())
it('detects only the versioned native API',()=>{expect(nativeScreenshotBridge()).toBeUndefined();vi.stubGlobal('arkmeScreenshot',{version:2});expect(nativeScreenshotBridge()).toBeUndefined()})
it('cancels only its own request and drops a late result',async()=>{
 let resolve!:(v:unknown)=>void
 const capture=vi.fn(()=>new Promise(r=>{resolve=r})),cancel=vi.fn(async()=>{})
 vi.stubGlobal('arkmeScreenshot',{version:1,capture,cancel})
 const c=new AbortController(),promise=captureNativeScreenshot(c.signal)
 c.abort(); await expect(promise).rejects.toMatchObject({name:'AbortError'})
 expect(cancel).toHaveBeenCalledWith(capture.mock.calls[0]![0])
 resolve({status:'captured',contentBase64:'png'})
})
it('returns native edited PNG without invoking the legacy backend',async()=>{
 const result={status:'captured',contentBase64:'png',mimeType:'image/png',fileName:'截图.png'}
 vi.stubGlobal('arkmeScreenshot',{version:1,capture:async()=>result,cancel:async()=>{}})
 await expect(captureNativeScreenshot(new AbortController().signal)).resolves.toEqual(result)
})
