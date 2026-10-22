import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkoService } from '../../src/services/arko-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import type { ArkmeSessionCredentials } from '../../src/keychain-store.js'
import { MessageActionService } from '../../src/services/message-action-service.js'
import { LocalMessageActionCapabilityCodec } from '../../src/services/message-action-infrastructure.js'
const config: ArkmeServiceConfig = { environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test', recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test', imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test', relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test', routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: 'synthetic', interwovenMomentsEnabled: true }
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
const wireItem = { id: 1, session_id: 2, role: 3, type: 1, source_type: 1, status: 1, created_at_ms: 90000, order_at_ms: 100000, created_at: 90, content: '# 原始正文\n\n**你好**\n\n|a|b|', extra: '{}', reason_content: 'DO NOT EXPOSE' }
function protocol(options: { complete?: boolean; hash?: string; count?: number; body?: string; runStatus?: string; role?: 2 | 3; attachments?: unknown } = {}) {
  // Deliberate whitespace and key ordering exercise raw-byte hashing.
  const raw = ` { "item": ${JSON.stringify({ ...wireItem, ...(options.attachments === undefined ? {} : {attachments:options.attachments}), content: options.body ?? wireItem.content, ...(options.runStatus ? { run_status: options.runStatus } : {}), ...(options.role ? { role: options.role } : {}) })}, "kind":"item" }\n`
  const complete = JSON.stringify({ kind: 'complete', version: 'arko-export-v1', count: options.count ?? 1, bytes: Buffer.byteLength(raw), sha256: options.hash ?? createHash('sha256').update(raw).digest('hex') }) + '\n'
  return JSON.stringify({ kind: 'start', version: 'arko-export-v1' }) + '\n' + raw + (options.complete === false ? '' : complete)
}
async function setup(handler: (url: string, init?: RequestInit) => Promise<Response> = async () => new Response('{}')) {
  const directory = await mkdtemp(join(tmpdir(), 'arko history tests '))
  let session: ArkmeSessionCredentials | undefined = { userId: 7, accessToken: 'synthetic', refreshToken: 'synthetic-refresh' }
  const runtime = new ServiceRuntime({ ...config, fileStateDirectory: directory }, { async read() { return session }, async write(value) { session = value }, async delete() { session = undefined } }, { async uniqueCode() { return 'synthetic-profile-key' } } as StateStore,
    async (url, init) => handler(String(url), init))
  const actions = new MessageActionService({ requireSession: () => runtime.requireSession() } as never, {} as never, new LocalMessageActionCapabilityCodec(() => runtime.stateStore.uniqueCode()))
  const service = new ArkoService(runtime, new ProfileService(runtime), actions)
  cleanups.push(async () => { service.dispose(); runtime.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { service, runtime, actions, directory }
}
const json = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), { headers: { 'Content-Type': 'application/json' } })
const stream = (text: string, chunkBytes = 7) => { const bytes = Buffer.from(text); let at = 0; return new Response(new ReadableStream({ pull(controller) { if (at >= bytes.length) { controller.close(); return }; controller.enqueue(bytes.subarray(at, at += chunkBytes)) } }), { headers: { 'Content-Type': 'application/x-ndjson' } }) }
it('searches without action payloads, binds message locators to account, and reads complete original context', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/search') ? json({ items: [{ ...wireItem, snippet: '原始正文' }], has_more: true, next_cursor: 'signed', scanned: 500, consistency: 'live' }) : json({ items: [wireItem], has_before: false, has_after: false }))
  const { service, actions, runtime } = await setup(fetch)
  const project = vi.spyOn(actions, 'agentHistoryItem')
  const search = await service.arkoSearch({ keyword: '正文' })
  expect(project).not.toHaveBeenCalled()
  expect(search.items[0]).not.toHaveProperty('text')
  expect(search.items[0]).not.toHaveProperty('sessionId')
  expect(search.hasMore).toBe(true)
  const ref = search.items[0]!.messageRef
  const context = await service.arkoContext({ messageRef: ref, before: 0, after: 0 })
  expect(context.items[0]).toMatchObject({ text: wireItem.content, reasoning: '', createdAtMillis: 90000, orderAtMillis: 100000, sourceType: 1, messageActionCapabilities: { copyLink: false, forward: true } })
  expect(context.items[0]?.messageRef).toBe(ref)
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ session_id: 2, message_id: 1, before: 0, after: 0 })
  await runtime.writeSession({ userId: 9, accessToken: 'other', refreshToken: 'other' })
  await expect(service.arkoContext({ messageRef: ref })).rejects.toMatchObject({ code: 'arko-message-unavailable' })
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('uses read admission and cancellation, never the write lane or a legacy archive scan', async () => {
  const { service, runtime } = await setup(async () => json({ items: [], has_more: true, next_cursor: 'more', scanned: 500, consistency: 'live' }))
  const run = vi.spyOn(runtime.requestCoordinator, 'run')
  const signal = new AbortController().signal
  const page = await service.arkoMessages({}, signal)
  expect(page).toMatchObject({ items: [], hasMore: true, nextCursor: 'more' })
  expect(run.mock.calls.some(([request]) => request.lane === 'interactive-read' && request.service === 'intelligent')).toBe(true)
  await service.arkoSearch({ keyword: 'x', cursor: 'more' }, signal)
  expect(run.mock.calls.some(([request]) => request.lane === 'background-read')).toBe(true)
  await expect(service.arkoMessages({}, AbortSignal.abort())).rejects.toThrow()
  await expect(service.arkoSearch({ keyword: '   ' })).rejects.toMatchObject({ code: 'arko-history-invalid' })
})
it('verifies exact item bytes across split UTF8 chunks before publishing an independent Markdown artifact', async () => {
  const { service, directory } = await setup(async () => stream(protocol()))
  const result = await service.arkoExport()
  expect(result.count).toBe(1)
  const local = await service.readGeneratedFile(result.fileRef)
  expect(await readFile(local.path, 'utf8')).toContain('# 原始正文\n\n**你好**')
  expect(await readFile(local.path, 'utf8')).not.toContain('DO NOT EXPOSE')
  expect((await readdir(join(directory, 'generated-downloads'))).some(name => name.endsWith('.part'))).toBe(false)
})
it.each([{ complete: false }, { hash: 'invalid' }, { count: 2 }])('never publishes incomplete/invalid exports: %j', async bad => {
  const { service, directory } = await setup(async () => stream(protocol(bad)))
  await expect(service.arkoExport()).rejects.toMatchObject({ code: 'arko-export-incomplete' })
  expect(await readdir(join(directory, 'generated-downloads'))).toEqual([])
})
it('preserves plain user input safely, and keeps successful artifacts account scoped', async () => {
  const raw = protocol({ body: '```\n<script>plain</script>\n# user heading' }).replace('"role":3', '"role":2')
  // Recompute the digest after changing role in the wire frame.
  const lines = raw.trimEnd().split('\n'), itemLine = lines[1]! + '\n'
  lines[2] = JSON.stringify({ kind: 'complete', version: 'arko-export-v1', count: 1, bytes: Buffer.byteLength(itemLine), sha256: createHash('sha256').update(itemLine).digest('hex') })
  const { service, runtime } = await setup(async () => stream(lines.join('\n') + '\n'))
  const result = await service.arkoExport(), local = await service.readGeneratedFile(result.fileRef)
  expect(await readFile(local.path, 'utf8')).toContain('````text\n```\n<script>plain</script>\n# user heading\n````')
  await runtime.writeSession({ userId: 8, accessToken: 'other', refreshToken: 'other' })
  await expect(service.readGeneratedFile(result.fileRef)).rejects.toMatchObject({ code: 'generated-file-unavailable' })
})
it('keeps ordinary writes available during a slow export and cancels on account transition', async () => {
 let requested = false
 const cancelled = vi.fn()
 const bytes = Buffer.from(protocol({ complete: false }))
 const fetch = vi.fn(async (url: string) => {
   if (!url.endsWith('/export')) return json({ accepted: true })
   requested = true
   return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes) }, cancel: cancelled }), { headers: { 'Content-Type': 'application/x-ndjson' } })
 })
 const { service, runtime, directory } = await setup(fetch)
 const pending = service.arkoExport()
 // Attach the rejection handler before deliberately changing the account.
 const outcome = pending.then(() => 'unexpected-success', error => error)
 await vi.waitFor(() => expect(requested).toBe(true))
 await expect(runtime.authenticatedIntelligentPost('/api/v1/qa/new-msg-v2', { content: 'normal send' })).resolves.toEqual({ accepted: true })
 await runtime.writeSession({ userId: 9, accessToken: 'other', refreshToken: 'other' })
 expect(await outcome).toMatchObject({ code: 'arko-account-changed' })
 expect(cancelled).toHaveBeenCalled()
 expect(fetch.mock.calls.filter(([url]) => url.endsWith('/export'))).toHaveLength(1)
 expect(await readdir(join(directory, 'generated-downloads'))).toEqual([])
})
it('aborts a pending export without retry or a partial downloadable file', async () => {
 const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(protocol({ complete: false }))) } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
 const { service, directory } = await setup(fetch)
 const controller = new AbortController(), outcome = service.arkoExport(controller.signal).then(() => false, () => true)
 await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
 controller.abort()
 expect(await outcome).toBe(true)
 expect(fetch).toHaveBeenCalledOnce()
 expect(await readdir(join(directory, 'generated-downloads'))).toEqual([])
})

