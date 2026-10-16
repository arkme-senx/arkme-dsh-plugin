import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeComposerDraftStore, arkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import { ConversationDraftPresence, conversationDraftPresence, useConversationDraftPresence } from '../src/client/conversation-draft-presence.js'
import { withConversationDraftActivity } from '../src/client/conversation-draft-preview.js'
import { ArkmeRootChatPreview } from '../src/client/ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeSourceItem } from '../src/types.js'

const source: ArkmeSourceItem = { kind: 'private_chat', sourceRef: 'peer', sourceKey: 'peer', displayName: '同事', activeAtMillis: 1000, latestPreview: '最近消息' }
const key = arkmeSourceComposerDraftKey(42, source)!
const rows = [source, { ...source, sourceRef: 'newer', sourceKey: 'newer', activeAtMillis: 2000 }].map(source => ({ source, activeAtMillis: source.activeAtMillis!, pinned: false }))
const owner = Symbol('test')
afterEach(() => vi.restoreAllMocks())

describe('draft publication on conversation departure', () => {
  it('saves while typing and orders by departure time only, preserving that order on reentry', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts)
    presence.update(owner, key)
    drafts.setText(key, '未发送内容')
    expect(drafts.get(key)).toMatchObject({ text: '未发送内容', editedAtMillis: 3000, leftAtMillis: 0 })
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.source.sourceRef).toBe('newer')
    now.mockReturnValue(7000)
    presence.update(owner, undefined)
    expect(drafts.get(key)).toMatchObject({ editedAtMillis: 3000, leftAtMillis: 7000 })
    expect(withConversationDraftActivity(rows, drafts, 42)[0]).toMatchObject({ source, activeAtMillis: 7000 })
    presence.update(owner, key)
    now.mockReturnValue(9000)
    // Reading, repeated editor projections and send bookkeeping are not edits.
    drafts.setText(key, '未发送内容')
    drafts.beginFileSend(key)
    presence.update(owner, undefined)
    expect(drafts.get(key).leftAtMillis).toBe(7000)
    expect(source.activeAtMillis).toBe(1000)
  })

  it('treats switching personal topics as one conversation and stamps edited topics together on departure', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts)
    const a = arkmeSourceComposerDraftKey(42, { kind: 'topic', sourceRef: 'a' })!
    const b = arkmeSourceComposerDraftKey(42, { kind: 'default_category', sourceRef: 'b' })!
    presence.update(owner, a); drafts.setText(a, '主题草稿')
    presence.update(owner, b); drafts.setText(b, '未分类草稿')
    expect(drafts.get(a).leftAtMillis).toBe(0)
    expect(presence.isActive(a)).toBe(true)
    now.mockReturnValue(8000)
    presence.update(owner, key)
    expect(drafts.get(a).leftAtMillis).toBe(8000)
    expect(drafts.get(b).leftAtMillis).toBe(8000)
    expect(presence.isActive(a)).toBe(false)
  })

  it('keeps the previous departure while editing again, and clears account-owned activity on logout', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts)
    presence.update(owner, key); drafts.setText(key, '第一版')
    now.mockReturnValue(4000); presence.update(owner, undefined)
    presence.update(owner, key)
    now.mockReturnValue(6000); drafts.setText(key, '第二版')
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.activeAtMillis).toBe(4000)
    now.mockReturnValue(8000); presence.update(owner, undefined)
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.activeAtMillis).toBe(8000)
    presence.update(owner, key); drafts.clearAccount(42); presence.update(owner, undefined)
    expect(drafts.get(key).text).toBe('')
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.source.sourceRef).toBe('newer')
  })

  it.each(['persisted', 'remote'] as const)('keeps an undated %s draft out of activity ordering until departure', origin => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(6000)
    const legacy = { text: '旧版草稿', attachments: [], mentions: [], emojis: [],
      markdown: { source: '旧版草稿', mentions: [], document: { type: 'doc', content: [] } } }
    const drafts = origin === 'persisted'
      ? new ArkmeComposerDraftStore({ getItem: () => JSON.stringify([[key, legacy]]), setItem: () => {} })
      : new ArkmeComposerDraftStore()
    if (origin === 'remote') drafts.applyRemote(key, legacy)
    const presence = new ConversationDraftPresence(drafts)
    presence.update(owner, key)
    drafts.setText(key, '编辑了没有时间的旧草稿')
    expect(drafts.get(key)).toMatchObject({ editedAtMillis: 6000, leftAtMillis: 0 })
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.source.sourceRef).toBe('newer')
    now.mockReturnValue(9000); presence.update(owner, undefined)
    expect(drafts.get(key).leftAtMillis).toBe(9000)
    expect(withConversationDraftActivity(rows, drafts, 42)[0]).toMatchObject({ source, activeAtMillis: 9000 })
  })

  it('freezes a legacy draft timestamp during editing until the user leaves', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(6000)
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts)
    drafts.applyRemote(key, { text: '旧版草稿', attachments: [], mentions: [], emojis: [], editedAtMillis: 3000 })
    presence.update(owner, key)
    drafts.setText(key, '修改旧版草稿')
    expect(drafts.get(key)).toMatchObject({ editedAtMillis: 6000, leftAtMillis: 3000 })
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.activeAtMillis).toBe(3000)
    now.mockReturnValue(9000); presence.update(owner, undefined)
    expect(drafts.get(key).leftAtMillis).toBe(9000)
  })

  it('does not hide an undated legacy draft merely because its unchanged editor projection was restored', () => {
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts)
    drafts.applyRemote(key, { text: '旧草稿', attachments: [], mentions: [], emojis: [] })
    presence.update(owner, key)
    drafts.setRichText(key, '旧草稿', [])
    presence.update(owner, undefined)
    expect(drafts.get(key).leftAtMillis).toBeUndefined()
    expect(drafts.get(key).text).toBe('旧草稿')
  })

  it('waits for the last surface to leave and ignores remote hydration as local editing', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9000)
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts), second = Symbol('second')
    presence.update(owner, key)
    drafts.applyRemote(key, { text: '远端草稿', attachments: [], mentions: [], emojis: [], editedAtMillis: 2000, leftAtMillis: 4000 })
    presence.update(owner, undefined)
    expect(drafts.get(key).leftAtMillis).toBe(4000)
    presence.update(owner, key); presence.update(second, key)
    drafts.setText(key, '本地编辑')
    presence.update(owner, undefined)
    expect(drafts.get(key).leftAtMillis).toBe(4000)
    presence.update(second, undefined)
    expect(drafts.get(key).leftAtMillis).toBe(9000)
  })

  it('retains file-only drafts, removes activity on clear, and restores failed sends after leaving', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const drafts = new ArkmeComposerDraftStore(), presence = new ConversationDraftPresence(drafts)
    presence.update(owner, key)
    drafts.appendAttachments(key, [{ asset: { fileAssetUid: 'file', fileName: '说明.pdf', mimeType: 'application/pdf', size: 10 } }])
    const submitted = drafts.take(key)
    now.mockReturnValue(5000); presence.update(owner, undefined)
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.source.sourceRef).toBe('newer')
    now.mockReturnValue(8000); drafts.restore(key, submitted)
    expect(drafts.get(key).leftAtMillis).toBe(5000)
    drafts.clear(key)
    expect(withConversationDraftActivity(rows, drafts, 42)[0]!.source.sourceRef).toBe('newer')
  })
})

