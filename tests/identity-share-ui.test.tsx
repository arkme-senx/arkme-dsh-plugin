// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn(), upsert: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: api.call }))
vi.mock('../src/client/chat-directory-store.js', () => ({ arkmeChatDirectory: { upsert: api.upsert } }))
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { ArkmeMemberProfileCard } from '../src/client/ArkmeChatMemberActions.js'
import { subscribeTeamOutbound } from '../src/client/team-outbound.js'
import { IdentityShareHost } from '../src/client/IdentityShareHost.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { identityPersonCards } from '../src/client/identity-person-card-client.js'
import { IdentityCopyLinkButton } from '../src/client/IdentityCopyLinkButton.js'
import { identityShareUi } from '../src/client/identity-share-ui.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { connectArkmeLocale } from '../src/client/locale.js'
import { sharePreviewClient } from '../src/client/share-preview-client.js'

const url = 'https://jiwo.cc/linshare', scope = 'prod:7'
const groupUrl = 'https://jiwo.cc/share/topic/chat_v1_payload?code=signed&s=1793650000000'
const person = { kind: 'person', url, displayName: '小林', userId: 8, accountName: 'linshare', isSelf: false }
const group = { kind: 'group', url: groupUrl, displayName: '产品讨论', creatorDisplayName: '小周', hasJoined: false, joinMode: 2, requestPending: false, expireAtMillis: Date.now() + 3600_000 }
const source = { kind: 'private_chat', sourceRef: 'existing-A-B', displayName: '小林', peerUserId: 8, activeAtMillis: 0, unreadCount: 0 }
let root: Root, node: HTMLDivElement
const clipboard = vi.fn(async (_text: string) => {})
const mount = async (content: React.ReactNode) => { await act(async () => root.render(content)) }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(v => v.textContent === label || v.getAttribute('aria-label') === label)!
const click = async (element: Element) => { await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))) }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 7 })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  api.call.mockImplementation(async (op, params) => op === 'identity.person.read' ? person : op === 'identity.share.read' ? params.url === url ? person : group : op === 'identity.share.link' ? { kind: 'person', url } : { status: 'opened', source })
  vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve({ kind: 'world', state: 'ready', title: '小林' }), release() {} })
})
afterEach(async () => {
  await act(async () => { root.unmount(); identityShareUi.close(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' }); arkmeUi.authChanged(false, true) })
  vi.useRealTimers(); node.remove(); clipboard.mockClear(); api.call.mockReset(); api.upsert.mockReset(); vi.restoreAllMocks()
})

describe('identity links stay portable and acquire explicit in-app actions', () => {
  it('keeps message text and href while opening a card on click; only the action opens the existing private chat', async () => {
    const item = Object.freeze({ itemUid: 'link', senderName: '介绍人', isMe: false, sendAtMillis: 1, status: 1, title: '', textContent: `可以和这位朋友聊聊：${url}` })
    await mount(<><ArkmeMessageContent item={item} /><IdentityShareHost /></>)
    const link = node.querySelector('a')!
    expect(link.getAttribute('href')).toBe(url)
    expect(link.textContent).toContain('联系人名片')
    expect(api.call).not.toHaveBeenCalled()
    await click(link)
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('linshare')
    expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.share.read'])
    await click(button('发消息'))
    expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.share.read', 'identity.share.open'])
    expect(arkmeUi.getSnapshot().selectedSource).toEqual(source)
    expect(api.upsert).toHaveBeenCalledWith(source)
    expect(item.textContent).toBe(`可以和这位朋友聊聊：${url}`)
  })
  it('copies a verified plain URL and does not send a message or create a conversation', async () => {
    await mount(<IdentityCopyLinkButton target={{ kind: 'contact', contactRef: 'viewer-bound' }} label="复制个人链接" />)
    await click(button('复制个人链接'))
    expect(api.call).toHaveBeenCalledWith('identity.share.link', { accountScope: scope, kind: 'contact', contactRef: 'viewer-bound' }, expect.any(AbortSignal))
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(url)
    expect(node.textContent).toContain('链接已复制')
    expect(api.call).toHaveBeenCalledOnce()
  })
  it('does not copy a late result from another account', async () => {
    let finish!: (value: unknown) => void
    api.call.mockImplementation(async () => await new Promise(resolve => { finish = resolve }))
    await mount(<IdentityCopyLinkButton target={{ kind: 'person', userId: 8 }} />)
    await click(button('复制链接'))
    await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 99 }))
    await act(async () => finish({ kind: 'person', url }))
    expect(clipboard).not.toHaveBeenCalled()
  })
  it('keeps group approval pending without opening a conversation or retrying a write', async () => {
    api.call.mockImplementation(async op => op === 'identity.share.read' ? group : { status: 'pending' })
    await mount(<IdentityShareHost />)
    await act(async () => identityShareUi.open(scope, groupUrl))
    expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.share.read'])
    await click(button('复制群聊链接'))
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(groupUrl)
    expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.share.read'])
    await click(button('申请加入'))
    expect(button('等待审批').disabled).toBe(true)
    expect(api.upsert).not.toHaveBeenCalled()
    await click(button('等待审批'))
    expect(api.call.mock.calls.filter(([op]) => op === 'identity.share.join')).toHaveLength(1)
  })
  it('opens an already joined group using the read/open path', async () => {
    api.call.mockImplementation(async op => op === 'identity.share.read' ? { ...group, hasJoined: true } : { status: 'opened', source: { ...source, kind: 'group_chat' } })
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, groupUrl))
    await click(button('打开群聊'))
    expect(api.call.mock.calls.some(([op]) => op === 'identity.share.join')).toBe(false)
    expect(api.call.mock.calls.at(-1)?.[0]).toBe('identity.share.open')
  })
  it('disables expired invitations and retains a browser fallback for unavailable cards', async () => {
    api.call.mockResolvedValue({ ...group, expireAtMillis: Date.now() - 1 })
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, groupUrl))
    expect(button('邀请已过期').disabled).toBe(true)
    await act(async () => identityShareUi.close())
    api.call.mockRejectedValue(new Error('邀请无效'))
    await act(async () => identityShareUi.open(scope, groupUrl))
    expect(document.querySelector('[role=alert]')?.textContent).toBe('邀请无效')
    expect([...document.querySelectorAll('a')].find(a => a.textContent === '在浏览器中打开')?.href).toBe(groupUrl)
    expect(api.call.mock.calls.some(([op]) => op === 'identity.share.join')).toBe(false)
  })
  it('aborts card reads and hides the old account card immediately on account change', async () => {
    let finish!: (value: unknown) => void
    api.call.mockImplementation(async () => await new Promise(resolve => { finish = resolve }))
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url))
    const signal = api.call.mock.calls[0]![2] as AbortSignal
    await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 99 }))
    await act(async () => finish(person))
    expect(signal.aborted).toBe(true)
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
  it('traps focus within the card and prevents duplicate action clicks', async () => {
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url))
    const send = button('发消息'); button('更多操作').focus()
    await act(async () => button('更多操作').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭')
    await act(async () => { send.click(); send.click() })
    expect(api.call.mock.calls.filter(([op]) => op === 'identity.share.open')).toHaveLength(1)
  })
})


