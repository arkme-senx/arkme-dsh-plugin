import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorldService } from '../src/services/world-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
const UID = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'
const runtimes: ServiceRuntime[] = []
afterEach(() => runtimes.splice(0).forEach(r => r.dispose()))
async function fixture(team = false) {
  let userId = 42, unified = 404, legacy = 200
  const raw: Record<string, unknown> = { record_uid: 'record-1', principal: team ? { kind: 'team', team_id: 123, name: '团队', jotmo_id: 'team_123' } : { kind: 'person', user_id: 7, name: '作者' }, text_content: '公开正文', check_status: 2, images: [], videos: [], voices: [] }
  const config = Object.fromEntries(['world','auth','subject','record','chat','bot','im','webrtc','relation','intelligent','audio'].map(s => [s+'BaseUrl','https://'+s+'.test'])) as unknown as ArkmeServiceConfig
  Object.assign(config, { environment: 'test', requestTimeoutMs: 500, maxTextLength: 20000 })
  const writes: { host: string; path: string; body: Record<string, unknown> }[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url))
    if (u.pathname.endsWith('/query')) return new Response(JSON.stringify({ code: 200, data: { items: [raw], has_more: false } }))
    if (u.pathname.endsWith('/read')) return new Response(JSON.stringify({ code: 200, data: raw }))
    writes.push({ host: u.hostname, path: u.pathname, body: JSON.parse(String(init?.body)) })
    if (u.hostname === 'world.test') return unified === 200 ? new Response(JSON.stringify({ code: 200, data: { submitted: true } })) : new Response('', { status: unified })
    return legacy === 200 ? new Response(JSON.stringify({ code: 0, data: null })) : new Response('', { status: legacy })
  })
  const runtime = new ServiceRuntime(config, { async read() { return { userId, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }, { async uniqueCode() { return 'report-test-secret' } } as StateStore, fetcher)
  runtimes.push(runtime)
  const world = new WorldService(runtime, {} as never, {} as never, {} as never)
  const target = (await world.listWorldFeed()).items[0]!.recordRef
  fetcher.mockClear()
  return { world, target, raw, writes, fetcher, changeAccount() { userId = 99 }, unified(n: number) { unified = n }, legacy(n: number) { legacy = n } }
}
describe('world content reporting', () => {
  it('revalidates public ownership and uses the existing Record contract for a person', async () => {
    const f = await fixture()
    expect(await f.world.reportWorldRecord(f.target, 42, 6, '  诈骗链接  ', UID)).toEqual({ submitted: true })
    expect(f.writes.at(-1)).toEqual({ host: 'record.test', path: '/api/v1/reports/create', body: { owner_id: 7, obj_type: 1, obj_id: 0, obj_uid: 'record-1', rm_subject_id: 0, report_type: 6, reason: '诈骗链接' } })
    expect(f.fetcher.mock.calls.map(([u]) => new URL(String(u)).pathname)).toEqual(['/api/public/v1/world/read','/api/v1/world/reports/create','/api/v1/reports/create'])
  })
  it('uses the unified publication contract when it is available', async () => {
    const f = await fixture(true); f.unified(200)
    expect(await f.world.reportWorldRecord(f.target,42,1,'问题',UID)).toEqual({ submitted:true })
    expect(f.writes).toEqual([{host:'world.test',path:'/api/v1/world/reports/create',body:{record_uid:'record-1',report_type:1,reason:'问题',request_uid:UID}}])
  })
  it('binds the current public revision when provided', async () => {
    const f = await fixture(); f.unified(200); f.raw.content_revision='current-revision'; await f.world.reportWorldRecord(f.target,42,1,'问题',UID); expect(f.writes[0]!.body.content_revision).toBe('current-revision')
  })
  it('never substitutes a team ID for an individual owner', async () => {
    const f = await fixture(true)
    await expect(f.world.reportWorldRecord(f.target,42,1,'问题',UID)).rejects.toMatchObject({code:'world-report-not-ready'})
    expect(f.writes).toHaveLength(1); expect(f.writes[0]!.body).not.toHaveProperty('owner_id')
  })
  it.each([[0,'问题',UID],[7,'问题',UID],[1,' ',UID],[1,'字'.repeat(501),UID],[1,'问题','forged']])('rejects invalid categories, empty/oversize reason or bad attempt',async(type,text,id)=>{
    const f=await fixture(); await expect(f.world.reportWorldRecord(f.target,42,Number(type),String(text),String(id))).rejects.toMatchObject({code:'world-report-invalid'});expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each([{record_uid:'other'},{is_public:false},{check_status:1},{check_status:4},{principal:{kind:'person',user_id:42,name:'自己'}}])('does not report stale, hidden or own content: %j',async patch=>{
    const f=await fixture();Object.assign(f.raw,patch);await expect(f.world.reportWorldRecord(f.target,42,1,'问题',UID)).rejects.toThrow();expect(f.writes).toHaveLength(0)
  })
  it('rejects a mismatched account before reading or writing',async()=>{
    const f=await fixture();await expect(f.world.reportWorldRecord(f.target,99,1,'问题',UID)).rejects.toMatchObject({code:'world-account-changed'});expect(f.fetcher).not.toHaveBeenCalled()
    f.changeAccount();await expect(f.world.reportWorldRecord(f.target,99,1,'问题',UID)).rejects.toThrow();expect(f.writes).toHaveLength(0)
  })
  it('does not fall back or assert success on an uncertain write',async()=>{
    const f=await fixture();f.unified(503);await expect(f.world.reportWorldRecord(f.target,42,1,'问题',UID)).rejects.toMatchObject({code:'world-report-unconfirmed'});expect(f.writes).toHaveLength(1)
    const g=await fixture();g.legacy(503);await expect(g.world.reportWorldRecord(g.target,42,1,'问题',UID)).rejects.toMatchObject({code:'world-report-unconfirmed'})
  })
  it('keeps a definite rate-limit rejection retryable instead of marking it uncertain',async()=>{
    const f=await fixture();f.unified(429);await expect(f.world.reportWorldRecord(f.target,42,1,'问题',UID)).rejects.toMatchObject({upstreamStatus:429});expect(f.writes).toHaveLength(1)
  })
  it('preserves auth rejection without attempting legacy submission',async()=>{
    const f=await fixture();f.unified(403);await expect(f.world.reportWorldRecord(f.target,42,1,'问题',UID)).rejects.toThrow();expect(f.writes.some(w=>w.host==='record.test')).toBe(false)
  })
})
