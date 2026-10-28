// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn(), publish: vi.fn() }))
vi.mock('../src/sdk/index.js', async original => ({
  ...await original<typeof import('../src/sdk/index.js')>(),
  callArkme: provider.call,
  createArkmeSdk: () => ({ upload: provider.upload, publishWorldText: provider.publish, publishWorldFileAssets: provider.publish }),
}))
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { socialAccessStore, SOCIAL_ACCESS_TTL_MS, SOCIAL_ACCESS_READ_TIMEOUT_MS, confirmPhoneBinding } from '../src/client/social-access-store.js'
import { requirePhoneForSocialAction, socialBindingPrompt } from '../src/client/social-action-guard.js'
import { ArkmeSocialBindingDialog } from '../src/client/ArkmeSocialBindingDialog.js'
import { PublishDialog, ArkmeWorldContent } from '../src/client/ArkmeWorldSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'

let root: Root | undefined
const profile = (phone?: string, userId = 42) => ({ profile: { userId, contact: { phoneMasked: phone } } })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  socialAccessStore.activate('test:42')
  provider.call.mockReset().mockImplementation(async operation => operation.startsWith('user.profile') ? profile() : { ok: true })
  provider.upload.mockReset(); provider.publish.mockReset()
})
afterEach(async () => {
  await act(async () => { root?.unmount() }); root = undefined
  socialBindingPrompt.close(); socialAccessStore.activate(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  document.body.innerHTML = ''; localStorage.clear()
  vi.useRealTimers()
})
const mount = async (content: React.ReactNode) => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(content))
}
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label)!

