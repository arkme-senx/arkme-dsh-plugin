import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectoryItem, ArkmeDirectoryPage, ArkmeDirectorySectionKind } from '../src/types.js'
import {
  ContactDirectorySurface,
  ContactDirectoryContent,
  DirectoryItemRow,
  directoryStateForAccount,
} from '../src/client/redesign/contacts/ContactDirectorySurface.js'
import { CollapsibleDirectorySection } from '../src/client/redesign/contacts/CollapsibleDirectorySection.js'
import {
  CONTACT_DIRECTORY_SECTION_ORDER,
  contactDirectoryReducer,
  createContactDirectoryState,
  type ContactDirectorySectionState,
  type ContactDirectoryState,
} from '../src/client/redesign/contacts/contact-directory-state.js'

const botSummary = {
  botRef: 'bot-ref', name: '旅行助手', provider: 'webhook', description: '', status: 'online',
  directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'chat',
} as const

const items: Record<ArkmeDirectorySectionKind, ArkmeDirectoryItem[]> = {
  groups: [{ kind: 'group', sourceRef: 'group-ref', displayName: '产品共创' }],
  bots: [{ kind: 'bot', bot: botSummary }],
  'unmarked-speakers': [{
    kind: 'unmarked-speaker', candidateRef: 'candidate-ref', speakerToken: 'B', displayName: '说话人 B', subtitle: '3 天 · 最新：今天 09:28',
  }],
  teams: [{ kind: 'team', rowKey: 'team-row', displayName: 'Arkme 产品组', publicId: '@arkme-team' }],
  contacts: [
    { kind: 'contact', contactRef: 'alice', displayName: 'Alice', nickname: 'Alice', remark: '', letter: 'A' },
    { kind: 'contact', contactRef: 'zhang', displayName: '张三', nickname: '张三', remark: '', letter: 'Z' },
    { kind: 'contact', contactRef: 'hash', displayName: '😀', nickname: '', remark: '', letter: '#' },
  ],
}

function readyState(): ContactDirectoryState {
  let state = createContactDirectoryState('account-a')
  for (const [index, section] of CONTACT_DIRECTORY_SECTION_ORDER.entries()) {
    state = contactDirectoryReducer(state, {
      type: 'set-expanded', section, expanded: true,
    })
    state = contactDirectoryReducer(state, {
      type: 'load-start', section, accountKey: 'account-a', generation: index + 1, mode: 'replace',
    })
    const page: ArkmeDirectoryPage = {
      section,
      items: items[section],
      total: section === 'contacts' ? 25 : index + 2,
      hasMore: section === 'contacts',
      ...(section === 'contacts' ? { nextCursor: 'contacts-next' } : {}),
    }
    state = contactDirectoryReducer(state, {
      type: 'load-success', section, accountKey: 'account-a', generation: index + 1, mode: 'replace', page,
    })
  }
  return contactDirectoryReducer(state, {
    type: 'select', selection: { kind: 'contact', contactRef: 'zhang' },
  })
}

function buttonByText(node: ReactNode, text: string): ReactElement<{ onClick?(): void }> {
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode; onClick?(): void }>
    if (element.type === 'button' && renderToStaticMarkup(element).includes(text)) return element
    for (const child of Children.toArray(element.props.children)) {
      try { return buttonByText(child, text) } catch {}
    }
  }
  throw new Error(`button not found: ${text}`)
}