describe('one profile surface for avatars and portable links', () => {
  it('resolves an avatar through its member reference and enters the same world as the shared link', async () => {
    const close = vi.fn(), send = vi.fn()
    await mount(<ArkmeMemberProfileCard copyLinkTarget={{ kind: 'member', sourceRef: 'group-ref', memberRef: 'member-ref' }}
      member={{ displayName: '小林', memberName: '群内昵称' }} showTopicNickname busy={false} onClose={close} onSend={send} />)
    expect(api.call).toHaveBeenCalledWith('identity.person.read', { accountScope: scope, kind: 'member', sourceRef: 'group-ref', memberRef: 'member-ref' }, expect.any(AbortSignal))
    const avatarSurface = document.querySelector('[data-arkme-person-profile]')!
    expect(avatarSurface.textContent).toContain('群内昵称')
    expect(avatarSurface.textContent).toContain('linshare')
    await click(button('进入 TA 的世界'))
    expect(arkmeUi.getSnapshot().worldTarget?.userId).toBe(8)
    expect(close).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled()
    expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.person.read'])
    await mount(<IdentityShareHost />)
    await act(async () => identityShareUi.open(scope, url))
    expect(document.querySelector('[data-arkme-person-profile]')?.className).toBe(avatarSurface.className)
    await click(button('进入 TA 的世界'))
    expect(arkmeUi.getSnapshot().worldTarget?.userId).toBe(8)
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(api.call.mock.calls.some(([op]) => op.endsWith('.open'))).toBe(false)
  })
  it('offers team contact from the personal-link card through the existing selector', async () => {
    const team = vi.fn(), unsubscribe = subscribeTeamOutbound(team)
    try {
      await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url))
      await click(button('以团队联系'))
      expect(team).toHaveBeenCalledWith({ accountKey: scope, person: { recipient: { kind: 'profile-link', url, expectedUserId: 8 }, displayName: '小林' } })
      expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.share.read'])
      expect(document.querySelector('[role=dialog]')).toBeNull()
    } finally { unsubscribe() }
  })
  it('keeps self-world navigation separate from send-to-self and hides team contact', async () => {
    api.call.mockResolvedValue({ ...person, userId: 7, isSelf: true })
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url))
    expect(button('以团队联系')).toBeUndefined()
    expect(button('发给自己')).toBeDefined()
    await click(button('进入我的世界'))
    expect(arkmeUi.getSnapshot().worldTarget?.userId).toBe(7)
    expect(api.call).toHaveBeenCalledOnce()
  })
  it('aborts avatar identity reads and removes the old profile on account change', async () => {
    let finish!: (value: unknown) => void
    api.call.mockImplementation(async () => await new Promise(resolve => { finish = resolve }))
    await mount(<ArkmeMemberProfileCard copyLinkTarget={{ kind: 'member', sourceRef: 'group', memberRef: 'person' }}
      member={{ displayName: '旧账号群友' }} busy={false} onClose={() => {}} onSend={() => {}} />)
    const signal = api.call.mock.calls[0]![2] as AbortSignal
    await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 99 }))
    await act(async () => finish(person))
    expect(signal.aborted).toBe(true)
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
})