it('exports waiting and failed Run facts even when the stored message status is Normal', async () => {
 const { service } = await setup(async () => stream(protocol({ runStatus: 'waiting_user' })))
 const result = await service.arkoExport(), local = await service.readGeneratedFile(result.fileRef)
 expect(await readFile(local.path, 'utf8')).toContain('等待继续')
})

it('handles a large fragmented frame and many plain-text backtick runs without quadratic prefix copies or argument overflow', async () => {
 const body = '`a'.repeat(150000) + '中文 🟢'
 const { service } = await setup(async () => stream(protocol({ body, role: 2 }), 127))
 const result = await service.arkoExport(), local = await service.readGeneratedFile(result.fileRef)
 const markdown = await readFile(local.path, 'utf8')
 expect(markdown).toContain('```text\n' + body + '\n```')
 expect(result.count).toBe(1)
})

it('preserves local mark projection in both published and new history reads', async () => {
 const { service } = await setup(async () => json({ items: [wireItem], message_ls: [wireItem], has_more: false, scanned: 1, consistency: 'live' }))
 const project = vi.spyOn(service.localMarks, 'project').mockResolvedValue('local-mark-reference')
 expect((await service.arkoMessages()).items[0]?.localMarkRef).toBe('local-mark-reference')
 expect((await service.arkoHistoryPage()).items[0]?.localMarkRef).toBe('local-mark-reference')
 expect(project).toHaveBeenCalledTimes(2)
})