describe('ContactDirectorySurface content', () => {
  it('hides the previous account state synchronously before reset effects run', () => {
    const previous = readyState()

    expect(directoryStateForAccount(previous, 'account-a')).toBe(previous)
    const next = directoryStateForAccount(previous, 'account-b')
    expect(next.accountKey).toBe('account-b')
    expect(next.selection).toEqual({ kind: 'none' })
    expect(CONTACT_DIRECTORY_SECTION_ORDER.flatMap(section => next.sections[section].items)).toEqual([])
  })

  it('renders the five section headings in order with counts and controlled expansion semantics', () => {
    const state = readyState()
    state.sections.bots.expanded = false
    const markup = renderToStaticMarkup(<ContactDirectoryContent
      state={state}
      onToggle={() => undefined}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
      onSelect={() => undefined}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
    />)

    const headings = ['群聊', 'Bot', '未标记说话人', '团队', '联系人']
    expect(headings.map(heading => markup.indexOf(`<strong>${heading}</strong>`)))
      .toEqual([...headings.map(heading => markup.indexOf(`<strong>${heading}</strong>`))].sort((a, b) => a - b))
    expect(markup).toContain('data-directory-section="groups"')
    expect(markup).toContain('aria-controls="arkme-directory-section-groups"')
    expect(markup).toContain('id="arkme-directory-section-bots"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('<strong>群聊</strong></span><span class="arkme-contact-directory-count">2</span>')
    expect(markup).toContain('<strong>联系人</strong></span><span class="arkme-contact-directory-count">25</span>')
  })

  it('groups contacts under A–Z/# labels and marks only the selected actionable row current', () => {
    const markup = renderToStaticMarkup(<ContactDirectoryContent
      state={readyState()}
      onToggle={() => undefined}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
      onSelect={() => undefined}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
    />)

    expect(markup).toContain('data-directory-letter="A"')
    expect(markup).toContain('data-directory-letter="Z"')
    expect(markup).toContain('data-directory-letter="#"')
    expect(markup.indexOf('data-directory-letter="A"')).toBeLessThan(markup.indexOf('data-directory-letter="Z"'))
    expect(markup.indexOf('data-directory-letter="Z"')).toBeLessThan(markup.indexOf('data-directory-letter="#"'))
    expect(markup).toContain('aria-label="😀的头像"')
    expect(markup).not.toContain('�')
    expect(markup).toContain('data-directory-row-ref="zhang" aria-current="true"')
    expect(markup).toContain('data-directory-row-ref="alice" aria-current="false"')
  })

  it('uses the shared Arkme avatar treatment and does not repeat Bot as row copy', () => {
    const contactMarkup = renderToStaticMarkup(<DirectoryItemRow
      item={{ ...items.contacts[0]!, avatarRef: 'avatar-ref' }}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)
    const botMarkup = renderToStaticMarkup(<DirectoryItemRow
      item={items.bots[0]!}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)

    expect(contactMarkup).toContain('class="arkme-contact-directory-avatar"')
    expect(contactMarkup).toContain('aria-label="Alice的头像"')
    expect(botMarkup).not.toContain('<small>Bot</small>')
  })

  it('renders contacts as one line with remark, nickname, then display name priority', () => {
    const renderContact = (item: Extract<ArkmeDirectoryItem, { kind: 'contact' }>) => renderToStaticMarkup(<DirectoryItemRow
      item={item}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)
    const base = {
      kind: 'contact' as const,
      contactRef: 'contact-ref',
      displayName: '显示名称',
      nickname: '联系人昵称',
      remark: '项目伙伴',
      letter: 'X',
    }

    const withRemark = renderContact(base)
    const withNickname = renderContact({ ...base, remark: '' })
    const withDisplayName = renderContact({ ...base, remark: '', nickname: '' })

    expect(withRemark).toContain('<strong>项目伙伴</strong>')
    expect(withRemark).not.toContain('<small>')
    expect(withRemark).not.toContain('联系人昵称')
    expect(withNickname).toContain('<strong>联系人昵称</strong>')
    expect(withNickname).not.toContain('<small>')
    expect(withDisplayName).toContain('<strong>显示名称</strong>')
    expect(withDisplayName).not.toContain('<small>')
  })

  it('renders group rows with the same member mosaic used by conversations', () => {
    const markup = renderToStaticMarkup(<DirectoryItemRow
      item={{
        kind: 'group', sourceRef: 'group-ref', displayName: '产品共创',
        groupAvatar: {
          memberCount: 2, strategy: 'recent_active', computedAtMillis: 123,
          slots: [{ fallback: { kind: 'default' } }, { fallback: { kind: 'default' } }],
        },
      } as ArkmeDirectoryItem}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)

    expect(markup).toContain('data-arkme-group-avatar-count="2"')
    expect(markup).toContain('aria-label="产品共创的群聊头像"')
  })

  it('renders every Bot row as a circular robot avatar', () => {
    const markup = renderToStaticMarkup(<DirectoryItemRow
      item={{
        kind: 'bot', bot: { ...botSummary, avatarRef: 'ignored-bot-avatar' },
      }}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)
    const speakerMarkup = renderToStaticMarkup(<DirectoryItemRow
      item={{ kind: 'unmarked-speaker', candidateRef: 'speaker-ref', displayName: '说话人 H', subtitle: '' }}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)
    const sharedDefaultFrame = 'background:var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1, #f5f6f8));color:var(--dsw-alias-label-caption, #a3a8ae)'

    expect(markup).toContain('class="arkme-contact-directory-avatar is-bot"')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="旅行助手的机器人头像"')
    expect(markup).toContain('<svg width="25.840000000000003" height="25.840000000000003" viewBox="0 0 24 24"')
    expect(markup).toContain('<rect x="6.5" y="6.5" width="11" height="11" rx="0.75"')
    expect(markup.match(/<circle/g)).toHaveLength(2)
    expect(markup).toContain('stroke-linecap="round"')
    expect(markup).not.toContain('viewBox="0 0 256 256"')
    expect(markup).not.toContain('ignored-bot-avatar')
    expect(speakerMarkup).toContain('arkme-unmarked-speaker-token-avatar')
    expect(markup).toContain(sharedDefaultFrame)
  })

  it('uses the mobile speaker-token avatar instead of a generic person silhouette', () => {
    const markup = renderToStaticMarkup(<DirectoryItemRow
      item={items['unmarked-speakers'][0]!}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)

    expect(markup).toContain('class="arkme-unmarked-speaker-token-avatar"')
    expect(markup).toContain('aria-label="说话人 B的说话人头像"')
    expect(markup).toContain('>B</span>')
    expect(markup).not.toContain('<path d="M4.5 20')
  })

  it('keeps the disclosure caret and section name in one leading title group', () => {
    const section = CollapsibleDirectorySection({
      section: readyState().sections.contacts,
      label: '联系人',
      emptyLabel: '暂无联系人',
      onToggle: () => undefined,
      onRetry: () => undefined,
      onLoadMore: () => undefined,
      children: <div />,
    })
    const markup = renderToStaticMarkup(section)

    expect(markup).toContain('class="arkme-contact-directory-section-title"')
    expect(markup).toContain('<span class="arkme-contact-directory-caret"')
    expect(markup.indexOf('arkme-contact-directory-section-title')).toBeLessThan(markup.indexOf('arkme-contact-directory-count'))
  })

  it('renders retry and load-more as native buttons while keeping stale rows visible', () => {
    const section: ContactDirectorySectionState = {
      ...readyState().sections.contacts,
      status: 'error',
      warning: '联系人加载失败',
      hasMore: true,
    }
    const onRetry = vi.fn()
    const onLoadMore = vi.fn()
    const content = CollapsibleDirectorySection({
      section,
      label: '联系人',
      emptyLabel: '暂无联系人',
      onToggle: () => undefined,
      onRetry,
      onLoadMore,
      children: <div>保留的联系人</div>,
    })
    const markup = renderToStaticMarkup(content)

    expect(markup).toContain('保留的联系人')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('联系人加载失败')
    buttonByText(content, '重试').props.onClick?.()
    buttonByText(content, '加载更多').props.onClick?.()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('routes group, Bot, contact and unmarked-speaker rows to their distinct callbacks', () => {
    const onOpenGroup = vi.fn()
    const onOpenBot = vi.fn()
    const onSelect = vi.fn()

    for (const item of [items.groups[0], items.bots[0], items.contacts[0], items['unmarked-speakers'][0]]) {
      if (item === undefined) throw new Error('fixture missing')
      const row = DirectoryItemRow({
        item,
        selected: false,
        onOpenGroup,
        onOpenBot,
        onSelect,
      }) as ReactElement<{ onClick?(): void }>
      expect(row.type).toBe('button')
      row.props.onClick?.()
    }

    expect(onOpenGroup).toHaveBeenCalledWith('group-ref')
    expect(onOpenBot).toHaveBeenCalledWith(botSummary)
    expect(onSelect).toHaveBeenNthCalledWith(1, { kind: 'contact', contactRef: 'alice' })
    expect(onSelect).toHaveBeenNthCalledWith(2, { kind: 'unmarked-speaker', candidateRef: 'candidate-ref' })
  })

  it('renders team rows as non-focusable listitems with no click or selected state', () => {
    const team = items.teams[0]
    if (team === undefined) throw new Error('fixture missing')
    const row = DirectoryItemRow({
      item: team,
      selected: true,
      onOpenGroup: vi.fn(),
      onOpenBot: vi.fn(),
      onSelect: vi.fn(),
    }) as ReactElement<Record<string, unknown>>
    const markup = renderToStaticMarkup(row)

    expect(row.type).toBe('div')
    expect(row.props.role).toBe('listitem')
    expect(row.props.onClick).toBeUndefined()
    expect(row.props.tabIndex).toBeUndefined()
    expect(row.props['aria-current']).toBeUndefined()
    expect(markup).toContain('data-directory-row-kind="team"')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('tabindex=')
    expect(markup).not.toContain('aria-current=')
  })

  it('renders team rows with a large foreground person and a smaller rear person', () => {
    const team = items.teams[0]
    if (team === undefined) throw new Error('fixture missing')
    const markup = renderToStaticMarkup(<DirectoryItemRow
      item={team}
      selected={false}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      onSelect={() => undefined}
    />)

    expect(markup).toContain('class="arkme-contact-directory-avatar is-team"')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Arkme 产品组的团队头像"')
    expect(markup).toContain('viewBox="0 0 24 24"')
    expect(markup.match(/<circle/g)).toHaveLength(2)
    expect(markup.match(/<path/g)).toHaveLength(2)
    expect(markup).toContain('opacity="0.68"')
  })

  it('force-refreshes the collapsed unmarked-speaker section without discarding mounted directory state', async () => {
    const loadPage = vi.fn(async (section: ArkmeDirectorySectionKind): Promise<ArkmeDirectoryPage> => ({
      section,
      items: section === 'unmarked-speakers' ? items[section] : [],
      total: section === 'unmarked-speakers' ? 1 : 0,
      hasMore: false,
    }))
    const props = {
      accountKey: 'account-a',
      selection: { kind: 'none' } as const,
      refreshRevision: 0,
      onSelectionChange: vi.fn(),
      onOpenGroup: vi.fn(),
      onOpenBot: vi.fn(),
      loadPage,
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ContactDirectorySurface {...props} />); await Promise.resolve() })
    expect(loadPage.mock.calls.map(call => call[0])).toEqual([
      'groups', 'bots', 'unmarked-speakers', 'teams', 'contacts',
    ])

    await act(async () => {
      renderer.update(<ContactDirectorySurface {...props} refreshRevision={1} />)
      await Promise.resolve()
    })

    expect(loadPage.mock.calls.map(call => call[0])).toEqual([
      'groups', 'bots', 'unmarked-speakers', 'teams', 'contacts', 'unmarked-speakers',
    ])
    expect(renderer.root.findByProps({ 'data-directory-section': 'unmarked-speakers' })
      .findByType('button').props['aria-expanded']).toBe(false)
  })

  it('keeps stale cached rows visible while replacing loaded sections in the background', async () => {
    let resolveContacts!: (page: ArkmeDirectoryPage) => void
    const contactsResponse = new Promise<ArkmeDirectoryPage>(resolve => { resolveContacts = resolve })
    const loadPage = vi.fn(async (
      section: ArkmeDirectorySectionKind,
      options: { limit: number; cursor?: string; countOnly?: boolean },
    ): Promise<ArkmeDirectoryPage> => {
      if (section === 'contacts' && options.countOnly !== true) return await contactsResponse
      return { section, items: options.countOnly === true ? [] : items[section], total: items[section].length, hasMore: false }
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactDirectorySurface
        accountKey="account-a"
        initialState={readyState()}
        cacheFresh={false}
        selection={{ kind: 'none' }}
        onSelectionChange={() => undefined}
        onOpenGroup={() => undefined}
        onOpenBot={() => undefined}
        loadPage={loadPage}
      />)
      await Promise.resolve()
    })

    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'alice' })).toBeDefined()
    expect(loadPage.mock.calls.filter(([section, options]) => section === 'contacts' && options.countOnly !== true)).toHaveLength(1)

    await act(async () => {
      resolveContacts({
        section: 'contacts', total: 1, hasMore: false,
        items: [{ kind: 'contact', contactRef: 'fresh', displayName: '最新联系人', nickname: '最新联系人', remark: '', letter: 'Z' }],
      })
      await Promise.resolve()
    })
    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'fresh' })).toBeDefined()
    expect(renderer.root.findAllByProps({ 'data-directory-row-ref': 'alice' })).toHaveLength(0)
  })

  it('loads all five first pages on entry and does not reload a collapsed section when it opens', async () => {
    const loadPage = vi.fn(async (
      section: ArkmeDirectorySectionKind,
      options: { limit: number; cursor?: string; countOnly?: boolean },
    ): Promise<ArkmeDirectoryPage> => ({
      section,
      items: options.countOnly === true ? [] : items[section],
      total: section === 'contacts' ? 3 : 7,
      hasMore: false,
    }))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactDirectorySurface
        accountKey="account-a"
        onSelectionChange={() => undefined}
        onOpenGroup={() => undefined}
        onOpenBot={() => undefined}
        loadPage={loadPage}
      />)
      await Promise.resolve()
    })

    expect(loadPage.mock.calls.map(([section, options]) => [section, options])).toEqual([
      ['groups', { limit: 50 }],
      ['bots', { limit: 50 }],
      ['unmarked-speakers', { limit: 50 }],
      ['teams', { limit: 50 }],
      ['contacts', { limit: 50 }],
    ])
    expect(renderer.root.findByProps({ 'data-directory-section': 'groups' })
      .findByProps({ className: 'arkme-contact-directory-count' }).children).toEqual(['7'])

    const groupHeader = renderer.root.findByProps({ 'data-directory-section': 'groups' }).findByType('button')
    await act(async () => { groupHeader.props.onClick(); await Promise.resolve() })
    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'group-ref' })).toBeDefined()
    expect(loadPage.mock.calls.filter(([section]) => section === 'groups')).toHaveLength(1)
    await act(async () => { groupHeader.props.onClick(); groupHeader.props.onClick(); await Promise.resolve() })
    expect(loadPage.mock.calls.filter(([section]) => section === 'groups')).toHaveLength(1)
  })

  it('automatically loads every contact page while leaving other section pagination explicit', async () => {
    const loadPage = vi.fn(async (
      section: ArkmeDirectorySectionKind,
      options: { limit: number; cursor?: string; countOnly?: boolean },
    ): Promise<ArkmeDirectoryPage> => {
      if (section === 'contacts' && options.cursor === undefined) return {
        section, total: 2, hasMore: true, nextCursor: 'contacts-page-2',
        items: [{ kind: 'contact', contactRef: 'contact-a', displayName: '阿一', nickname: '阿一', remark: '', letter: 'A' }],
      }
      if (section === 'contacts') return {
        section, total: 2, hasMore: false,
        items: [{ kind: 'contact', contactRef: 'contact-b', displayName: '白二', nickname: '白二', remark: '', letter: 'B' }],
      }
      if (section === 'groups') return {
        section, total: 2, hasMore: true, nextCursor: 'groups-page-2',
        items: [{ kind: 'group', sourceRef: 'group-a', displayName: '群聊一' }],
      }
      return { section, total: 0, hasMore: false, items: [] }
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactDirectorySurface
        accountKey="account-a"
        onSelectionChange={() => undefined}
        onOpenGroup={() => undefined}
        onOpenBot={() => undefined}
        loadPage={loadPage}
      />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts').map(([, options]) => options))
      .toEqual([{ limit: 50 }, { limit: 50, cursor: 'contacts-page-2' }])
    expect(loadPage.mock.calls.filter(([section]) => section === 'groups')).toHaveLength(1)
    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'contact-a' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'contact-b' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-directory-section': 'contacts' })
      .findAllByProps({ className: 'arkme-contact-directory-more' })).toHaveLength(0)
  })

  it('keeps the group title count at 137 across first-page and append responses', async () => {
    const groups = Array.from({ length: 50 }, (_, index) => ({
      kind: 'group' as const, sourceRef: `group-${String(index + 1)}`, displayName: `群聊 ${String(index + 1)}`,
    }))
    const loadPage = vi.fn(async (
      section: ArkmeDirectorySectionKind,
      options: { limit: number; cursor?: string; countOnly?: boolean },
    ): Promise<ArkmeDirectoryPage> => {
      if (section === 'groups' && options.cursor === undefined) {
        return { section, items: groups, total: 137, hasMore: true, nextCursor: 'page-2' }
      }
      if (section === 'groups') return {
        section, items: [{ kind: 'group', sourceRef: 'group-51', displayName: '群聊 51' }], total: 87, hasMore: false,
      }
      return { section, items: [], total: 0, hasMore: false }
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactDirectorySurface
        accountKey="account-a"
        onSelectionChange={() => undefined}
        onOpenGroup={() => undefined}
        onOpenBot={() => undefined}
        loadPage={loadPage}
      />)
      await Promise.resolve()
    })
    const groupsSection = renderer.root.findByProps({ 'data-directory-section': 'groups' })
    const count = () => groupsSection.findByProps({ className: 'arkme-contact-directory-count' }).children
    expect(count()).toEqual(['137'])
    await act(async () => { groupsSection.findByType('button').props.onClick(); await Promise.resolve() })
    expect(count()).toEqual(['137'])
    await act(async () => {
      groupsSection.findByProps({ className: 'arkme-contact-directory-more' }).props.onClick()
      await Promise.resolve()
    })
    expect(count()).toEqual(['137'])
  })

  it('updates the mounted unmarked-speaker title from 2 to 1 and 0 after authoritative refreshes', async () => {
    let speakerReplace = 0
    const loadPage = vi.fn(async (
      section: ArkmeDirectorySectionKind,
      options: { limit: number; cursor?: string; countOnly?: boolean },
    ): Promise<ArkmeDirectoryPage> => {
      if (section !== 'unmarked-speakers') return { section, items: [], total: 0, hasMore: false }
      speakerReplace += 1
      if (speakerReplace === 1) return {
        section, total: 2, hasMore: false,
        items: [
          { kind: 'unmarked-speaker', candidateRef: 'speaker-a', displayName: '说话人 A' },
          { kind: 'unmarked-speaker', candidateRef: 'speaker-b', displayName: '说话人 B' },
        ],
      }
      if (speakerReplace === 2) return {
        section, total: 1, hasMore: false,
        items: [{ kind: 'unmarked-speaker', candidateRef: 'speaker-b', displayName: '说话人 B' }],
      }
      return { section, total: 0, hasMore: false, items: [] }
    })
    const props = (refreshRevision: number) => <ContactDirectorySurface
      accountKey="account-a"
      refreshRevision={refreshRevision}
      onSelectionChange={() => undefined}
      onOpenGroup={() => undefined}
      onOpenBot={() => undefined}
      loadPage={loadPage}
    />
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(props(0)); await Promise.resolve() })
    const section = () => renderer.root.findByProps({ 'data-directory-section': 'unmarked-speakers' })
    const count = () => section().findByProps({ className: 'arkme-contact-directory-count' }).children
    expect(count()).toEqual(['2'])
    await act(async () => { renderer.update(props(1)); await Promise.resolve() })
    expect(count()).toEqual(['1'])
    await act(async () => { renderer.update(props(2)); await Promise.resolve() })
    expect(count()).toEqual(['0'])
  })
})
