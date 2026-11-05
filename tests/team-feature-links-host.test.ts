import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import type { ArkmeTeam } from '../src/types.js'
import type { TeamFeatureLinks } from '../src/team-feature-links-contract.js'

function host(options: { userId?: number; token?: string; url?: string; transport?: typeof fetch } = {}) {
  let session = { userId: options.userId ?? 11, accessToken: options.token ?? 'isolated-token', refreshToken: 'isolated-refresh' }
  const requests: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname; requests.push(path)
    if (path.endsWith('/list-mine')) return new Response(JSON.stringify({ code: 200, data: { teams: [{ team_id: '7', name: '隔离团队', jotmo_id: 'feature_test', role: session.userId === 11 ? 1 : 3 }] } }))
    return await (options.transport ?? fetch)(input, init)
  }
  const runtime = new ServiceRuntime({ environment: 'test', teamBaseUrl: options.url ?? 'https://isolated.team.invalid', routePath: '/api', requestTimeoutMs: 5000, maxTextLength: 20000 } as ArkmeServiceConfig,
    { read: async () => ({ ...session }) } as ArkmeSessionStore, { uniqueCode: async () => 'feature-links-isolated-host' } as StateStore, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => ({ ...session }))
  vi.spyOn(runtime, 'accountScopedSession').mockImplementation(async () => ({ ...session }))
  const app = new TeamAppService(runtime, {} as never)
  return { app, requests, changeAccount: () => { session = { ...session, userId: 12 } }, async teamRef() { return (await app.execute('team.app.teams', {}) as ArkmeTeam[])[0]!.teamRef } }
}

it('rejects invalid or cross-account references and unsafe link commands before sending a write', async () => {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 200, data: { schema_version: 1, revision: 0, max_items: 20, can_manage: true, items: [] } })))
  const h = host({ transport }), teamRef = await h.teamRef()
  await expect(h.app.execute('team.app.feature-links.get', { teamRef, expectedAccountKey: 'test:12' })).rejects.toThrow('账号')
  for (const params of [{ teamRef: 'forged' }, { teamRef, requestUid: randomUUID(), expectedRevision: 0, items: [{ id: randomUUID(), name: '后台', url: 'javascript:alert(1)' }] }, { teamRef, requestUid: randomUUID(), expectedRevision: 0, items: null }])
    await expect(h.app.execute('team.app.feature-links.save', { ...params, expectedAccountKey: 'test:11' })).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
  h.changeAccount()
  await expect(h.app.execute('team.app.feature-links.get', { teamRef, expectedAccountKey: 'test:12' })).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
})

it('rejects a malformed snapshot instead of treating an unsupported provider as an empty editable list', async () => {
  const h = host({ transport: async () => new Response(JSON.stringify({ code: 200, data: { items: [] } })) }), teamRef = await h.teamRef()
  await expect(h.app.execute('team.app.feature-links.get', { teamRef })).rejects.toThrow()
})

it.skipIf(!process.env.ARKME_FEATURE_LINKS_FIXTURE)('Host -> JWT-authenticated Team HTTP -> isolated Mongo persists links and enforces member access', async () => {
  const fixture = JSON.parse(await readFile(process.env.ARKME_FEATURE_LINKS_FIXTURE!, 'utf8')) as { url: string; tokens: Record<string, string> }
  const owner = host({ url: fixture.url, token: fixture.tokens.owner }), teamRef = await owner.teamRef()
  const current = await owner.app.execute('team.app.feature-links.get', { teamRef, expectedAccountKey: 'test:11' }) as TeamFeatureLinks
  const items = [{ id: randomUUID(), name: '总后台', url: 'https://admin.example.com/' }], command = { teamRef, expectedAccountKey: 'test:11', requestUid: randomUUID(), expectedRevision: current.revision, items }
  const saved = await owner.app.execute('team.app.feature-links.save', command) as TeamFeatureLinks
  expect(saved).toMatchObject({ revision: current.revision + 1, canManage: true, items })
  expect(await owner.app.execute('team.app.feature-links.save', command)).toEqual(saved)
  const member = host({ userId: 13, token: fixture.tokens.member, url: fixture.url }), memberRef = await member.teamRef()
  expect(await member.app.execute('team.app.feature-links.get', { teamRef: memberRef, expectedAccountKey: 'test:13' })).toMatchObject({ items, canManage: false })
  await expect(member.app.execute('team.app.feature-links.save', { ...command, teamRef: memberRef, expectedAccountKey: 'test:13', expectedRevision: saved.revision, requestUid: randomUUID(), items: [] })).rejects.toThrow('所有者或管理员')
  const restarted = host({ token: fixture.tokens.owner, url: fixture.url }), newRef = await restarted.teamRef()
  expect(await restarted.app.execute('team.app.feature-links.get', { teamRef: newRef })).toMatchObject({ items, revision: saved.revision })
  await expect(owner.app.execute('team.app.feature-links.save', { ...command, requestUid: randomUUID() })).rejects.toThrow('其他人修改')
  await owner.app.execute('team.app.feature-links.save', { ...command, expectedRevision: saved.revision, requestUid: randomUUID(), items: [] })
  expect((await member.app.execute('team.app.feature-links.get', { teamRef: memberRef }) as TeamFeatureLinks).items).toEqual([])
})