describe('browse without binding; prompt only on social writes', () => {
  it.each(['world.feed', 'world.user', 'world.record.read', 'world.image.read', 'world.interactions.list', 'world.interactions.mark-viewed', 'sources.list', 'contacts.search', 'calls.history.list', 'team.app.official', 'team.app.timeline', 'source.send-text', 'recordings.day'] as const)('does not gate %s or fetch a profile for a read/personal operation', async operation => {
    socialAccessStore.confirm('test:42', false)
    await expect(callArkme(operation)).resolves.toEqual({ ok: true })
    expect(provider.call).toHaveBeenCalledExactlyOnceWith(operation, operation.startsWith('team.app.') ? { expectedAccountKey: 'test:42' } : undefined, undefined)
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it.each(['world.publish-text', 'world.publish-file-assets', 'world.interactions.create-text', 'contacts.add', 'group.create', 'calls.outgoing.prepare', 'team.app.send.enqueue', 'team.app.join', 'team.app.create'] as const)('blocks unbound %s before the provider write', async operation => {
    socialAccessStore.confirm('test:42', false)
    await expect(callArkme(operation, { textContent: '保留草稿' })).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    expect(provider.call).not.toHaveBeenCalled()
    expect(socialBindingPrompt.getSnapshot()?.accountKey).toBe('test:42')
  })
  it('keeps world reaction reads and removals available, gates adding a reaction', async () => {
    socialAccessStore.confirm('test:42', false)
    await callArkme('reactions', { action: 'query', targets: [] })
    await callArkme('reactions', { action: 'set', active: false, target: { worldRecordRef: 'post' } })
    await expect(callArkme('reactions', { action: 'set', active: true, target: { worldRecordRef: 'post' } })).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    expect(provider.call.mock.calls.filter(([op]) => op === 'reactions')).toHaveLength(2)
  })
  it('uses the old denial while refreshing, then lets a remotely bound account submit', async () => {
    vi.useFakeTimers()
    socialAccessStore.confirm('test:42', false)
    vi.advanceTimersByTime(SOCIAL_ACCESS_TTL_MS)
    let finish!: (value: unknown) => void
    provider.call.mockImplementation(operation => operation === 'user.profile.refresh' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true }))
    await expect(callArkme('world.interactions.create-text')).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    socialBindingPrompt.close()
    finish(profile('138****0000'))
    await socialAccessStore.refresh()
    await expect(callArkme('world.interactions.create-text', { textContent: '评论' })).resolves.toEqual({ ok: true })
    expect(socialAccessStore.getSnapshot().allowed).toBe(true)
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it('immediately uses a successful binding without another profile request', async () => {
    socialAccessStore.confirm('test:42', false)
    confirmPhoneBinding(arkmeAuthStore.getSnapshot().auth!, true)
    provider.call.mockImplementation(async operation => operation === 'user.profile.refresh' ? profile('138****0000') : { ok: true })
    await expect(callArkme('world.interactions.create-text', { textContent: '评论' })).resolves.toEqual({ ok: true })
    expect(socialAccessStore.getSnapshot().allowed).toBe(true)
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
    expect(provider.call.mock.calls.map(([op]) => op)).toEqual(['world.interactions.create-text'])
  })
  it('does not prefetch a profile for a confirmed bound account', async () => {
    socialAccessStore.confirm('test:42', true)
    await expect(callArkme('world.publish-text')).resolves.toEqual({ ok: true })
    expect(provider.call.mock.calls.map(([op]) => op)).toEqual(['world.publish-text'])
  })
  it('lets repeated bound sends finish while an expired refresh hangs, including after timeout', async () => {
    vi.useFakeTimers()
    socialAccessStore.confirm('test:42', true)
    vi.advanceTimersByTime(SOCIAL_ACCESS_TTL_MS)
    provider.call.mockImplementation(operation => operation === 'user.profile.refresh' ? new Promise(() => {}) : Promise.resolve({ ok: true }))
    for (let i = 0; i < 3; i++) await expect(callArkme('world.interactions.create-text')).resolves.toEqual({ ok: true })
    expect(provider.call.mock.calls.filter(([op]) => op === 'user.profile.refresh')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(SOCIAL_ACCESS_READ_TIMEOUT_MS)
    await expect(callArkme('world.interactions.create-text')).resolves.toEqual({ ok: true })
    expect(socialAccessStore.getSnapshot().allowed).toBe(true)
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it('adopts a confirmed remote unbinding for the next action', async () => {
    socialAccessStore.confirm('test:42', true)
    await socialAccessStore.refresh()
    provider.call.mockClear()
    await expect(callArkme('world.publish-text')).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    expect(provider.call).not.toHaveBeenCalled()
  })
  it('renders a world post and its comments without binding and retains a rejected comment draft', async () => {
    socialAccessStore.confirm('test:42', false)
    provider.call.mockImplementation(async operation => {
      if (operation === 'user.profile.refresh') return profile()
      if (operation === 'world.interactions.list') return { items: [{ interactionRef: 'comment', authorName: '读者', textContent: '已有评论可阅读', createdAtMillis: 1700000000000, publishedAtMillis: 1700000000000, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0 }], hasMore: false }
      if (operation === 'world.author-labels') return []
      return { items: [], hasMore: false }
    })
    const noop = () => {}
    const item = { recordRef: 'post', authorName: '作者', headline: '他人的世界', textContent: '未绑定也可以阅读正文', tags: [], templateKind: 0, createdAtMillis: 1700000000000, publishedAtMillis: 1700000000000, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 1 }
    await mount(<><ArkmeWorldContent state={{ status: 'success', items: [item] }} scope="all" voiceprintPlayableRefs={new Set()} voiceprintRecordRef={undefined} interactionRecordRef="post" onRefresh={noop} onSelectScope={noop} onOpenComposer={noop} onOpenInteractions={noop} onToggleVoiceprint={noop} onOpenExtension={noop} /><ArkmeSocialBindingDialog /></>)
    expect(document.body.textContent).toContain('未绑定也可以阅读正文')
    expect(document.body.textContent).toContain('已有评论可阅读')
    expect(provider.call.mock.calls.some(([op]) => op === 'user.profile.refresh')).toBe(false)
    const input = document.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '待发送评论')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('发送').click())
    expect(socialBindingPrompt.getSnapshot()).toBeDefined()
    expect(provider.call.mock.calls.some(([op]) => op === 'world.interactions.create-text')).toBe(false)
    await act(async () => button('暂不绑定').click())
    expect(input.value).toBe('待发送评论')
    expect(document.body.textContent).toContain('已有评论可阅读')
  })
  it('does not treat unavailable profile data as bound or as an unbound prompt', async () => {
    provider.call.mockRejectedValue(new Error('offline'))
    await expect(callArkme('world.publish-text')).rejects.toThrow('暂时无法确认手机号绑定状态')
    expect(provider.call.mock.calls.map(([op]) => op)).toEqual(['user.profile', 'user.profile.refresh'])
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it('bounds a cold read and allows a later retry without showing a false binding prompt', async () => {
    vi.useFakeTimers()
    provider.call.mockReturnValue(new Promise(() => {}))
    const rejected = expect(callArkme('world.publish-text')).rejects.toThrow('暂时无法确认手机号绑定状态')
    await vi.advanceTimersByTimeAsync(SOCIAL_ACCESS_READ_TIMEOUT_MS)
    await rejected
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
    expect(socialAccessStore.getSnapshot().allowed).toBeNull()
    vi.advanceTimersByTime(5_000)
    provider.call.mockImplementation(async operation => operation.startsWith('user.profile') ? profile('138****0000') : { ok: true })
    await expect(callArkme('world.publish-text')).resolves.toEqual({ ok: true })
  })
  it('detaches a cancelled cold caller without cancelling another caller sharing its read', async () => {
    let finish!: (value: unknown) => void
    provider.call.mockImplementation(operation => operation.startsWith('user.profile') ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true }))
    const controller = new AbortController()
    const first = requirePhoneForSocialAction('发送消息', controller.signal)
    const rejected = expect(first).rejects.toBeDefined()
    const second = requirePhoneForSocialAction('发送消息')
    controller.abort(); await rejected
    finish(profile('138****0000'))
    await expect(second).resolves.toBeUndefined()
    expect(socialAccessStore.getSnapshot().allowed).toBe(true)
  })
  it('rejects a late profile after switching accounts without prompting or sending as the new user', async () => {
    let finish!: (value: unknown) => void
    provider.call.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const pending = callArkme('world.publish-text')
    const rejected = expect(pending).rejects.toBeDefined()
    await vi.waitFor(() => expect(provider.call).toHaveBeenCalledOnce())
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
    finish(profile('138****0000'))
    await rejected
    expect(provider.call).toHaveBeenCalledOnce()
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it('opens existing account settings only after choosing to bind; cancel keeps the current page', async () => {
    const settings = vi.fn(), stop = arkmeUi.bindSettingsOpener(settings)
    await mount(<ArkmeSocialBindingDialog />)
    try {
      await act(async () => { await requirePhoneForSocialAction('发表评论或回复').catch(() => {}) })
      expect(document.body.textContent).toContain('你仍可继续浏览')
      await act(async () => button('暂不绑定').click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(settings).not.toHaveBeenCalled()
      await act(async () => { await requirePhoneForSocialAction('发表评论或回复').catch(() => {}) })
      await act(async () => button('去绑定').click())
      expect(settings).toHaveBeenCalledExactlyOnceWith('arkme-account')
    } finally { stop() }
  })
  it('retains world text and selected images and does not upload them when binding is required', async () => {
    const closed = vi.fn(), published = vi.fn()
    await mount(<><PublishDialog onClose={closed} onPublished={published} /><ArkmeSocialBindingDialog /></>)
    const input = document.querySelector<HTMLElement>('[role="textbox"][aria-label="世界内容"]')!
    await act(async () => {
      input.textContent = '保留世界草稿'
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '保留世界草稿' }))
    })
    const fileInput = document.querySelector('input[type="file"]')!
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [new File(['photo'], 'photo.png', { type: 'image/png' })] })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const submit = document.querySelector<HTMLButtonElement>('[aria-label="发布"]')!
    await act(async () => submit.click())
    expect(socialBindingPrompt.getSnapshot()).toBeDefined()
    expect(provider.upload).not.toHaveBeenCalled(); expect(provider.publish).not.toHaveBeenCalled()
    expect(input.textContent).toBe('保留世界草稿')
    expect(closed).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled()
    await act(async () => button('暂不绑定').click())
    expect(input.textContent).toBe('保留世界草稿')
  })
})
