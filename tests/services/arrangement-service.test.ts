import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ArrangementService', () => {
  it('projects an account-bound arrangement reference', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: {
      list: [{ uid: 'arrangement-1', title: '整理架构', status: 1, reminder_enabled: true }],
      total: 1,
    } }), { status: 200 })) as typeof fetch
    const service = new ArrangementService(new ServiceRuntime(config, sessions, stateStore, fetchImpl))

    const page = await service.listArrangements()
    expect(page.items).toEqual([expect.objectContaining({
      title: '整理架构', status: 'identified', reminderEnabled: true,
      arrangementRef: expect.stringMatching(/^arkme-arrangement-v1\./),
    })])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

it.each([
  [{ description: 'summary', source: { source_items: [{ text: '原始输入', create_at: 100 }] } }, { kind: 'input', items: [{ text: '原始输入', createdAtMillis: 100 }], unavailableCount: 0 }],
  [{ source_text: '旧版原文' }, { kind: 'input', items: [{ text: '旧版原文' }], unavailableCount: 0 }],
  [{ record_uids: ['private-record'], related_records: [{ uid: 'private-record', text_content: '快记原文', create_at: 200 }], source_text: '原始输入' }, { kind: 'input', items: [{ text: '原始输入' }], unavailableCount: 0 }],
  [{ record_uids: ['private-record'] }, { kind: 'quick-note', items: [], unavailableCount: 1 }],
  [{ description: 'only summary' }, { kind: 'none', items: [], unavailableCount: 0 }],
])('preserves creation source without leaking owner identities: %j', async (fields, expected) => {
  const sessions = { async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} } as ArkmeSessionStore
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { list: [{ uid: 'a', title: 't', status: 1, ...fields }], total: 1 } }), { status: 200 })) as typeof fetch
  const service = new ArrangementService(new ServiceRuntime(config, sessions, { async uniqueCode() { return 'secret' } } as StateStore, fetchImpl))
  const page = await service.listArrangements()
  expect(page.items[0]).toHaveProperty('creationSource', expected)
  expect(JSON.stringify(page)).not.toContain('private-record')
})

function deletedService(respond: (path: string, body: Record<string, unknown>) => unknown) {
  let userId = 42
  const sessions = { async read() { return {userId,accessToken:'access',refreshToken:'refresh'} }, async write(){}, async delete(){} } as ArkmeSessionStore
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => new Response(JSON.stringify({code:200,data:respond(String(url),JSON.parse(String(init?.body??'{}')))}))) as typeof fetch
  return { service:new ArrangementService(new ServiceRuntime(config,sessions,{async uniqueCode(){return 'secret'}} as StateStore,fetchImpl)), fetchImpl, switchAccount:()=>{userId=99} }
}
it('reads status 4 separately and returns a read-only opaque deleted projection', async () => {
  const {service,fetchImpl} = deletedService((_path,body) => {
    expect(body).toEqual({status:4,limit:50,offset:10})
    return {list:[{uid:'owner-deleted',status:4,title:'已删除的任务',description:'保留说明',update_at:100}],total:70}
  })
  const page = await service.deletedArrangements({limit:999,offset:10})
  expect(page).toMatchObject({items:[{title:'已删除的任务',description:'保留说明',status:'deleted',arrangementRef:expect.stringMatching(/^arkme-arrangement-v1\./)}],total:70,hasMore:true,nextOffset:11})
  expect(JSON.stringify(page)).not.toContain('owner-deleted')
  expect(fetchImpl).toHaveBeenCalledOnce()
})
it('rejects a server that returned live items for a deleted-only request', async () => {
  const {service} = deletedService(()=>({list:[{uid:'a',status:1,title:'活跃任务'}],total:1}))
  await expect(service.deletedArrangements()).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})
it('checks deleted detail identity and status and keeps references account-bound', async () => {
  const {service,switchAccount,fetchImpl} = deletedService((path,body)=>path.endsWith('/detail')
    ? {uid:body.uid,status:4,title:'删除详情'} : {list:[{uid:'a',status:4,title:'t'}],total:1})
  const ref = (await service.deletedArrangements()).items[0]!.arrangementRef
  await expect(service.deletedArrangementDetail(ref)).resolves.toMatchObject({arrangementRef:ref,status:'deleted',title:'删除详情'})
  switchAccount(); const before = vi.mocked(fetchImpl).mock.calls.length
  await expect(service.deletedArrangementDetail(ref)).rejects.toBeDefined()
  expect(fetchImpl).toHaveBeenCalledTimes(before)
})
it.each([{uid:'other',status:4},{uid:'a',status:2}])('rejects a changed deleted-detail response: %j', async response => {
  const {service} = deletedService(path=>path.endsWith('/detail')?response:{list:[{uid:'a',status:4}],total:1})
  const ref = (await service.deletedArrangements()).items[0]!.arrangementRef
  await expect(service.deletedArrangementDetail(ref)).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})