it('translates the common profile actions and footer in English', async () => {
  await act(async () => { connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} }) })
  try {
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url))
    expect(button('Visit their world')).toBeDefined()
    expect(button('Message')).toBeDefined()
    expect(button('Contact as team')).toBeDefined()
    expect(button('Copy profile link')).toBeDefined()
    await click(button('More actions'))
    expect(button('Refresh card')).toBeDefined()
  } finally {
    await act(async () => { connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} }) })
  }
})

it('opens the verified public world from a fixed conversation window without changing its conversation', async () => {
  const original = location.href
  history.replaceState({}, '', '/?arkmeConversation=1')
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const previousWorld = arkmeUi.getSnapshot().worldTarget
  try {
    await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url))
    expect(button('以团队联系')).toBeUndefined()
    await click(button('进入 TA 的世界'))
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
    expect(arkmeUi.getSnapshot().worldTarget).toBe(previousWorld)
    expect(api.call.mock.calls.map(([op]) => op)).toEqual(['identity.share.read'])
  } finally { history.replaceState({}, '', original) }
})


it('shows the person shell immediately on a slow first read and keeps close usable', async () => {
  let finish!: (value: unknown) => void
  api.call.mockImplementation(async () => await new Promise(resolve => { finish = resolve }))
  await mount(<IdentityShareHost />); await act(async () => identityShareUi.open(scope, url, '预览昵称'))
  const element = document.querySelector('[data-arkme-person-profile]')!
  expect(element.textContent).toContain('预览昵称')
  expect(element.textContent).not.toContain('加入群聊')
  expect(button('发消息').disabled).toBe(true)
  expect(button('关闭').disabled).toBe(false)
  await click(button('关闭')); await act(async () => finish(person))
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(identityPersonCards.snapshot(scope, url)).toBeUndefined()
})
it('opens a preloaded card without another read, and repeats without a loading flash', async () => {
  const preload = identityPersonCards.acquire(scope, url);await act(async () => { await preload.promise });preload.release()
  api.call.mockClear()
  await mount(<IdentityShareHost />)
  for (let i = 0; i < 2; i++) {
    await act(async () => identityShareUi.open(scope, url))
    expect(document.querySelector('[data-arkme-person-profile-ready=true]')).not.toBeNull()
    expect(button('发消息').disabled).toBe(false)
    expect(document.body.textContent).not.toContain('正在读取资料…')
    await click(button('关闭'))
  }
  expect(api.call).not.toHaveBeenCalled()
})
it('shares an in-flight preview read with a clicked dialog without a duplicate request', async () => {
  let finish!: (value: unknown) => void
  api.call.mockImplementation(async () => await new Promise(resolve => { finish = resolve }))
  const preload=identityPersonCards.acquire(scope,url)
  await mount(<IdentityShareHost />);await act(async () => identityShareUi.open(scope,url))
  expect(api.call).toHaveBeenCalledOnce();preload.release()
  expect((api.call.mock.calls[0]![2] as AbortSignal).aborted).toBe(false)
  await act(async () => {finish(person);await preload.promise})
  expect(document.querySelector('[data-arkme-person-profile-ready=true]')).not.toBeNull()
  expect(api.call).toHaveBeenCalledOnce()
})
it('keeps a stale card usable during refresh and still sends with the displayed expected identity', async () => {
  let now=100;vi.spyOn(Date,'now').mockImplementation(()=>now)
  const preload=identityPersonCards.acquire(scope,url);await preload.promise;preload.release();now+=61_000
  let refresh!: (value: unknown) => void
  api.call.mockImplementation(async op=>op==='identity.share.read' ? await new Promise(resolve=>{refresh=resolve}) : {status:'opened',source})
  await mount(<IdentityShareHost />);await act(async () => identityShareUi.open(scope,url))
  expect(button('发消息').disabled).toBe(false)
  await click(button('发消息'))
  expect(api.call.mock.calls.at(-1)?.slice(0,2)).toEqual(['identity.share.open',{accountScope:scope,url,expectedUserId:8}])
  await act(async()=>refresh(person))
})

