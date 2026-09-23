import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import { SourceService } from '../src/services/source-service.js'
import { GroupService } from '../src/services/group-service.js'
import { CallHistoryService } from '../src/services/call-history-service.js'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { ARKME_PROVIDER_CONTRACT_VERSION } from '../src/types.js'
import { CommonGroupService } from '../src/services/common-group-service.js'
import { SocialAccessStore } from '../src/client/social-access-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture(initial: boolean | null, state?: StateStore) {
  let allowed = initial
  let personalBot = false
  const session = { userId: 42, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
  const sessions = { read: vi.fn(async () => session), write: vi.fn(), delete: vi.fn() }
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/social-access/status') {
      if (allowed === null) throw new Error('account owner unavailable')
      return Response.json({ code: 200, data: { allowed } })
    }
    if (path === '/api/v1/chats/detail') return Response.json({ code: 200, data: { session: { is_personal_bot: personalBot } } })
    if (path === '/api/v1/chats/members/update') return Response.json({ code: 200, data: {} })
    throw new Error(`Unexpected business request: ${path}`)
  })
  const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test', requestTimeoutMs: 100 } as ArkmeServiceConfig,
    sessions, state ?? { uniqueCode: async () => 'fixture-signing-key' } as StateStore, fetcher)
  const source = new SourceService(runtime, {} as never, {} as never)
  return { runtime, source, sessions, fetcher, setAllowed(value: boolean | null) { allowed = value }, setPersonalBot() { personalBot = true } }
}

