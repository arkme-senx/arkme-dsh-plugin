import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const checkout = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!checkout || !profile) throw new Error('Use a fresh profile installed by the official DSH CLI with the task tgz')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(checkout, 'apps/web/tests/scaffold.ts'))
const { chromium } = createRequire(join(checkout, 'apps/web/package.json'))('playwright')
const bootEntry = createRequire(join(checkout, 'apps/cli/package.json')).resolve('@deepseek-ai/dsh-app-boot')
const { healProfilesModuleFallback } = await importFile(bootEntry)
const manifest = JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Immutable tgz installation required')
const { createArkmeSdk, readCompleteRecordingTranscript } = await importFile(join(profile,'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
const recording = '123456789012345678901234', child = '234567890123456789012345', revision = 'a'.repeat(64)

// The Audio wire fixture is isolated. This lane verifies the real packed Host,
// SDK and browser on official DSH; Mongo/API integration runs in Audio's lane.
describe('packed recording pages on official DSH', () => {
  it('loads a bounded first page, exhausts search/export, decodes Opus and fences stale views', async () => {
    const root = await mkdtemp(join(tmpdir(),'arkme recording pages ')), failures = []
    const date = new Date(); date.setHours(0,0,0,0)
    const start = date.getTime(), requests = []
    let changed = false, scaffold, browser, page
    await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=2','-c:a','libopus','-b:a','24k','-application','voip',join(root,'sample.ogg')])
    const audio = await readFile(join(root,'sample.ogg'))
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req,res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
        const path = new URL(req.url,'https://localhost').pathname
        requests.push({ path, body, method: req.method })
        if (path.startsWith('/api/v1/audio/clips/')) {
          let begin = 0, end = audio.length-1
          const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
          if (range) { begin = Number(range[1]); if (range[2]) end = Math.min(end,Number(range[2])); res.statusCode = 206; res.setHeader('content-range',`bytes ${begin}-${end}/${audio.length}`) }
          res.setHeader('content-type','audio/ogg'); res.setHeader('content-length',String(end-begin+1)); res.setHeader('accept-ranges','bytes')
          res.end(req.method === 'HEAD' ? undefined : audio.subarray(begin,end+1)); return
        }
        let data = { items: [], users: [], has_more: false }
        if (path.endsWith('/the-best-api-for-testing')) data = { access_token: 'isolated-audio-fixture', refresh_token: 'isolated-refresh' }
        if (path.endsWith('/get-user-info')) data = { user_id: 10001, nick_name: '录音验收', phone: '13800000000' }
        if (path.endsWith('/recordings/query')) data = { items: [{ status:'available', recording_uid:recording, start_at:start, end_at:start+600_000, duration_ms:600_000, owner_version:1 }], has_more:false }
        if (path.endsWith('/recordings/transcript/query')) {
          const offset = Number(body.page_cursor ?? 0), count = Math.min(Number(body.limit),250-offset)
          data = { status:'available',recording_uid:recording,start_at:start,revision:changed ? 'b'.repeat(64) : revision,
            coverage:{ready_count:1,processing_count:0,failed_count:0,silent_count:0,candidate_count:0},
            speakers:[{reference:'speaker:bbbbbbbbbbbbbbbb',kind:'named',label:'录音验收'}],
            utterances:Array.from({length:count},(_,i) => {
              const ordinal=offset+i, text=ordinal===249?'页末唯一命中尾部':'独立原话 '+ordinal
              return { utterance_index:ordinal,clip_locator:{child_id:child,source:body.source,ordinal},speaker_index:0,
                start_offset_ms:ordinal*2000,end_offset_ms:ordinal*2000+2000,text,text_start_offset:0,text_end_offset:Array.from(text).length,text_total_length:Array.from(text).length }
            }),has_more:offset+count<250,...(offset+count<250?{next_page_cursor:String(offset+count)}:{}) }
        }
        if (path.endsWith('/playback/resolve')) data = { clip_ref:{...body,audio_revision:revision},content_path:`/api/v1/audio/clips/${child}/${body.source}/${body.ordinal}/${revision}`,content_type:'audio/ogg',duration_ms:2000 }
        if (path.endsWith('/get-calender-summary')) data = { duration_ls:[],un_click_session_ids_per_day:[] }
        if (path.endsWith('/list-timeline-by-range')) data = { audio_summary_ls:[] }
        res.setHeader('content-type','application/json'); res.end(JSON.stringify({code:200,data}))
      } catch { res.statusCode=500; res.end('isolated fixture failed') }
    })
    try {
      // Installed plugins import Host peers from their own profile ancestry.
      // Use the production launcher's public repair seam for this isolated home;
      // the scaffold separately prepares its own temporary profile.
      await healProfilesModuleFallback({
        installAnchor: join(checkout, 'apps/cli/package.json'),
        home: resolve(profile, '../..'),
      })
      proxy.listen(0,'127.0.0.1'); await once(proxy,'listening')
      const origin=`https://127.0.0.1:${proxy.address().port}`
      const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.recording-pages-${randomUUID()}`,
        allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business'}
      for (const key of ['auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService']) config[`${key}BaseUrl`]=origin
      config.shareWebsite=origin
      const overlay=join(root,'overlay.json'); await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-recording-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
      scaffold=await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')]})
      const service=scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(10001)).toMatchObject({status:'authenticated',userId:10001})
      browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome'})
      const context=await browser.newContext({viewport:{width:1680,height:1000},acceptDownloads:true})
      page=await context.newPage()
      await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'})
      await page.getByRole('button',{name:'录音',exact:true}).click()
      await expect.poll(() => page.locator('[data-recording-transcript-item]').count()).toBe(100)
      expect(requests.filter(req=>req.path.endsWith('/recordings/transcript/query')).map(req=>req.body.limit)).toEqual([1,100])
      await page.locator('[data-recording-transcript-item]').first().dblclick()
      await page.getByRole('button',{name:'播放录音',exact:true}).click()
      await page.getByRole('button',{name:'暂停录音',exact:true}).waitFor()
      expect(requests.some(req=>req.path.startsWith('/api/v1/audio/clips/'))).toBe(true)
      await page.getByRole('button',{name:'暂停录音',exact:true}).click()
      await page.getByRole('textbox',{name:'搜索当天转写',exact:true}).fill('页末唯一命中')
      await expect.poll(() => page.getByRole('status',{name:'搜索命中数'}).textContent()).toBe('1/1')
      await expect.poll(() => page.locator('[data-recording-transcript-item]').count()).toBe(250)
      const downloaded=page.waitForEvent('download')
      await page.getByRole('button',{name:'导出',exact:true}).click()
      const download=await downloaded
      const content=await readFile(await download.path(),'utf8')
      expect(content).toContain('独立原话 0'); expect(content).toContain('页末唯一命中尾部')
      const sdk=createArkmeSdk({fetchImpl:(url,init)=>scaffold.hostFetch(String(url),init)})
      const first=await sdk.recordingTranscriptPage(start)
      const complete=await readCompleteRecordingTranscript(first,cursor=>sdk.recordingTranscriptPage(start,{cursor}))
      expect(complete.items).toHaveLength(250)
      expect(JSON.stringify(first)).not.toMatch(/recording_uid|child_id|audio_revision/)
      changed=true
      await expect(sdk.recordingTranscriptPage(start,{cursor:first.nextCursor})).rejects.toThrow()
      expect(requests.some(req=>req.path.endsWith('/one-day-trans'))).toBe(false)
      if(process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT})
    } catch(error) { failures.push(error) }
    finally {
      const clean=async fn=>{try{await fn()}catch(error){failures.push(error)}}
      if(failures.length && page && process.env.ARKME_E2E_SCREENSHOT) await clean(()=>page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT}))
      await clean(()=>browser?.close())
      if(scaffold) await clean(()=>scaffold.ctx.get('arkmeData').logout())
      await clean(()=>scaffold?.close())
      proxy.closeAllConnections(); await clean(()=>new Promise(resolve=>proxy.close(resolve)))
      await clean(()=>rm(root,{recursive:true,force:true}))
      if(failures.length) throw new AggregateError(failures,'Packed recording page scenario or cleanup failed')
    }
  })
})
