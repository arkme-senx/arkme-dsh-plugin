import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ArkmeDirectoryContactProfile,
  ArkmeOpenPrivateChatResult,
  ArkmeSourceItem,
  ArkmeWorldFeedItem,
  ArkmeWorldFeedPage,
} from '../src/types.js'
import { DirectoryDetailPane } from '../src/client/redesign/contacts/DirectoryDetailPane.js'
import {
  ContactDetailCoordinator,
  ContactProfileDetail,
  ContactProfileContent,
  contactProfileReducer,
  createContactProfileState,
  type ContactDetailAction,
  type ContactDetailIdentity,
} from '../src/client/redesign/contacts/ContactProfileDetail.js'
import {
  ContactWorldList,
  contactWorldReducer,
  createContactWorldState,
} from '../src/client/redesign/contacts/ContactWorldList.js'

const worldImageMocks = vi.hoisted(() => ({
  loadWorldImageDataUrl: vi.fn<(imageRef: string) => Promise<string>>(),
}))

vi.mock('../src/client/ArkmeWorldSurface.js', () => ({
  loadWorldImageDataUrl: worldImageMocks.loadWorldImageDataUrl,
}))

const identityA: ContactDetailIdentity = { accountKey: 'account-a', contactRef: 'contact-a', generation: 1 }
const identityB: ContactDetailIdentity = { accountKey: 'account-a', contactRef: 'contact-b', generation: 2 }

const profile: ArkmeDirectoryContactProfile = {
  contactRef: 'contact-a', displayName: '周小满', nickname: '小满', remark: '项目伙伴', avatarRef: 'avatar-ref',
}

const worldItem = (recordRef: string, textContent = '今天开始做一件长期的事'): ArkmeWorldFeedItem => ({
  recordRef,
  authorName: '周小满',
  avatarRef: 'avatar-ref',
  headline: '新的记录',
  textContent,
  tags: [],
  templateKind: 0,
  createdAtMillis: 1_700_000_000_000,
  publishedAtMillis: 1_700_000_000_000,
  imageRefs: recordRef === 'world-1' ? ['world-image-ref'] : [],
  imageCount: recordRef === 'world-1' ? 1 : 0,
  videoCount: 0,
  voiceCount: 0,
  extendCount: 7,
})

const page = (items: ArkmeWorldFeedItem[], overrides: Partial<ArkmeWorldFeedPage> = {}): ArkmeWorldFeedPage => ({
  items, total: items.length, hasMore: false, ...overrides,
})

const source: ArkmeSourceItem = {
  sourceRef: 'private-source-ref', kind: 'private_chat', displayName: '周小满', activeAtMillis: 1, unreadCount: 0,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  worldImageMocks.loadWorldImageDataUrl.mockReset()
})

function instanceText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : instanceText(child)).join('')
}

function rendererText(renderer: ReactTestRenderer): string {
  return instanceText(renderer.root)
}

function messageButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType('button').find(candidate => {
    const text = instanceText(candidate)
    return text === '发消息' || text === '正在打开…'
  })
  if (button === undefined) throw new Error('message button not found')
  return button
}

function exactButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root.findAllByType('button').find(candidate => instanceText(candidate) === label)
  if (button === undefined) throw new Error(`button not found: ${label}`)
  return button
}

function profileFor(contactRef: string, displayName: string): ArkmeDirectoryContactProfile {
  return { contactRef, displayName, nickname: displayName, remark: `${displayName}备注` }
}

function mountedWorldItem(recordRef: string, authorName: string): ArkmeWorldFeedItem {
  return {
    recordRef,
    authorName,
    headline: `${authorName}标题`,
    textContent: `${authorName}正文`,
    tags: [],
    templateKind: 0,
    createdAtMillis: 1_700_000_000_000,
    publishedAtMillis: 1_700_000_000_000,
    imageRefs: [],
    imageCount: 0,
    videoCount: 0,
    voiceCount: 0,
    extendCount: 0,
  }
}

