import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import type { ArkmePluginOperation } from '../src/types.js'
import type { TeamServicePort } from '../src/services/team-service.js'

const teamRef = `team_v1_${'a'.repeat(32)}`

function teamFixture(): TeamServicePort {
  return {
    list: vi.fn(async options => ({ items: [], totalCount: 0, hasMore: false, options } as never)),
    resolve: vi.fn(async items => items.map(item => ({ itemId: item.itemId, candidates: [], hasMore: false }))),
    listMembers: vi.fn(async () => ({
      team: { teamRef, name: '架构组', jotmoId: 'team_arch', currentUserRole: 'owner', createdAtMillis: 1, updatedAtMillis: 1 },
      items: [], totalCount: 0, hasMore: false,
    })),
    create: vi.fn(async items => items.map(item => ({
      itemId: item.itemId, status: 'rejected' as const, reason: 'jotmo_id_unavailable' as const,
    }))),
    joinByJotmoID: vi.fn(async items => items.map(item => ({
      itemId: item.itemId, status: 'rejected' as const, reason: 'team_not_found' as const,
    }))),
    listDirectory: vi.fn(async () => ({ section: 'teams', items: [], total: 0, hasMore: false })),
  }
}

async function dispatchTeam(
  service: object,
  team: TeamServicePort,
  operation: ArkmePluginOperation,
  params: Record<string, unknown>,
): Promise<unknown> {
  return await dispatchArkmeHostOperation(
    service as never, operation, params,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    team,
  )
}

describe('Team Host and SDK contract', () => {
  it('routes Team and Team-directory operations through the injected business interface', async () => {
    const team = teamFixture()
    const service = { listDirectory: vi.fn() }

    await dispatchTeam(service, team, 'team.members.list', { teamRef, limit: 20 })
    await dispatchTeam(service, team, 'directory.list', { section: 'teams', limit: 30 })

    expect(team.listMembers).toHaveBeenCalledWith(teamRef, expect.objectContaining({ limit: 20 }))
    expect(team.listDirectory).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }))
    expect(service.listDirectory).not.toHaveBeenCalled()
  })

  it('advertises Team features only when the Team business interface is installed', async () => {
    const service = {
      providerCapabilities: () => ({ contractVersion: 1, provider: 'provider', sdk: 'sdk', environment: 'test', features: {} }),
    }
    const withTeam = await dispatchTeam(service, teamFixture(), 'provider.capabilities', {}) as { features: Record<string, unknown> }
    const withoutTeam = await dispatchArkmeHostOperation(service as never, 'provider.capabilities', {}) as { features: Record<string, unknown> }

    expect(withTeam.features).toMatchObject({ teamDirectory: true, teamMembers: true, teamGovernance: true })
    expect(withoutTeam.features).not.toHaveProperty('teamDirectory')
  })

  it('rejects malformed optional Team parameter types instead of silently applying defaults', async () => {
    const team = teamFixture()

    await expect(dispatchTeam({}, team, 'team.list', { limit: '20' }))
      .rejects.toMatchObject({ code: 'team-input-invalid', httpStatus: 400 })
    await expect(dispatchTeam({}, team, 'team.list', { pageCursor: 42 }))
      .rejects.toMatchObject({ code: 'team-input-invalid', httpStatus: 400 })
    expect(team.list).not.toHaveBeenCalled()
  })

  it('requires the active same-origin Browser for Team governance mutations', async () => {
    const team = teamFixture()
    const server = createServer(createArkmeHostApi({} as never, {
      expectedPort: 3080,
      allowNonLoopback: false,
      teamService: team,
    }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    const endpoint = `http://127.0.0.1:${String(address.port)}/arkme-self/api`
    const body = JSON.stringify({
      operation: 'team.create',
      params: { items: [{ itemId: 'create-1', idempotencyKey: 'create-key-1', name: '新团队', jotmoId: 'team_new' }] },
    })
    try {
      const rejected = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      expect(rejected.status).toBe(403)
      expect(team.create).not.toHaveBeenCalled()

      const accepted = await fetch(endpoint, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:3080', 'Content-Type': 'application/json' },
        body,
      })
      expect(accepted.status).toBe(200)
      expect(team.create).toHaveBeenCalledOnce()
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('exposes typed SDK methods over the same Host operation contract', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { operation: string; params: Record<string, unknown> }
      return new Response(JSON.stringify({ ok: true, value: { operation: request.operation, params: request.params } }))
    }) as typeof fetch
    const sdk = new ArkmeSdk({ fetchImpl })

    await sdk.listTeamMembers(teamRef, { limit: 20, pageCursor: 'cur_v1_next' })
    await sdk.joinTeamsByJotmoID([{ itemId: 'join-1', jotmoId: 'team_arch' }])

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/arkme-self/api', expect.objectContaining({
      body: JSON.stringify({ operation: 'team.members.list', params: { teamRef, limit: 20, pageCursor: 'cur_v1_next' } }),
    }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/arkme-self/api', expect.objectContaining({
      body: JSON.stringify({ operation: 'team.join-by-jotmo-id', params: { items: [{ itemId: 'join-1', jotmoId: 'team_arch' }] } }),
    }))
  })
})