it('hides the active draft in a mounted row, publishes on switching, and hides again on return without losing content', () => {
  let renderer: ReactTestRenderer | undefined
  const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
  function Scene({ activeKey }: { activeKey?: string }) {
    useConversationDraftPresence(activeKey)
    return <ArkmeRootChatPreview source={source} />
  }
  const html = () => JSON.stringify(renderer?.toJSON())
  try {
    act(() => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      renderer = create(<Scene activeKey={key} />)
    })
    act(() => { arkmeComposerDraftStore.setText(key, '待办草稿') })
    expect(html()).not.toContain('[草稿]')
    expect(html()).toContain('最近消息')
    now.mockReturnValue(6000)
    act(() => renderer!.update(<Scene />))
    expect(html()).toContain('[草稿]')
    expect(arkmeComposerDraftStore.get(key).leftAtMillis).toBe(6000)
    act(() => renderer!.update(<Scene activeKey={key} />))
    expect(html()).not.toContain('[草稿]')
    expect(arkmeComposerDraftStore.get(key).text).toBe('待办草稿')
    now.mockReturnValue(9000)
    act(() => renderer!.update(<Scene />))
    expect(arkmeComposerDraftStore.get(key).leftAtMillis).toBe(6000)
  } finally {
    act(() => { renderer?.unmount(); arkmeComposerDraftStore.clearAccount(42); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
  }
  expect(conversationDraftPresence.isActive(key)).toBe(false)
})