describe('contact detail presentation', () => {
  it('renders the centered Arkme logo for no selection and delegates unmarked speakers through a narrow slot', () => {
    const none = renderToStaticMarkup(<DirectoryDetailPane
      accountKey="account-a"
      selection={{ kind: 'none' }}
      onSelectionChange={() => undefined}
      onSourceActivated={() => undefined}
    />)
    const speaker = renderToStaticMarkup(<DirectoryDetailPane
      accountKey="account-a"
      selection={{ kind: 'unmarked-speaker', candidateRef: 'candidate-ref' }}
      onSelectionChange={() => undefined}
      onSourceActivated={() => undefined}
      renderUnmarkedSpeakerDetail={candidateRef => <div>speaker slot: {candidateRef}</div>}
    />)

    expect(none).toContain('class="arkme-directory-detail-empty"')
    expect(none).toContain('alt="Arkme"')
    expect(speaker).toContain('speaker slot: candidate-ref')
  })

  it('renders profile loading, success, and local error states with the message action', () => {
    const loading = renderToStaticMarkup(<ContactProfileContent
      state={{ ...createContactProfileState(identityA), status: 'loading' }}
      messageBusy={false}
      onOpenMessage={() => undefined}
    />)
    const ready = renderToStaticMarkup(<ContactProfileContent
      state={{ ...createContactProfileState(identityA), status: 'ready', profile }}
      messageBusy={false}
      onOpenMessage={() => undefined}
    />)
    const failed = renderToStaticMarkup(<ContactProfileContent
      state={{ ...createContactProfileState(identityA), status: 'error', message: '资料暂不可用' }}
      messageBusy={false}
      messageError="会话打开失败"
      onOpenMessage={() => undefined}
    />)

    expect(loading).toContain('正在加载联系人资料')
    expect(ready).toContain('周小满')
    expect(ready).toContain('昵称：小满')
    expect(ready).toContain('备注：项目伙伴')
    expect(ready).toContain('>发消息</button>')
    expect(ready).toContain('class="arkme-contact-profile-main"')
    expect(ready).toContain('class="arkme-contact-profile-identity"')
    expect(ready.match(/昵称：小满/g)).toHaveLength(1)
    expect(ready.match(/备注：项目伙伴/g)).toHaveLength(1)
    expect(ready).not.toContain('arkme-contact-profile-readable-fields')
    expect(failed).toContain('资料暂不可用')
    expect(failed).toContain('会话打开失败')
  })

  it('omits the remark row when the contact has no remark', () => {
    const withoutRemark = renderToStaticMarkup(<ContactProfileContent
      state={{
        ...createContactProfileState(identityA),
        status: 'ready',
        profile: { ...profile, remark: '   ' },
      }}
      messageBusy={false}
      onOpenMessage={() => undefined}
    />)

    expect(withoutRemark).toContain('昵称：小满')
    expect(withoutRemark).not.toContain('备注：')
  })

  it('keeps profile and World state independent when one request fails', () => {
    let profileState = createContactProfileState(identityA)
    let worldState = createContactWorldState(identityA)
    profileState = contactProfileReducer(profileState, { type: 'profile-start', identity: identityA })
    worldState = contactWorldReducer(worldState, { type: 'world-start', identity: identityA, mode: 'replace' })
    profileState = contactProfileReducer(profileState, { type: 'profile-success', identity: identityA, profile })
    worldState = contactWorldReducer(worldState, { type: 'world-error', identity: identityA, message: '世界加载失败' })

    expect(profileState).toMatchObject({ status: 'ready', profile })
    expect(worldState).toMatchObject({ status: 'error', message: '世界加载失败', items: [] })
    expect(renderToStaticMarkup(<ContactProfileContent state={profileState} messageBusy={false} onOpenMessage={() => undefined} />))
      .toContain('周小满')
    expect(renderToStaticMarkup(<ContactWorldList state={worldState} onRetry={() => undefined} onLoadMore={() => undefined} />))
      .toContain('世界加载失败')
  })

  it('uses true empty only for a successful zero-total page and keeps errors distinct', () => {
    const start = contactWorldReducer(createContactWorldState(identityA), {
      type: 'world-start', identity: identityA, mode: 'replace',
    })
    const empty = contactWorldReducer(start, {
      type: 'world-success', identity: identityA, mode: 'replace', page: page([], { total: 0 }),
    })
    const partial = contactWorldReducer(start, {
      type: 'world-success', identity: identityA, mode: 'replace', page: page([], { total: 3 }),
    })
    const error = contactWorldReducer(start, {
      type: 'world-error', identity: identityA, message: 'World Provider 失败',
    })

    expect(empty.status).toBe('empty')
    expect(partial.status).toBe('ready')
    expect(error.status).toBe('error')
    const emptyMarkup = renderToStaticMarkup(<ContactWorldList state={empty} onRetry={() => undefined} onLoadMore={() => undefined} />)
    expect(emptyMarkup).toContain('他还没有公开任何内容')
    expect(emptyMarkup).toContain('alt="暂无公开内容"')
  })

  it('presents public records as a year and diary timeline inside the World container', () => {
    const publishedAtMillis = new Date(2026, 7, 18, 20, 29).getTime()
    const olderAtMillis = new Date(2025, 2, 5, 9, 8).getTime()
    const state = contactWorldReducer(createContactWorldState(identityA), {
      type: 'world-success', identity: identityA, mode: 'replace',
      page: page([
        { ...worldItem('world-older'), createdAtMillis: olderAtMillis, publishedAtMillis: olderAtMillis },
        { ...worldItem('world-timeline'), createdAtMillis: publishedAtMillis, publishedAtMillis },
      ]),
    })
    const markup = renderToStaticMarkup(<ContactWorldList state={state} onRetry={() => undefined} onLoadMore={() => undefined} />)

    expect(markup).toContain('class="arkme-contact-world-container"')
    expect(markup).toContain('2026年')
    expect(markup).toContain('8月18日记')
    expect(markup).toContain('20:29')
    expect(markup.indexOf('2026年')).toBeLessThan(markup.indexOf('2025年'))
  })

  it('preserves old items during load-more, deduplicates by recordRef, and keeps append errors retryable', () => {
    let state = contactWorldReducer(createContactWorldState(identityA), {
      type: 'world-start', identity: identityA, mode: 'replace',
    })
    state = contactWorldReducer(state, {
      type: 'world-success', identity: identityA, mode: 'replace',
      page: page([worldItem('world-1')], { total: 3, hasMore: true, nextOffset: 1 }),
    })
    state = contactWorldReducer(state, { type: 'world-start', identity: identityA, mode: 'append' })
    expect(state.items.map(item => item.recordRef)).toEqual(['world-1'])
    state = contactWorldReducer(state, {
      type: 'world-success', identity: identityA, mode: 'append',
      page: page([worldItem('world-1', '更新后的正文'), worldItem('world-2')], { total: 3, hasMore: true, nextOffset: 2 }),
    })
    expect(state.items.map(item => item.recordRef)).toEqual(['world-1', 'world-2'])
    expect(state.items[0]?.textContent).toBe('更新后的正文')
    state = contactWorldReducer(state, { type: 'world-start', identity: identityA, mode: 'append' })
    state = contactWorldReducer(state, { type: 'world-error', identity: identityA, message: '加载更多失败' })

    const markup = renderToStaticMarkup(<ContactWorldList state={state} onRetry={() => undefined} onLoadMore={() => undefined} />)
    expect(markup).toContain('更新后的正文')
    expect(markup).toContain('加载更多失败')
    expect(markup).toContain('>重试</button>')
    expect(markup).not.toContain('7 条评论')
  })
})