it('reports real counts with bounded notifications and isolates broken progress observers',async()=>{
 const {service}=await setup(async()=>stream(protocol()))
 const notify=vi.fn(()=>{throw new Error('view observer failed')})
 await expect(service.arkoExport(undefined,notify)).resolves.toMatchObject({count:1})
 expect(notify.mock.calls[0]).toEqual([{count:0}])
 expect(notify.mock.calls.at(-1)).toEqual([{count:1}])
 expect(notify.mock.calls.length).toBeLessThanOrEqual(3)
})
it('keeps search display identities stable while locator capabilities expire independently',async()=>{
 const {service}=await setup(async()=>json({items:[{...wireItem,snippet:'正文'}],has_more:false,scanned:1,consistency:'live'}))
 const first=await service.arkoSearch({keyword:'正文'}),next=await service.arkoSearch({keyword:'正文'})
 expect(first.items[0]?.messageKey).toBe('2:1')
 expect(next.items[0]?.messageKey).toBe(first.items[0]?.messageKey)
 expect(next.items[0]?.messageRef).not.toBe(first.items[0]?.messageRef)
})

it('uses canonical message creation time instead of embedded record/cache timestamps', async () => {
 const item = { ...wireItem, extra: JSON.stringify({ data: { send_at: 500, create_at: 600, update_at: 700 } }) }
 const { service } = await setup(async url => url.endsWith('/query')
  ? json({ items: [item], has_more: false, scanned: 1, consistency: 'live' })
  : json({ items: [item], has_before: false, has_after: false }))
 const page = await service.arkoMessages()
 expect(page.items[0]).toMatchObject({ createdAtMillis: wireItem.created_at_ms, orderAtMillis: wireItem.order_at_ms })
 const context = await service.arkoContext({ messageRef: page.items[0]!.messageRef!, before: 0, after: 0 })
 expect(context.items[0]).toMatchObject({ createdAtMillis: wireItem.created_at_ms, orderAtMillis: wireItem.order_at_ms })
})

