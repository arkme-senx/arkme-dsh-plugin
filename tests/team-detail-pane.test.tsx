import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArkmeTeamMemberPage } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { TeamDetailPane } from '../src/client/redesign/contacts/TeamDetailPane.js'

const teamRefA = `team_v1_${'a'.repeat(32)}`
const teamRefB = `team_v1_${'b'.repeat(32)}`

function page(teamRef: string, name: string, overrides: Partial<ArkmeTeamMemberPage> = {}): ArkmeTeamMemberPage {
  return {
    team: {
      teamRef,
      name,
      jotmoId: name === '团队 A' ? 'team_a' : 'team_b',
      currentUserRole: 'member',
      createdAtMillis: 1,
      updatedAtMillis: 2,
    },
    items: [{
      userRef: `usr_v1_${'u'.repeat(32)}`,
      displayName: `${name}成员`,
      jotmoId: 'member_id',
      identityState: 'ready',
      role: 'owner',
      joinedAtMillis: 1,
    }],
    totalCount: 1,
    hasMore: false,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const match = renderer.root.findAllByType('button').find(node => text(node) === label)
  if (match === undefined) throw new Error(`button not found: ${label}`)
  return match
}

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('TeamDetailPane', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => { mocks.callArkme.mockReset() })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    renderer = undefined
  })

  it('renders owner membership facts and identity degradation without inventing identity data', async () => {
    mocks.callArkme.mockResolvedValue(page(teamRefA, '团队 A', {
      items: [{
        userRef: `usr_v1_${'u'.repeat(32)}`,
        displayName: '身份待恢复成员',
        identityState: 'unavailable',
        role: 'owner',
        joinedAtMillis: 1,
      }],
    }))

    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })

    expect(mocks.callArkme).toHaveBeenCalledWith('team.members.list', { teamRef: teamRefA, limit: 50 }, expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ 'data-team-ref': teamRefA })).toBeDefined()
    expect(text(renderer!.root)).toContain('团队 A')
    expect(text(renderer!.root)).toContain('所有者 · 身份信息暂不可用')
  })

  it('uses the opaque next cursor and merges a later member page without duplicating rows', async () => {
    const second = deferred<ArkmeTeamMemberPage>()
    mocks.callArkme
      .mockResolvedValueOnce(page(teamRefA, '团队 A', { hasMore: true, nextPageCursor: 'cursor_v1_next', totalCount: 2 }))
      .mockImplementationOnce(async () => await second.promise)
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })

    await act(async () => { button(renderer!, '加载更多成员').props.onClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenLastCalledWith('team.members.list', {
      teamRef: teamRefA,
      limit: 50,
      pageCursor: 'cursor_v1_next',
    }, expect.any(AbortSignal))
    expect(text(renderer!.root)).toContain('加载中…')

    second.resolve(page(teamRefA, '团队 A', {
      items: [
        {
          userRef: `usr_v1_${'u'.repeat(32)}`,
          displayName: '更新后的成员',
          jotmoId: 'member_id',
          identityState: 'ready',
          role: 'owner',
          joinedAtMillis: 1,
        },
        {
          userRef: `usr_v1_${'v'.repeat(32)}`,
          displayName: '第二位成员',
          identityState: 'incomplete',
          role: 'member',
          joinedAtMillis: 2,
        },
      ],
      totalCount: 2,
    }))
    await act(async () => { await tick() })

    expect(renderer!.root.findAllByProps({ role: 'listitem' })).toHaveLength(2)
    expect(text(renderer!.root)).not.toContain('团队 A成员')
    expect(text(renderer!.root)).toContain('更新后的成员')
    expect(text(renderer!.root)).toContain('成员 · 身份信息不完整')
  })

  it('aborts the previous account generation and ignores its late result', async () => {
    const first = deferred<ArkmeTeamMemberPage>()
    let firstSignal: AbortSignal | undefined
    mocks.callArkme
      .mockImplementationOnce(async (_operation, _params, signal?: AbortSignal) => {
        firstSignal = signal
        return await first.promise
      })
      .mockResolvedValueOnce(page(teamRefB, '团队 B'))

    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })
    await act(async () => { renderer!.update(<TeamDetailPane accountKey="account-b" teamRef={teamRefB} />); await tick() })

    expect(firstSignal?.aborted).toBe(true)
    expect(text(renderer!.root)).toContain('团队 B')
    first.resolve(page(teamRefA, '团队 A'))
    await act(async () => { await tick() })
    expect(text(renderer!.root)).not.toContain('团队 A')
    expect(renderer!.root.findByProps({ 'data-team-ref': teamRefB })).toBeDefined()
  })
})