it('prepares the actual visible message preview and the popup with one native identity read', async () => {
  vi.mocked(sharePreviewClient.acquire).mockRestore()
  await mount(<><ArkmeMessageContent item={{itemUid:'preload',senderName:'介绍人',isMe:false,sendAtMillis:1,status:1,title:'',textContent:url}} /><IdentityShareHost /></>)
  const link=node.querySelector('a')!
  expect(link.textContent).toContain('小林')
  expect(api.call.mock.calls.map(([op])=>op)).toEqual(['identity.share.read'])
  await click(link)
  expect(document.querySelector('[data-arkme-person-profile-ready=true]')).not.toBeNull()
  expect(api.call).toHaveBeenCalledOnce()
})


it('copies the received profile URL immediately without resolving it again', async () => {
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,url))
  api.call.mockClear();await click(button('复制个人链接'))
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(url)
  expect(api.call).not.toHaveBeenCalled()
})
it('preserves the received host and path when copying and rejects cross-environment links', async () => {
  const alias='https://app.jiwo.cc/shijie/linshare'
  await mount(<IdentityCopyLinkButton url={alias} />);await click(button('复制链接'))
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(alias);clipboard.mockClear()
  await mount(<IdentityCopyLinkButton url="https://jotmo-app.senguo.me/linshare" />);await click(button('复制链接'))
  expect(clipboard).not.toHaveBeenCalled();expect(api.call).not.toHaveBeenCalled()
  expect(document.querySelector('[role=alert]')?.textContent).toContain('名片链接无效')
})
it('warms the avatar during visible-link preparation without delaying the ready preview', async () => {
  vi.mocked(sharePreviewClient.acquire).mockRestore()
  let finish!: (value:string)=>void
  const image=vi.spyOn(arkmeAvatarImages,'load').mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  api.call.mockResolvedValue({...person,avatarRef:'verified-profile-image'})
  await mount(<ArkmeMessageContent item={{itemUid:'avatar-preload',senderName:'介绍人',isMe:false,sendAtMillis:1,status:1,title:'',textContent:url}} />)
  expect(node.querySelector('a')?.textContent).toContain('小林')
  expect(image).toHaveBeenCalledWith('verified-profile-image')
  expect(identityShareUi.getSnapshot()).toBeUndefined()
  await act(async()=>finish('data:image/png;base64,fixture'))
})
it('shows refresh progress, blocks repeated refresh and keeps the loaded card interactive', async () => {
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,url))
  api.call.mockClear();let finish!: (value:unknown)=>void
  api.call.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  await click(button('更多操作'));await click(button('刷新名片'))
  expect(document.querySelector('[role=status]')?.textContent).toBe('更新中…')
  expect(button('发消息').disabled).toBe(false);expect(button('关闭').disabled).toBe(false)
  await click(button('更多操作'));const refresh=button('更新中…');expect(refresh.disabled).toBe(true)
  await click(refresh);expect(api.call).toHaveBeenCalledOnce()
  await act(async()=>finish(person))
  expect(button('刷新名片').disabled).toBe(false)
  expect(document.querySelector('[role=status]')?.textContent).toBe('')
})
it('keeps the cached profile on a transient refresh error and retries in place', async () => {
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,url))
  api.call.mockRejectedValueOnce(new Error('temporary network failure'))
  await click(button('更多操作'));await click(button('刷新名片'))
  expect(document.querySelector('[role=status]')?.textContent).toContain('更新失败')
  expect(document.querySelector('[role=alert]')).toBeNull()
  expect(document.querySelector('[data-arkme-person-profile-ready=true]')).not.toBeNull()
  expect(button('发消息').disabled).toBe(false)
  api.call.mockResolvedValueOnce(person);await click(button('重试更新名片'))
  expect(document.querySelector('[role=status]')?.textContent).toBe('')
})
it('updates a group invitation to expired while it remains open without a network request', async () => {
  vi.useFakeTimers();api.call.mockResolvedValue({...group,joinMode:1,expireAtMillis:Date.now()+1000})
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,groupUrl))
  expect(button('加入群聊').disabled).toBe(false)
  await act(async()=>{await vi.advanceTimersByTimeAsync(1002)})
  expect(button('邀请已过期').disabled).toBe(true);expect(api.call).toHaveBeenCalledOnce()
})
it('refreshes a pending approval and offers Open without automatically opening or joining', async () => {
  vi.useFakeTimers();api.call.mockResolvedValueOnce({...group,requestPending:true}).mockResolvedValue({...group,hasJoined:true})
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,groupUrl))
  expect(button('等待审批').disabled).toBe(true)
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000)})
  expect(button('打开群聊').disabled).toBe(false)
  await act(async()=>{await vi.advanceTimersByTimeAsync(30_000)})
  expect(api.call.mock.calls.map(([op])=>op)).toEqual(['identity.share.read','identity.share.read'])
})
it('pauses approval reads when hidden, checks on return and stops after close', async () => {
  vi.useFakeTimers();const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(false)
  api.call.mockResolvedValue({...group,requestPending:true})
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,groupUrl))
  await act(async()=>{hidden.mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(30_000)})
  expect(api.call).toHaveBeenCalledOnce()
  await act(async()=>{hidden.mockReturnValue(false);document.dispatchEvent(new Event('visibilitychange'))})
  expect(api.call).toHaveBeenCalledTimes(2)
  await act(async()=>identityShareUi.close())
  await act(async()=>{await vi.advanceTimersByTimeAsync(30_000)})
  expect(api.call).toHaveBeenCalledTimes(2)
})

it('copies the received URL even when its profile read is still pending', async () => {
  let finish!: (value:unknown)=>void
  api.call.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  await mount(<IdentityShareHost />);await act(async()=>identityShareUi.open(scope,url))
  await click(button('复制个人链接'))
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(url)
  expect(api.call.mock.calls.map(([op])=>op)).toEqual(['identity.share.read'])
  expect(button('发消息').disabled).toBe(true)
  await click(button('关闭'));await act(async()=>finish(person))
})