describe('ContactDetailCoordinator', () => {
  it('starts profile and first World requests in parallel with only contactRef payload identity', async () => {
    const profileResult = deferred<ArkmeDirectoryContactProfile>()
    const worldResult = deferred<ArkmeWorldFeedPage>()
    const loadProfile = vi.fn((_contactRef: string, _signal: AbortSignal) => profileResult.promise)
    const loadWorld = vi.fn((_contactRef: string, _options: { limit: number; offset: number }, _signal: AbortSignal) => worldResult.promise)
    const actions: ContactDetailAction[] = []
    const coordinator = new ContactDetailCoordinator({
      identity: identityA,
      loadProfile,
      loadWorld,
      openChat: async () => ({ source }),
      isCurrent: candidate => candidate === identityA,
      onAction: action => { actions.push(action) },
      onSelectionCleared: () => undefined,
      onSourceActivated: () => undefined,
    })

    coordinator.start()
    expect(loadProfile).toHaveBeenCalledOnce()
    expect(loadProfile.mock.calls[0]?.[0]).toBe('contact-a')
    expect(loadWorld).toHaveBeenCalledOnce()
    expect(loadWorld.mock.calls[0]?.slice(0, 2)).toEqual(['contact-a', { limit: 20, offset: 0 }])
    expect(actions.map(action => action.type)).toEqual(['profile-start', 'world-start'])

    profileResult.resolve(profile)
    worldResult.resolve(page([worldItem('world-1')]))
    await tick()
    expect(actions.map(action => action.type)).toEqual([
      'profile-start', 'world-start', 'profile-success', 'world-success',
    ])
  })

  it('ignores late A results after B becomes current and aborts prior selection, unmount, and account sessions', async () => {
    const oldProfile = deferred<ArkmeDirectoryContactProfile>()
    const oldWorld = deferred<ArkmeWorldFeedPage>()
    let current = identityA
    const actions: ContactDetailAction[] = []
    const coordinator = new ContactDetailCoordinator({
      identity: identityA,
      loadProfile: (_contactRef, signal) => {
        signal.addEventListener('abort', () => { actions.push({ type: 'observed-profile-abort' }) })
        return oldProfile.promise
      },
      loadWorld: (_contactRef, _options, signal) => {
        signal.addEventListener('abort', () => { actions.push({ type: 'observed-world-abort' }) })
        return oldWorld.promise
      },
      openChat: async () => ({ source }),
      isCurrent: candidate => candidate === current,
      onAction: action => { actions.push(action) },
      onSelectionCleared: () => undefined,
      onSourceActivated: () => undefined,
    })

    coordinator.start()
    current = identityB
    coordinator.dispose()
    oldProfile.resolve({ ...profile, contactRef: 'contact-a', displayName: '过期的 A' })
    oldWorld.resolve(page([worldItem('stale-world')]))
    await tick()

    expect(actions.map(action => action.type)).toEqual([
      'profile-start', 'world-start', 'observed-profile-abort', 'observed-world-abort',
    ])
  })

  it('commits reducer responses only when generation, account, and contact identity still match', () => {
    const original = contactProfileReducer(createContactProfileState(identityA), {
      type: 'profile-start', identity: identityA,
    })
    const staleContact = contactProfileReducer(original, {
      type: 'profile-success', identity: { ...identityA, contactRef: 'contact-b' }, profile,
    })
    const staleGeneration = contactProfileReducer(original, {
      type: 'profile-success', identity: { ...identityA, generation: 2 }, profile,
    })
    const staleAccount = contactProfileReducer(original, {
      type: 'profile-success', identity: { ...identityA, accountKey: 'account-b' }, profile,
    })

    expect(staleContact).toBe(original)
    expect(staleGeneration).toBe(original)
    expect(staleAccount).toBe(original)
  })

  it('prevents duplicate message opens, activates the returned source, and keeps failure feedback local', async () => {
    const pending = deferred<ArkmeOpenPrivateChatResult>()
    const openChat = vi.fn((_contactRef: string, _signal: AbortSignal) => pending.promise)
    const actions: ContactDetailAction[] = []
    const handoff: string[] = []
    const coordinator = new ContactDetailCoordinator({
      identity: identityA,
      loadProfile: async () => profile,
      loadWorld: async () => page([]),
      openChat,
      isCurrent: candidate => candidate === identityA,
      onAction: action => { actions.push(action) },
      onSelectionCleared: () => { handoff.push('clear') },
      onSourceActivated: activated => { handoff.push(`activate:${activated.sourceRef}`) },
    })

    coordinator.openMessage()
    coordinator.openMessage()
    expect(openChat).toHaveBeenCalledOnce()
    expect(openChat.mock.calls[0]?.[0]).toBe('contact-a')
    expect(actions.at(-1)?.type).toBe('message-start')
    pending.resolve({ source })
    await tick()
    expect(handoff).toEqual(['clear', 'activate:private-source-ref'])
    expect(actions.at(-1)?.type).toBe('message-success')

    const failedActions: ContactDetailAction[] = []
    const failed = new ContactDetailCoordinator({
      identity: identityA,
      loadProfile: async () => profile,
      loadWorld: async () => page([]),
      openChat: async () => { throw new Error('会话服务不可用') },
      isCurrent: candidate => candidate === identityA,
      onAction: action => { failedActions.push(action) },
      onSelectionCleared: vi.fn(),
      onSourceActivated: vi.fn(),
    })
    failed.openMessage()
    await tick()
    expect(failedActions.at(-1)).toMatchObject({ type: 'message-error', message: '会话服务不可用' })
  })
})