const exportImage={type:'image',file_asset_uid:'5f964638-43a8-4f24-a380-6fec1482aaab',file_name:'photo.png',mime_type:'image/png',size:100,sha256:'a'.repeat(64),width:10,height:10}
it.each(['','文字与图片'])('exports original image descriptions for %j without publishing a binary or delivery URL',async body=>{
 const {service}=await setup(async()=>stream(protocol({role:2,body,attachments:[exportImage,exportImage]})))
 const exported=await service.arkoExport();const file=await service.readGeneratedFile(exported.fileRef);const text=await readFile(file.path,'utf8')
 expect(text).toContain('仅描述，不包含图片文件')
 expect(text.match(/photo.png/g)).toHaveLength(2)
 expect(text).toContain('image/png');expect(text).not.toContain(exportImage.file_asset_uid)
 if(body)expect(text).toContain(body)
})
it.each([{...exportImage,size:-1},{...exportImage,mime_type:'text/html'},{...exportImage,file_name:'injected\nheading'}])('rejects invalid image export metadata before publishing: %j',async image=>{
 const {service,directory}=await setup(async()=>stream(protocol({role:2,body:'',attachments:[image]})))
 await expect(service.arkoExport()).rejects.toMatchObject({code:'arko-export-incomplete'})
 expect(await readdir(join(directory,'generated-downloads')).catch(()=>[])).toEqual([])
})


it.each([2, 3] as const)('exports readable known emoji while preserving Markdown and unknown tokens for role %s', async role => {
 const body = '**收到** [jm_emoji:smiling_face]\n未知 [jm_emoji:not_a_known_emoji]，残缺 [jm_emoji:'
 const { service } = await setup(async () => stream(protocol({ role, body })))
 const exported = await service.arkoExport(), local = await service.readGeneratedFile(exported.fileRef)
 const text = await readFile(local.path, 'utf8')
 const projected = '**收到** 😊\n未知 [jm_emoji:not_a_known_emoji]，残缺 [jm_emoji:'
 expect(text).toContain(role === 2 ? '```text\n' + projected + '\n```' : projected)
 expect(text).not.toContain('[jm_emoji:smiling_face]')
 expect(exported.count).toBe(1)
})
it('validates raw emoji-bearing source bytes before publishing the readable export', async () => {
 const { service, directory } = await setup(async () => stream(protocol({ role: 2, body: '[jm_emoji:smiling_face]', hash: 'wrong-digest' })))
 await expect(service.arkoExport()).rejects.toMatchObject({ code: 'arko-export-incomplete' })
 expect(await readdir(join(directory, 'generated-downloads'))).toEqual([])
})
it('does not interpret emoji-like attachment names as message emoji', async () => {
 const image = { ...exportImage, file_name: '[jm_emoji:smiling_face].png' }
 const { service } = await setup(async () => stream(protocol({ role: 2, body: '[jm_emoji:smiling_face]', attachments: [image] })))
 const exported = await service.arkoExport(), local = await service.readGeneratedFile(exported.fileRef)
 const text = await readFile(local.path, 'utf8')
 expect(text).toContain('😊')
 expect(text).toContain(image.file_name)
})
