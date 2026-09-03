import { describe, expect, it, vi } from 'vitest'

import { TeamService } from '../src/services/team-service.js'
import { OpenApiCapabilityError, type OpenApiTeamCapabilityClient } from '../src/openapi-capability-gateway.js'

const teamRef = `team_v1_${'a'.repeat(32)}`
const userRef = `usr_v1_${'b'.repeat(32)}`
const nextCursor = 'cur_v1_next-page'
const rawTeam = {
  team_ref: teamRef,
  name: '架构组',
  jotmo_id: 'team_arch',
  current_user_role: 'owner',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_001,
}

function fixture(overrides: Partial<OpenApiTeamCapabilityClient> = {}) {
  const client: OpenApiTeamCapabilityClient = {
    list: vi.fn(async () => ({ items: [rawTeam], total_count: 2, has_more: true, next_page_cursor: nextCursor })),
    resolve: vi.fn(async input => ({ items: input.items.map(item => ({
      item_id: item.item_id, candidates: [rawTeam], has_more: false,
    })) })),
    listMembers: vi.fn(async () => ({
      team: rawTeam,
      items: [{
        user_ref: userRef, display_name: '林一', jotmo_id: 'linyi', identity_state: 'ready',
        role: 'owner', joined_at: 1_700_000_000_000,
      }],
      total_count: 1, has_more: false,
    })),
    create: vi.fn(async input => ({ items: input.items.map(item => ({
      item_id: item.item_id, status: 'succeeded', team: rawTeam,
    })) })),
    joinByJotmoID: vi.fn(async input => ({ items: input.items.map(item => ({
      item_id: item.item_id, status: 'succeeded', membership_state: 'already_member', team: rawTeam,
    })) })),
    ...overrides,
  }
  return { client, service: new TeamService(client) }
}

describe('TeamService', () => {
  it('owns Team directory projection and preserves the canonical OpenAPI cursor', async () => {
    const { service, client } = fixture()
    await expect(service.listDirectory({ limit: 20 })).resolves.toEqual({
      section: 'teams',
      items: [{ kind: 'team', teamRef, displayName: '架构组', publicId: 'team_arch', role: 'owner' }],
      total: 2,
      hasMore: true,
      nextCursor,
    })
    expect(client.list).toHaveBeenCalledWith({ limit: 20 }, expect.any(AbortSignal))
  })

  it('projects member identity state and never converts members into contact capabilities', async () => {
    const { service } = fixture()
    const page = await service.listMembers(teamRef)
    expect(page).toEqual({
      team: {
        teamRef, name: '架构组', jotmoId: 'team_arch', currentUserRole: 'owner',
        createdAtMillis: 1_700_000_000_000, updatedAtMillis: 1_700_000_000_001,
      },
      items: [{
        userRef, displayName: '林一', jotmoId: 'linyi', identityState: 'ready', role: 'owner',
        joinedAtMillis: 1_700_000_000_000,
      }],
      totalCount: 1,
      hasMore: false,
    })
    expect(page.items[0]).not.toHaveProperty('contactRef')
  })

  it('keeps create and join governance results as distinct business contracts', async () => {
    const { service } = fixture({
      create: vi.fn(async () => ({ items: [{ item_id: 'create-1', status: 'rejected', reason: 'jotmo_id_unavailable' }] })),
      joinByJotmoID: vi.fn(async () => ({ items: [{ item_id: 'join-1', status: 'rejected', reason: 'team_not_found' }] })),
    })
    await expect(service.create([{
      itemId: 'create-1', idempotencyKey: 'create-key-1', name: '新团队', jotmoId: 'team-platform-architecture',
    }]))
      .resolves.toEqual([{ itemId: 'create-1', status: 'rejected', reason: 'jotmo_id_unavailable' }])
    await expect(service.joinByJotmoID([{ itemId: 'join-1', jotmoId: 'missing_team' }]))
      .resolves.toEqual([{ itemId: 'join-1', status: 'rejected', reason: 'team_not_found' }])
  })

  it('rejects malformed input and inconsistent owner output at the boundary', async () => {
    const malformed = fixture()
    await expect(malformed.service.resolve([{ itemId: 'duplicate', query: '架构组' }, { itemId: 'duplicate', query: 'team_arch' }]))
      .rejects.toMatchObject({ code: 'team-input-invalid' })
    await expect(malformed.service.resolve([{ itemId: '项'.repeat(22), query: '架构组' }]))
      .rejects.toMatchObject({ code: 'team-input-invalid' })
    await expect(malformed.service.create([
      { itemId: 'one', idempotencyKey: 'same-key', name: '团队一', jotmoId: 'team_one' },
      { itemId: 'two', idempotencyKey: 'same-key', name: '团队二', jotmoId: 'team_two' },
    ])).rejects.toMatchObject({ code: 'team-input-invalid' })

    const inconsistent = fixture({
      create: vi.fn(async () => ({ items: [{
        item_id: 'create-1', status: 'succeeded', membership_state: 'joined', team: rawTeam,
      }] })),
    })
    await expect(inconsistent.service.create([{ itemId: 'create-1', idempotencyKey: 'create-key-1', name: '新团队', jotmoId: 'team_new' }]))
      .rejects.toMatchObject({ code: 'team-openapi-invalid-response' })

    const inconsistentRole = fixture({
      create: vi.fn(async () => ({ items: [{
        item_id: 'create-1', status: 'succeeded', team: { ...rawTeam, current_user_role: 'member' },
      }] })),
      joinByJotmoID: vi.fn(async () => ({ items: [{
        item_id: 'join-1', status: 'succeeded', membership_state: 'joined',
        team: { ...rawTeam, current_user_role: 'owner' },
      }] })),
    })
    await expect(inconsistentRole.service.create([{
      itemId: 'create-1', idempotencyKey: 'create-key-1', name: '新团队', jotmoId: 'team_new',
    }])).rejects.toMatchObject({ code: 'team-openapi-invalid-response' })
    await expect(inconsistentRole.service.joinByJotmoID([{ itemId: 'join-1', jotmoId: 'team_arch' }]))
      .rejects.toMatchObject({ code: 'team-openapi-invalid-response' })
  })

  it('preserves caller cancellation instead of reporting an account switch', async () => {
    const abort = new AbortController()
    abort.abort(new DOMException('caller cancelled', 'AbortError'))
    const { service } = fixture({
      list: vi.fn(async (_input, signal) => {
        signal.throwIfAborted()
        return { items: [], total_count: 0, has_more: false }
      }),
    })

    await expect(service.list({ signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps missing and rejected managed credentials as distinct recovery states', async () => {
    const unavailable = fixture({ list: vi.fn(async () => {
      throw new OpenApiCapabilityError('login-required', '请先登录并等待 Arkme 开放平台连接就绪', true)
    }) })
    await expect(unavailable.service.list()).rejects.toMatchObject({ code: 'team-openapi-login-required' })

    const rejected = fixture({ list: vi.fn(async () => {
      throw new OpenApiCapabilityError('unavailable', 'Arkme 开放平台连接正在恢复，请稍后重试', true)
    }) })
    await expect(rejected.service.list()).rejects.toMatchObject({ code: 'team-openapi-unavailable' })
  })
})