describe('mounted ContactProfileDetail wiring', () => {
  it('resolves contact World media through the dedicated World image reader', async () => {
    const state = contactWorldReducer(createContactWorldState(identityA), {
      type: 'world-success', identity: identityA, mode: 'replace', page: page([worldItem('world-1')]),
    })
    worldImageMocks.loadWorldImageDataUrl.mockResolvedValue('data:image/png;base64,d29ybGQtaW1hZ2U=')
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(<ContactWorldList state={state} onRetry={() => undefined} onLoadMore={() => undefined} />)
      await tick()
    })

    expect(worldImageMocks.loadWorldImageDataUrl).toHaveBeenCalledWith('world-image-ref')
    expect(renderer.root.findByProps({ className: 'arkme-contact-world-image' }).props.src)
      .toBe('data:image/png;base64,d29ybGQtaW1hZ2U=')
    expect(renderer.root.findAllByProps({ className: 'arkme-contact-world-image-error' })).toHaveLength(0)
    await act(async () => { renderer.unmount() })
  })

  it('shows visible feedback when a contact World image cannot be read', async () => {
    const state = contactWorldReducer(createContactWorldState(identityA), {
      type: 'world-success', identity: identityA, mode: 'replace', page: page([worldItem('world-1')]),
    })
    worldImageMocks.loadWorldImageDataUrl.mockRejectedValue(new Error('世界图片读取失败'))
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(<ContactWorldList state={state} onRetry={() => undefined} onLoadMore={() => undefined} />)
      await tick()
    })

    expect(rendererText(renderer)).toContain('图片加载失败')
    expect(renderer.root.findByProps({
      className: 'arkme-contact-world-image-error',
      role: 'img',
      'aria-label': '周小满发布的图片 1加载失败',
    })).toBeDefined()
    await act(async () => { renderer.unmount() })
  })

  it('keeps the active contact profile above a directly rendered World content pane', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactProfileDetail
        accountKey="account-a"
        contactRef="contact-a"
        onSelectionCleared={() => undefined}
        onSourceActivated={() => undefined}
        loadProfile={async () => profile}
        loadWorld={async () => page([], { total: 0 })}
        openChat={async () => ({ source })}
      />)
      await tick()
    })

    expect(renderer.root.findByProps({ 'aria-label': '联系人资料' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': '联系人世界' })).toBeDefined()
    expect(instanceText(renderer.root.findByProps({ className: 'arkme-contact-world-title' }))).toBe('世界')
    expect(rendererText(renderer)).toContain('周小满')
    expect(rendererText(renderer)).toContain('发消息')
    expect(rendererText(renderer)).toContain('他还没有公开任何内容')
    expect(rendererText(renderer)).not.toContain('进入TA的世界')
    expect(renderer.root.findAllByProps({ 'aria-label': '返回联系人资料' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-arkme-contact-world-shell': true })).toHaveLength(0)
    await act(async () => { renderer.unmount() })
  })

  it('loads on mount, aborts A on a B rerender, ignores stale A results, and resets on account change', async () => {
    const profileRequests: Array<{
      contactRef: string
      signal: AbortSignal
      result: ReturnType<typeof deferred<ArkmeDirectoryContactProfile>>
    }> = []
    const worldRequests: Array<{
      contactRef: string
      options: { limit: number; offset: number }
      signal: AbortSignal
      result: ReturnType<typeof deferred<ArkmeWorldFeedPage>>
    }> = []
    const loadProfile = vi.fn((contactRef: string, signal: AbortSignal) => {
      const result = deferred<ArkmeDirectoryContactProfile>()
      profileRequests.push({ contactRef, signal, result })
      return result.promise
    })
    const loadWorld = vi.fn((
      contactRef: string,
      options: { limit: number; offset: number },
      signal: AbortSignal,
    ) => {
      const result = deferred<ArkmeWorldFeedPage>()
      worldRequests.push({ contactRef, options, signal, result })
      return result.promise
    })
    const onSelectionCleared = vi.fn()
    const onSourceActivated = vi.fn()
    const props = (accountKey: string, contactRef: string) => ({
      accountKey,
      contactRef,
      onSelectionCleared,
      onSourceActivated,
      loadProfile,
      loadWorld,
      openChat: async () => ({ source }),
    })
    let renderer!: ReactTestRenderer

    await act(async () => { renderer = create(<ContactProfileDetail {...props('account-a', 'contact-a')} />) })
    expect(profileRequests.map(request => request.contactRef)).toEqual(['contact-a'])
    expect(worldRequests.map(request => [request.contactRef, request.options])).toEqual([
      ['contact-a', { limit: 20, offset: 0 }],
    ])
    expect(rendererText(renderer)).toContain('正在加载联系人资料')
    expect(rendererText(renderer)).toContain('正在加载 TA 的世界')

    await act(async () => { renderer.update(<ContactProfileDetail {...props('account-a', 'contact-b')} />) })
    expect(profileRequests[0]?.signal.aborted).toBe(true)
    expect(worldRequests[0]?.signal.aborted).toBe(true)
    expect(profileRequests.map(request => request.contactRef)).toEqual(['contact-a', 'contact-b'])
    expect(worldRequests.map(request => request.contactRef)).toEqual(['contact-a', 'contact-b'])

    await act(async () => {
      profileRequests[0]?.result.resolve(profileFor('contact-a', '过期联系人 A'))
      worldRequests[0]?.result.resolve(page([mountedWorldItem('stale-world', '过期作者 A')]))
      profileRequests[1]?.result.resolve(profileFor('contact-b', '联系人 B'))
      worldRequests[1]?.result.resolve(page([mountedWorldItem('world-b', '联系人 B')]))
      await tick()
    })
    expect(rendererText(renderer)).toContain('联系人 B')
    expect(rendererText(renderer)).not.toContain('过期联系人 A')
    expect(rendererText(renderer)).not.toContain('过期作者 A')

    await act(async () => { renderer.update(<ContactProfileDetail {...props('account-b', 'contact-b')} />) })
    expect(profileRequests[1]?.signal.aborted).toBe(true)
    expect(worldRequests[1]?.signal.aborted).toBe(true)
    expect(profileRequests).toHaveLength(3)
    expect(worldRequests).toHaveLength(3)
    expect(rendererText(renderer)).toContain('正在加载联系人资料')
    expect(rendererText(renderer)).not.toContain('联系人 B备注')

    await act(async () => {
      profileRequests[2]?.result.resolve(profileFor('contact-b', '新账户联系人'))
      worldRequests[2]?.result.resolve(page([], { total: 0 }))
      await tick()
    })
    expect(rendererText(renderer)).toContain('新账户联系人')
    expect(rendererText(renderer)).not.toContain('进入TA的世界')
    expect(rendererText(renderer)).toContain('他还没有公开任何内容')
    await act(async () => { renderer.unmount() })
  })

  it('opens a message from the actual button, disables only in flight, hands off success, and shows local failure', async () => {
    const chatRequests: Array<ReturnType<typeof deferred<ArkmeOpenPrivateChatResult>>> = []
    const openChat = vi.fn((_contactRef: string, _signal: AbortSignal) => {
      const result = deferred<ArkmeOpenPrivateChatResult>()
      chatRequests.push(result)
      return result.promise
    })
    const onSelectionCleared = vi.fn()
    const onSourceActivated = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactProfileDetail
        accountKey="account-a"
        contactRef="contact-a"
        onSelectionCleared={onSelectionCleared}
        onSourceActivated={onSourceActivated}
        loadProfile={async () => profileFor('contact-a', '联系人 A')}
        loadWorld={async () => page([], { total: 0 })}
        openChat={openChat}
      />)
      await tick()
    })

    expect(messageButton(renderer).props.disabled).toBe(false)
    await act(async () => {
      messageButton(renderer).props.onClick()
      messageButton(renderer).props.onClick()
    })
    expect(openChat).toHaveBeenCalledOnce()
    expect(openChat.mock.calls[0]?.[0]).toBe('contact-a')
    expect(messageButton(renderer).props.disabled).toBe(true)
    expect(instanceText(messageButton(renderer))).toBe('正在打开…')

    await act(async () => {
      chatRequests[0]?.resolve({ source })
      await tick()
    })
    expect(messageButton(renderer).props.disabled).toBe(false)
    expect(onSelectionCleared).toHaveBeenCalledOnce()
    expect(onSourceActivated).toHaveBeenCalledWith(source)

    await act(async () => { messageButton(renderer).props.onClick() })
    expect(messageButton(renderer).props.disabled).toBe(true)
    await act(async () => {
      chatRequests[1]?.reject(new Error('会话服务暂不可用'))
      await tick()
    })
    expect(messageButton(renderer).props.disabled).toBe(false)
    expect(rendererText(renderer)).toContain('会话服务暂不可用')
    expect(onSelectionCleared).toHaveBeenCalledOnce()
    expect(onSourceActivated).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() })
  })

  it('aborts mounted profile, World, and in-flight message requests on unmount without handoff', async () => {
    const profileResult = deferred<ArkmeDirectoryContactProfile>()
    const worldResult = deferred<ArkmeWorldFeedPage>()
    const chatResult = deferred<ArkmeOpenPrivateChatResult>()
    let profileSignal: AbortSignal | undefined
    let worldSignal: AbortSignal | undefined
    let chatSignal: AbortSignal | undefined
    const onSelectionCleared = vi.fn()
    const onSourceActivated = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ContactProfileDetail
        accountKey="account-a"
        contactRef="contact-a"
        onSelectionCleared={onSelectionCleared}
        onSourceActivated={onSourceActivated}
        loadProfile={(_contactRef, signal) => { profileSignal = signal; return profileResult.promise }}
        loadWorld={(_contactRef, _options, signal) => { worldSignal = signal; return worldResult.promise }}
        openChat={(_contactRef, signal) => { chatSignal = signal; return chatResult.promise }}
      />)
    })
    await act(async () => { messageButton(renderer).props.onClick() })
    expect(messageButton(renderer).props.disabled).toBe(true)

    await act(async () => { renderer.unmount() })
    expect(profileSignal?.aborted).toBe(true)
    expect(worldSignal?.aborted).toBe(true)
    expect(chatSignal?.aborted).toBe(true)
    await act(async () => {
      profileResult.resolve(profileFor('contact-a', '卸载后的资料'))
      worldResult.resolve(page([mountedWorldItem('late-world', '卸载后的作者')]))
      chatResult.resolve({ source })
      await tick()
    })
    expect(onSelectionCleared).not.toHaveBeenCalled()
    expect(onSourceActivated).not.toHaveBeenCalled()
  })
})