describe('social business boundaries with the real account adapter', () => {
  it('does not cool unrelated account requests or delay recovery after a qualification HTTP failure', async () => {
    const f = fixture(true)
    try {
      f.fetcher.mockResolvedValueOnce(new Response('', { status: 503 }))
      expect(await f.runtime.socialAccess.status()).toMatchObject({ allowed: null })
      f.fetcher.mockResolvedValueOnce(Response.json({ code: 200, data: { nick_name: 'Personal profile' } }))
      await expect(f.runtime.authenticatedAuthPost('/api/v1/auth/get-user-info', {}, undefined,
        AbortSignal.timeout(250))).resolves.toEqual({ nick_name: 'Personal profile' })
      f.setAllowed(false)
      expect(await f.runtime.socialAccess.status(true)).toMatchObject({ allowed: false })
      expect(f.fetcher).toHaveBeenCalledTimes(3)
      expect(f.sessions.write).not.toHaveBeenCalled()
      expect(f.sessions.delete).not.toHaveBeenCalled()
    } finally { f.source.dispose(); f.runtime.dispose() }
  })

  it('refreshes after a same-account write through UI store, SDK and Host without joining the older owner read', async () => {
    const f = fixture(false)
    const service = {
      socialAccessStatus: () => f.runtime.socialAccess.status(true),
      providerCapabilities: () => ({ contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { socialAccess: true } }),
    }
    const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body))
      return Response.json({ ok: true, value: await dispatchArkmeHostOperation(service as never, request.operation, request.params ?? {}) })
    } })
    const store = new SocialAccessStore(() => sdk.socialAccess())
    try {
      store.activate('test:42', 1); await store.refresh()
      expect(store.getSnapshot().allowed).toBe(false)
      let release!: (response: Response) => void
      let started!: () => void
      const startedRequest = new Promise<void>(resolve => { started = resolve })
      f.fetcher.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve }) })
      const stale = store.refresh(); await startedRequest
      // The existing successful binding flow already invalidates this scope.
      f.runtime.invalidateScope(f.runtime.requestScope(42)); f.setAllowed(true)
      store.activate('test:42', 2)
      await store.refresh()
      expect(store.getSnapshot().allowed).toBe(true)
      expect(f.fetcher).toHaveBeenCalledTimes(3)
      release(Response.json({ code: 200, data: { allowed: false } })); await stale
      expect(store.getSnapshot().allowed).toBe(true)
    } finally { f.source.dispose(); f.runtime.dispose() }
  })

  it.each([false, null])('checks eligibility before returning persisted common groups through Host, SDK and Tool: %s', async allowed => {
    const path = await mkdtemp(join(tmpdir(), 'social common groups '))
    const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
    const f = fixture(true, db)
    const owner = new CommonGroupService(f.runtime, f.source)
    const ctx = new Context()
    const scope = JSON.stringify(['test', 'https://chat.test', 42])
    const peer = 'private-peer'
    const checkpoint = db.commonGroups.read(scope, peer).checkpoint
    db.commonGroups.apply(scope, peer, checkpoint, { items: [{ uid: 'group', title: 'Existing group', memberCount: 3 }], removed: [], phase: 'complete', after: '' })
    const service = {
      listCommonGroups: owner.list.bind(owner), syncCommonGroups: owner.sync.bind(owner),
      providerCapabilities: () => ({ contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { commonGroups: true } }),
    }
    try {
      const ref = await f.source.sealSourceRef(42, 'private_chat', peer, 'Peer')
      expect((await owner.list(ref)).items[0]?.source.displayName).toBe('Existing group')
      f.setAllowed(allowed)
      const read = vi.spyOn(db.commonGroups, 'read')
      const code = allowed === false ? 'PHONE_BINDING_REQUIRED' : 'SOCIAL_ACCESS_UNAVAILABLE'
      for (const operation of ['group.common.list', 'group.common.sync'] as const) {
        await expect(dispatchArkmeHostOperation(service as never, operation, { sourceRef: ref })).rejects.toMatchObject({ code })
      }
      const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body))
        return Response.json({ ok: true, value: await dispatchArkmeHostOperation(service as never, request.operation, request.params ?? {}) })
      } })
      await expect(sdk.listCommonGroups(ref)).rejects.toMatchObject({ code })
      await expect(sdk.syncCommonGroups(ref)).rejects.toMatchObject({ code })
      await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
      const session = ctx.sessions.create(); const agent = { id: session.id, session }
      registerArkmeTools(ctx, service as never, 'business')
      for (const sync of [false, true]) {
        const result = await ctx.tools.execute({ callId: CallId(`common-social-${sync}`), agent: agent as never,
          signal: new AbortController().signal, name: 'arkme_common_groups', arguments: { source_ref: ref, sync } })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result)).toContain(allowed === false ? '绑定手机号后可使用社交功能' : '社交服务暂时不可用')
      }
      expect(read).not.toHaveBeenCalled()
      expect(f.fetcher.mock.calls.every(([input]) => String(input).endsWith('/social-access/status'))).toBe(true)
      expect(f.sessions.write).not.toHaveBeenCalled(); expect(f.sessions.delete).not.toHaveBeenCalled()
      f.setAllowed(true)
      expect((await sdk.listCommonGroups(ref)).items[0]?.source.displayName).toBe('Existing group')
      expect(db.commonGroups.read(scope, peer).checkpoint.revision).toBe(1)
    } finally { owner.dispose(); f.source.dispose(); f.runtime.dispose(); db.close(); await ctx.fiber.dispose(); await rm(path, { recursive: true, force: true }) }
  })

  it.each([false, null])('hides root and rejects human operations before business/cache reads: %s', async allowed => {
    const f = fixture(allowed)
    try {
      const ref = await f.source.sealSourceRef(42, 'group_chat', 'group', 'Group')
      expect((await f.source.listSources('root')).items).toEqual([])
      const group = new GroupService(f.runtime, f.source, {} as never)
      const calls = new CallHistoryService(f.runtime, {} as never)
      const code = allowed === false ? 'PHONE_BINDING_REQUIRED' : 'SOCIAL_ACCESS_UNAVAILABLE'
      await expect(group.groupSettings(ref)).rejects.toMatchObject({ code })
      await expect(calls.listCallHistory()).rejects.toMatchObject({ code })
      expect(f.fetcher.mock.calls.every(([input]) => String(input).endsWith('/social-access/status'))).toBe(true)
      expect(f.sessions.write).not.toHaveBeenCalled()
      expect(f.sessions.delete).not.toHaveBeenCalled()
    } finally { f.runtime.dispose() }
  })

  it('requires trusted Bot identity while preserving personal sources and cleanup', async () => {
    const f = fixture(false)
    try {
      const personal = await f.source.sealSourceRef(42, 'send_to_self', 'self', 'Self')
      await expect(f.source.openAccessibleSourceRef(personal, 42)).resolves.toMatchObject({ kind: 'send_to_self' })
      expect(f.fetcher).not.toHaveBeenCalled()
      const direct = await f.source.sealSourceRef(42, 'private_chat', 'bot-or-human', 'Bot label is not authority')
      await expect(f.source.openAccessibleSourceRef(direct, 42)).rejects.toMatchObject({ code: 'PHONE_BINDING_REQUIRED' })
      f.setPersonalBot()
      await expect(f.source.openAccessibleSourceRef(direct, 42)).resolves.toMatchObject({ ownerRef: 'bot-or-human' })
      const group = await f.source.sealSourceRef(42, 'group_chat', 'group', 'Group')
      await expect(new GroupService(f.runtime, f.source, {} as never).leaveGroup(group)).resolves.toEqual({ status: 'ok' })
    } finally { f.runtime.dispose() }
  })

  it.each([true, false, null])('uses one owner through official DSH session, Host and SDK: %s', async allowed => {
    const f = fixture(allowed)
    const service = {
      socialAccessStatus: () => f.runtime.socialAccess.status(),
      providerCapabilities: () => ({ contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { socialAccess: true } }),
    }
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
      const session = ctx.sessions.create()
      const agent = { id: session.id, session }
      registerArkmeTools(ctx, service as never, 'business')
      expect(ctx.tools.schemas(agent as never).some(tool => tool.name === 'arkme_social_access')).toBe(true)
      const result = await ctx.tools.execute({ callId: CallId('social-access'), agent: agent as never,
        signal: new AbortController().signal, name: 'arkme_social_access', arguments: {} })
      expect(result.isError).toBe(false)
      const expected = await service.socialAccessStatus()
      expect(JSON.parse(String(result.value))).toEqual(expected)
      const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body))
        const value = await dispatchArkmeHostOperation(service as never, request.operation, request.params ?? {})
        return Response.json({ ok: true, value })
      } })
      expect(await sdk.socialAccess()).toEqual(expected)
      expect(JSON.stringify(expected)).not.toMatch(/token|phoneMasked|fixture-access/i)
    } finally { f.runtime.dispose(); await ctx.fiber.dispose() }
  })

  it('does not dispatch social access to a Provider without the published capability', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, value: { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: {} } }))
    await expect(createArkmeSdk({ fetchImpl: fetcher }).socialAccess()).rejects.toThrow('不支持社交资格查询')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
