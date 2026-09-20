import { UnmarkedSpeakerService } from '../src/services/unmarked-speaker-service.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectoryItem, ArkmeDirectoryPage, ArkmeDirectorySectionKind } from '../src/types.js'
import { ContactDirectorySurface, type ContactDirectorySurfaceProps } from '../src/client/redesign/contacts/ContactDirectorySurface.js'
import { CollapsibleDirectorySection } from '../src/client/redesign/contacts/CollapsibleDirectorySection.js'
import { CONTACT_DIRECTORY_SECTION_ORDER, createContactDirectoryState, type ContactDirectoryState } from '../src/client/redesign/contacts/contact-directory-state.js'

const fixtures: Record<ArkmeDirectorySectionKind, ArkmeDirectoryItem[]> = {
  groups: [{ kind: 'group', sourceRef: 'group-1', displayName: '设计讨论群' }],
  bots: [{ kind: 'bot', bot: { botRef: 'bot-1', name: '设计助手', provider: 'webhook', description: '', status: 'online', directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'chat' } }],
  'unmarked-speakers': [{ kind: 'unmarked-speaker', candidateRef: 'speaker-1', displayName: '说话人 A', subtitle: '设计评审' }],
  teams: [{ kind: 'team', teamRef: 'team-1', displayName: '设计团队', publicId: 'arkme_team', role: 'member' }],
  contacts: [
    { kind: 'contact', contactRef: 'lin', displayName: '小林', nickname: 'Lin', remark: '设计伙伴', accountName: 'lin_account', letter: 'S' },
    { kind: 'contact', contactRef: 'alice', displayName: 'Alice', nickname: 'Alice', remark: '', letter: 'A' },
  ],
}
function ready(): ContactDirectoryState {
  const state = createContactDirectoryState('a')
  for (const section of CONTACT_DIRECTORY_SECTION_ORDER) Object.assign(state.sections[section], {
    status: 'ready', items: fixtures[section], total: fixtures[section].length,
  })
  state.selection = { kind: 'contact', contactRef: 'alice' }
  return state
}
const mounted: ReactTestRenderer[] = []
afterEach(() => { act(() => { mounted.splice(0).forEach(renderer => renderer.unmount()) }) })
async function mount(overrides: Partial<ContactDirectorySurfaceProps> = {}) {
  const props: ContactDirectorySurfaceProps = {
    accountKey: 'a', initialState: ready(), cacheFresh: true,
    onSelectionChange: vi.fn(), onExpandedChange: vi.fn(), onOpenGroup: vi.fn(), onOpenBot: vi.fn(),
    loadPage: async section => ({ section, items: [], total: 0, hasMore: false }), ...overrides,
  }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ContactDirectorySurface {...props} />) })
  mounted.push(renderer)
  return { renderer, props }
}
async function search(renderer: ReactTestRenderer, value: string) {
  const inputs = renderer.root.findAllByType('input').filter(node => node.props.placeholder === '搜索联系人')
  expect(inputs, 'the contact search input must be available').toHaveLength(1)
  await act(async () => { inputs[0]!.props.onChange({ currentTarget: { value } }) })
}
function sections(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(CollapsibleDirectorySection)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('contact directory search', () => {
  it('filters all five sections, counts matches and restores totals and folds without changing selection or cache', async () => {
    const onStateChange = vi.fn()
    const { renderer, props } = await mount({ onStateChange })
    await search(renderer, '  设计  ')
    expect(sections(renderer).map(node => node.props.section.total)).toEqual([1, 1, 1, 1, 1])
    expect(sections(renderer).every(node => node.props.section.expanded)).toBe(true)
    expect(sections(renderer)[4]!.props.section.items.map((item: ArkmeDirectoryItem) => item.kind === 'contact' && item.contactRef)).toEqual(['lin'])
    expect(props.onSelectionChange).not.toHaveBeenCalled()
    expect(onStateChange).not.toHaveBeenCalled()
    await act(async () => { sections(renderer)[0]!.props.onToggle() })
    expect(sections(renderer)[0]!.props.section.expanded).toBe(false)
    expect(props.onExpandedChange).not.toHaveBeenCalled()
    await search(renderer, '')
    expect(sections(renderer).map(node => node.props.section.total)).toEqual([1, 1, 1, 1, 2])
    expect(sections(renderer).map(node => node.props.section.expanded)).toEqual([false, false, false, false, true])
    expect(props.onSelectionChange).not.toHaveBeenCalled()
  })

  it('matches contact nickname/account and team identifiers case insensitively', async () => {
    const { renderer } = await mount()
    await search(renderer, 'LIN_ACCOUNT')
    expect(sections(renderer).map(node => node.props.section.total)).toEqual([0, 0, 0, 0, 1])
    await search(renderer, 'LIN')
    expect(sections(renderer)[4]!.props.section.total).toBe(1)
    await search(renderer, 'ARKME_TEAM')
    expect(sections(renderer).map(node => node.props.section.total)).toEqual([0, 0, 0, 1, 0])
    await search(renderer, 'no-matches')
    expect(sections(renderer).map(node => node.props.section.total)).toEqual([0, 0, 0, 0, 0])
    expect(JSON.stringify(renderer.toJSON())).toContain('未找到匹配的项目')
  })

  it('loads later pages in collapsed sections and applies the newest query to late responses', async () => {
    const initialState = ready()
    initialState.sections.groups = { ...initialState.sections.groups, total: 2, hasMore: true, nextCursor: 'page-2' }
    const pending = deferred<ArkmeDirectoryPage>()
    const loadPage = vi.fn(async (section: ArkmeDirectorySectionKind, options: { cursor?: string }) => {
      expect(section).toBe('groups'); expect(options.cursor).toBe('page-2'); return pending.promise
    })
    const { renderer } = await mount({ initialState, loadPage })
    expect(loadPage).not.toHaveBeenCalled()
    await search(renderer, '设计')
    expect(renderer.root.findAllByProps({ className: 'arkme-contact-directory-count' })[0]!.children).toEqual(['…'])
    await search(renderer, '远程')
    await act(async () => { pending.resolve({ section: 'groups', items: [{ kind: 'group', sourceRef: 'group-2', displayName: '远程协作' }], total: 2, hasMore: false }) })
    expect(sections(renderer)[0]!.props.section.items).toEqual([{ kind: 'group', sourceRef: 'group-2', displayName: '远程协作' }])
    expect(renderer.root.findAllByProps({ className: 'arkme-contact-directory-count' })[0]!.children).toEqual(['1'])
    await search(renderer, '')
    expect(sections(renderer)[0]!.props.section.total).toBe(2)
    expect(sections(renderer)[0]!.props.section.items).toHaveLength(2)
  })

  it('keeps an incomplete search distinguishable from zero and allows retry after a page failure', async () => {
    const initialState = ready()
    initialState.sections.teams = { ...initialState.sections.teams, total: 2, hasMore: true, nextCursor: 'page-2' }
    let failed = true
    const loadPage = async (section: ArkmeDirectorySectionKind): Promise<ArkmeDirectoryPage> => {
      if (failed) throw new Error('暂时无法加载')
      return { section, items: [{ kind: 'team', teamRef: 'team-2', displayName: '远程团队', publicId: 'remote', role: 'member' }], total: 1, hasMore: false }
    }
    const { renderer } = await mount({ initialState, loadPage })
    await search(renderer, '远程')
    expect(renderer.root.findAllByProps({ className: 'arkme-contact-directory-count' })[3]!.children).toEqual(['…'])
    expect(sections(renderer)[3]!.props.section.expanded).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('未找到匹配的项目')
    failed = false
    await act(async () => { sections(renderer)[3]!.props.onRetry() })
    expect(sections(renderer)[3]!.props.section.total).toBe(1)
  })

  it('stops a repeated pagination cursor instead of issuing requests indefinitely', async () => {
    const initialState = ready()
    initialState.sections.groups = { ...initialState.sections.groups, total: 2, hasMore: true, nextCursor: 'same' }
    let calls = 0
    const { renderer } = await mount({ initialState, loadPage: async section => {
      calls += 1
      if (calls > 2) throw new Error('loop')
      return { section, items: [], total: 2, hasMore: true, nextCursor: 'same' }
    } })
    await search(renderer, '远程')
    expect(calls).toBe(1)
    expect(sections(renderer)[0]!.props.section.status).toBe('error')
  })

  it('does not replace the current account with a late page from the previous account', async () => {
    const initialState = ready()
    initialState.sections.groups = { ...initialState.sections.groups, total: 2, hasMore: true, nextCursor: 'next' }
    const pending = deferred<ArkmeDirectoryPage>()
    const { renderer, props } = await mount({ initialState, loadPage: async () => pending.promise })
    await search(renderer, '设计')
    await act(async () => { renderer.update(<ContactDirectorySurface {...props} accountKey="b" loadPage={async section => ({ section, items: [], total: 0, hasMore: false })} />) })
    expect(renderer.root.findByType('input').props.value).toBe('')
    await act(async () => { pending.resolve({ section: 'groups', items: fixtures.groups, total: 1, hasMore: false }) })
    expect(sections(renderer).every(node => node.props.section.items.length === 0)).toBe(true)
  })

  it('uses live contact profile updates when searching remarks', async () => {
    const { renderer, props } = await mount()
    await search(renderer, '新备注')
    expect(sections(renderer)[4]!.props.section.total).toBe(0)
    await act(async () => { renderer.update(<ContactDirectorySurface {...props} contactProfiles={{ lin: { contactRef: 'lin', displayName: '新备注', nickname: 'Lin', remark: '新备注' } }} />) })
    expect(sections(renderer)[4]!.props.section.total).toBe(1)
  })
})

it('resumes a page load interrupted by leaving Contacts instead of restoring a permanent loading state', async () => {
  const initialState = ready()
  initialState.sections.groups = { ...initialState.sections.groups, total: 2, hasMore: true, nextCursor: 'page-2' }
  const pending = deferred<ArkmeDirectoryPage>()
  let cached = initialState
  const first = await mount({ initialState, onStateChange: state => { cached = state }, loadPage: async () => pending.promise })
  await search(first.renderer, '设计')
  expect(cached.sections.groups.status).toBe('loading')
  act(() => { first.renderer.unmount() })
  const next = await mount({ initialState: cached, loadPage: async section => ({ section, items: [...fixtures[section], { kind: 'group', sourceRef: 'group-2', displayName: '远程群' }], total: 2, hasMore: false }) })
  await search(next.renderer, '设计')
  expect(sections(next.renderer)[0]!.props.section.status).toBe('ready')
  expect(next.renderer.root.findAllByProps({ className: 'arkme-contact-directory-count' })[0]!.children).toEqual(['1'])
})

it('shows a retryable incomplete result when the speaker directory projection is still building', async () => {
  const initialState = ready()
  initialState.sections['unmarked-speakers'].status = 'idle'
  const { renderer } = await mount({ initialState, loadPage: async section => ({ section, items: [], total: 0, hasMore: false, projectionState: 'building', retryAfterMillis: 1000 }) })
  await search(renderer, 'no-matches')
  expect(renderer.root.findAllByProps({ className: 'arkme-contact-directory-count' })[2]!.children).toEqual(['…'])
  expect(sections(renderer)[2]!.props.section.expanded).toBe(true)
  expect(JSON.stringify(renderer.toJSON())).not.toContain('未找到匹配的项目')
  expect(sections(renderer)[2]!.props.section.status).toBe('error')
})

it.each([['repeated cursor', ['same', 'same'], 2], ['cursor cycle', ['a', 'b', 'a'], 3]] as const)(
  'stops a speaker %s through the real opaque cursor service', async (_name, nextCursors, expectedRequests) => {
    let requests = 0
    const service = new UnmarkedSpeakerService({
      requireSession: async () => ({ userId: 7, accessToken: 'access', refreshToken: 'refresh' }),
      authenticatedAudioPost: async () => {
        requests += 1
        if (requests > 5) throw new Error('test loop safeguard')
        return { items: [], cross_day_count: 1, single_day_count: 0, has_more: true,
          next_cursor: nextCursors[Math.min(requests - 1, nextCursors.length - 1)], projection_state: 'fresh' }
      },
    } as never)
    try {
      const initialState = ready()
      Object.assign(initialState.sections['unmarked-speakers'], await service.list())
      const { renderer } = await mount({ initialState, loadPage: async (_section, options) => service.list(options) })
      await search(renderer, 'no-matches')
      expect(requests).toBe(expectedRequests)
      expect(sections(renderer)[2]!.props.section.status).toBe('error')
    } finally { service.dispose() }
  },
)

it('bounds automatic restarts when successive pages keep reporting stale cursors', async () => {
  const initialState = ready()
  initialState.sections.groups = { ...initialState.sections.groups, total: 2, hasMore: true, nextCursor: 'page-2' }
  const cursors: Array<string | undefined> = []
  const { renderer } = await mount({ initialState, loadPage: async (section, options) => {
    cursors.push(options.cursor)
    if (cursors.length > 5) throw new Error('test loop safeguard')
    return options.cursor === undefined
      ? { section, items: fixtures.groups, total: 2, hasMore: true, nextCursor: 'page-2' }
      : { section, items: [], total: 2, hasMore: false, cursorStale: true }
  } })
  await search(renderer, 'no-matches')
  expect(cursors).toEqual(['page-2', undefined, 'page-2'])
  expect(sections(renderer)[0]!.props.section.status).toBe('error')
  expect(renderer.root.findAllByProps({ className: 'arkme-contact-directory-count' })[0]!.children).toEqual(['…'])
})

it('retains the restart limit across successful intermediate pages', async () => {
  const initialState = ready()
  initialState.sections.groups = { ...initialState.sections.groups, total: 3, hasMore: true, nextCursor: 'page-2' }
  const cursors: Array<string | undefined> = []
  const { renderer } = await mount({ initialState, loadPage: async (section, options) => {
    cursors.push(options.cursor)
    if (cursors.length > 6) throw new Error('test loop safeguard')
    if (options.cursor === 'page-3') return { section, items: [], total: 3, hasMore: false, cursorStale: true }
    return { section, items: options.cursor === undefined ? fixtures.groups : [{ kind: 'group', sourceRef: 'group-2', displayName: '远程群' }], total: 3, hasMore: true,
      nextCursor: options.cursor === undefined ? 'page-2' : 'page-3' }
  } })
  await search(renderer, 'no-matches')
  expect(cursors).toEqual(['page-2', 'page-3', undefined, 'page-2', 'page-3'])
  expect(sections(renderer)[0]!.props.section.status).toBe('error')
})
