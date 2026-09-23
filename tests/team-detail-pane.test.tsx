import { arkmeContactsTab } from '../src/client/redesign/contacts/contacts-tab-store.js'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArkmeTeamMemberPage } from '../src/types.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { ArkmeUserAvatar } from '../src/client/ArkmeAvatar.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { TeamChannelSettings } from '../src/client/TeamMessagingPanel.js'

import { TeamDetailPane } from '../src/client/redesign/contacts/TeamDetailPane.js'
import { arkmeUi } from '../src/client/ui-controller.js'

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
  let avatarScope = 0

  beforeEach(() => {
    avatarScope += 1
    arkmeAvatarImages.activateScope(`team-detail:${String(avatarScope)}`)
    mocks.callArkme.mockReset()
    arkmeUi.authChanged(false)
  })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    arkmeAvatarImages.activateScope(undefined)
    renderer = undefined
  })

  it('keeps a failed leave on the existing Team detail and permits retry', async () => {
    const teamPage = page(teamRefA, '团队 A')
    let attempts = 0
    arkmeContactsTab.activateAccount('account-a')
    arkmeContactsTab.select({ kind: 'team', teamRef: teamRefA })
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'team.app.members') return teamPage
      if (operation === 'team.app.leave' && ++attempts === 1) throw new Error('退出失败')
      return { canManage: false, publicRef: '', enabled: false }
    })
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })
    await act(async () => { button(renderer!, '退出团队').props.onClick(); await tick() })
    expect(attempts).toBe(0)
    await act(async () => { button(renderer!, '确认退出').props.onClick(); await tick() })
    expect(arkmeContactsTab.getSnapshot().selection.kind).toBe('team')
    expect(text(renderer!.root)).toContain('退出失败')
    await act(async () => { button(renderer!, '确认退出').props.onClick(); await tick() })
    expect(attempts).toBe(2)
    expect(arkmeContactsTab.getSnapshot().selection.kind).toBe('none')
  })

  it('retains the current member view while refreshing after a message-setting change', async () => {
    const later = deferred<ArkmeTeamMemberPage>()
    let refresh = false
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'team.app.members'
      ? refresh ? await later.promise : page(teamRefA, '团队 A') : { canManage: false })
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })
    const detail = renderer!.root.findByProps({ 'data-team-ref': teamRefA })
    refresh = true
    await act(async () => { renderer!.root.findByType(TeamChannelSettings).props.onChanged(); await tick() })
    expect(renderer!.root.findByProps({ 'data-team-ref': teamRefA })).toBe(detail)
    expect(text(renderer!.root)).not.toContain('正在加载团队成员')
    await act(async () => { later.resolve(page(teamRefA, '团队 A', { totalCount: 2 })); await tick() })
    expect(renderer!.root.findByProps({ 'aria-label': '2 位成员' })).toBeDefined()
  })

  it('does not offer the owner a leave action', async () => {
    const teamPage = page(teamRefA, '团队 A')
    teamPage.team.currentUserRole = 'owner'
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'team.app.members' ? teamPage : { canManage: false })
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })
    expect(text(renderer!.root)).not.toContain('退出团队')
  })

  it('renders real member avatars and identity degradation without mixing their semantics', async () => {
    const teamPage = page(teamRefA, '团队 A', {
      items: [
        {
          userRef: `usr_v1_${'u'.repeat(32)}`,
          displayName: '头像成员',
          jotmoId: 'avatar_member',
          avatarRef: 'avatar-member-one',
          identityState: 'ready',
          role: 'owner',
          joinedAtMillis: 1,
        },
        {
          userRef: `usr_v1_${'v'.repeat(32)}`,
          displayName: '身份待恢复成员',
          identityState: 'unavailable',
          role: 'member',
          joinedAtMillis: 2,
        },
      ],
      totalCount: 2,
    })
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'team.app.members'
      ? teamPage
      : { mediaType: 'image/png', bytes: 1, dataBase64: 'AA==' })

    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })

    expect(mocks.callArkme).toHaveBeenCalledWith('team.app.members', { teamRef: teamRefA, limit: 50 }, expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ 'data-team-ref': teamRefA })).toBeDefined()
    expect(text(renderer!.root)).toContain('团队 A')
    expect(text(renderer!.root)).toContain('@team_a')
    expect(text(renderer!.root)).toContain('@avatar_member')
    expect(text(renderer!.root)).toContain('身份信息暂不可用')
    expect(renderer!.root.findByProps({ className: 'arkme-team-detail-header-main' })).toBeDefined()
    expect(renderer!.root.findByProps({ className: 'arkme-team-members-container' })).toBeDefined()
    expect(renderer!.root.findAllByProps({ className: 'arkme-team-detail-shell' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-team-role': 'member' })).toBeDefined()
    expect(renderer!.root.findByProps({ 'data-team-member-role': 'owner' })).toBeDefined()
    expect(renderer!.root.findAllByType(ArkmeUserAvatar).map(avatar => avatar.props.avatarRef))
      .toEqual(['avatar-member-one', undefined])
  })

  it('routes a member to the shared reader with an opaque identity, not their display name', async () => {
    const data=page(teamRefA,'团队 A')
    mocks.callArkme.mockResolvedValue(data)
    await act(async()=>{renderer=create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA}/>);await tick()})
    await act(async()=>{button(renderer!,'查看对话 ›').props.onClick();await tick()})
    expect(arkmeUi.getSnapshot().codexTarget).toMatchObject({accountKey:'account-a',team:data.team,member:data.items[0]!.userRef,memberName:data.items[0]!.displayName,returnView:'members'})
    expect(mocks.callArkme.mock.calls.every(call=>call[0]==='team.members.list')).toBe(true)
  })

  it('opens the legacy management route as a dialog above the retained member list', async () => {
    mocks.callArkme.mockImplementation(async operation=>operation==='team.members.list'?page(teamRefA,'团队 A'):{self:null,localOnly:true,installations:[],tasks:[]})
    await act(async()=>{renderer=create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} initialView="activity"/>);await tick()})
    expect(text(renderer!.root)).toContain('Codex 同步')
    expect(text(renderer!.root)).toContain('团队 A成员')
    expect(renderer!.root.findByProps({ role: 'dialog' })).toBeDefined()
    expect(renderer!.root.findAllByProps({ className: 'arkme-team-tabs' })).toHaveLength(0)
    expect(text(renderer!.root)).not.toContain('把正在做的事留在团队里')
    expect(renderer!.root.findAllByProps({className:'arkme-codex-task-sidebar'})).toHaveLength(0)
    expect(renderer!.root.findAllByProps({className:'arkme-codex-conversation'})).toHaveLength(0)
    expect(mocks.callArkme.mock.calls.every(call=>['team.members.list','team.codex.state'].includes(call[0]))).toBe(true)
    await act(async()=>{button(renderer!,'查看团队对话 ›').props.onClick();await tick()})
    expect(arkmeUi.getSnapshot().codexTarget).toMatchObject({member:'',returnView:'activity',accountKey:'account-a'})
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('loads sync only on opening its feature and keeps the member list mounted on close', async () => {
    mocks.callArkme.mockImplementation(async operation => operation === 'team.members.list' ? page(teamRefA, '团队 A') : { self:null, localOnly:true, installations:[], tasks:[] })
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })
    expect(text(renderer!.root)).toContain('团队功能')
    expect(renderer!.root.findAllByProps({ role:'dialog' })).toHaveLength(0)
    expect(mocks.callArkme.mock.calls.map(call => call[0])).toEqual(['team.members.list'])
    const members = renderer!.root.findByProps({ className:'arkme-team-member-list' })
    await act(async () => { button(renderer!, 'Codex 同步›').props.onClick(); await tick() })
    expect(renderer!.root.findByProps({ role:'dialog' })).toBeDefined()
    await act(async () => { renderer!.root.findByProps({ 'aria-label':'关闭' }).props.onClick(); await tick() })
    expect(renderer!.root.findAllByProps({ role:'dialog' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ className:'arkme-team-member-list' })).toBe(members)
    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'team.members.list')).toHaveLength(1)
    expect(mocks.callArkme.mock.calls.every(call => ['team.members.list', 'team.codex.state'].includes(call[0]))).toBe(true)
  })

  it.each(['account', 'team'])('closes the old sync dialog when the %s changes', async scope => {
    const pendingSync = deferred<unknown>()
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'team.members.list' ? page(params.teamRef, params.teamRef === teamRefA ? '团队 A' : '团队 B') : pendingSync.promise)
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })
    await act(async () => { button(renderer!, 'Codex 同步›').props.onClick(); await tick() })
    const syncSignal = mocks.callArkme.mock.calls.find(call => call[0] === 'team.codex.state')?.[2] as AbortSignal
    await act(async () => { renderer!.update(<TeamDetailPane accountKey={scope === 'account' ? 'account-b' : 'account-a'} teamRef={scope === 'team' ? teamRefB : teamRefA} />); await tick() })
    expect(renderer!.root.findAllByProps({ role:'dialog' })).toHaveLength(0)
    expect(syncSignal.aborted).toBe(true)
    pendingSync.resolve({ self:null, localOnly:true, installations:[], tasks:[] })
    await act(async () => { await tick() })
    expect(renderer!.root.findAllByProps({ role:'dialog' })).toHaveLength(0)
  })

  it('uses the opaque next cursor and merges a later member page without duplicating rows', async () => {
    const second = deferred<ArkmeTeamMemberPage>()
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'team.app.channel') return { teamRef: teamRefA, name: '团队 A', canManage: false }
      return params.pageCursor ? await second.promise : page(teamRefA, '团队 A', { hasMore: true, nextPageCursor: 'cursor_v1_next', totalCount: 2 })
    })
    await act(async () => { renderer = create(<TeamDetailPane accountKey="account-a" teamRef={teamRefA} />); await tick() })

    await act(async () => { button(renderer!, '加载更多成员').props.onClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenLastCalledWith('team.app.members', {
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
    expect(text(renderer!.root)).toContain('身份信息不完整')
    expect(renderer!.root.findByProps({ 'data-team-member-role': 'member' })).toBeDefined()
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
