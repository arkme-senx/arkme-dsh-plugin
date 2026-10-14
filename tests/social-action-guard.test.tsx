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
import { socialAccessStore } from '../src/client/social-access-store.js'
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
  provider.call.mockReset().mockImplementation(async operation => operation === 'user.profile.refresh' ? profile() : { ok: true })
  provider.upload.mockReset(); provider.publish.mockReset()
})
afterEach(async () => {
  await act(async () => { root?.unmount() }); root = undefined
  socialBindingPrompt.close(); socialAccessStore.activate(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  document.body.innerHTML = ''; localStorage.clear()
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
    await expect(callArkme(operation, { textContent: '保留草稿' })).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    expect(provider.call.mock.calls.map(([op]) => op)).toEqual(['user.profile.refresh'])
    expect(socialBindingPrompt.getSnapshot()?.accountKey).toBe('test:42')
  })
  it('keeps world reaction reads and removals available, gates adding a reaction', async () => {
    socialAccessStore.confirm('test:42', false)
    await callArkme('reactions', { action: 'query', targets: [] })
    await callArkme('reactions', { action: 'set', active: false, target: { worldRecordRef: 'post' } })
    await expect(callArkme('reactions', { action: 'set', active: true, target: { worldRecordRef: 'post' } })).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    expect(provider.call.mock.calls.filter(([op]) => op === 'reactions')).toHaveLength(2)
  })
  it('refreshes stale unbound state and lets a newly bound account submit without a prompt', async () => {
    socialAccessStore.confirm('test:42', false)
    provider.call.mockImplementation(async operation => operation === 'user.profile.refresh' ? profile('138****0000') : { ok: true })
    await expect(callArkme('world.interactions.create-text', { textContent: '评论' })).resolves.toEqual({ ok: true })
    expect(socialAccessStore.getSnapshot().allowed).toBe(true)
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it('does not authorize a write from a previously bound display cache after remote unbinding', async () => {
    socialAccessStore.confirm('test:42', true)
    await expect(callArkme('world.publish-text')).rejects.toMatchObject({ body: { code: 'social-phone-binding-required' } })
    expect(provider.call.mock.calls.map(([op]) => op)).toEqual(['user.profile.refresh'])
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
    await expect(callArkme('world.publish-text')).rejects.toThrow('offline')
    expect(provider.call).toHaveBeenCalledOnce()
    expect(socialBindingPrompt.getSnapshot()).toBeUndefined()
  })
  it('rejects a late profile after switching accounts without prompting or sending as the new user', async () => {
    let finish!: (value: unknown) => void
    provider.call.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const pending = callArkme('world.publish-text')
    const rejected = expect(pending).rejects.toBeDefined()
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
    const input = document.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '保留世界草稿')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const fileInput = document.querySelector('input[type="file"]')!
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [new File(['photo'], 'photo.png', { type: 'image/png' })] })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const submit = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('发布') && !node.getAttribute('aria-label')?.includes('关闭'))!
    await act(async () => submit.click())
    expect(socialBindingPrompt.getSnapshot()).toBeDefined()
    expect(provider.upload).not.toHaveBeenCalled(); expect(provider.publish).not.toHaveBeenCalled()
    expect(input.value).toBe('保留世界草稿')
    expect(closed).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled()
    await act(async () => button('暂不绑定').click())
    expect(input.value).toBe('保留世界草稿')
  })
})
