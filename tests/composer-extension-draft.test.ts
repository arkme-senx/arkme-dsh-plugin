import { describe, expect, it, vi } from 'vitest'
import { ArkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import type { ArkmeTimelineItem } from '../src/types.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'

const parent: ArkmeTimelineItem = { itemUid: 'parent', messageActionRef: 'opaque-parent', senderName: '作者',
  isMe: false, sendAtMillis: 1, title: '', textContent: '父消息', status: 1 }
const key = arkmeSourceComposerDraftKey(42, { kind: 'group_chat', sourceRef: 'old', sourceKey: 'chat:stable' })!
function fixture() {
  let saved = '[]'
  const storage = { getItem: () => saved, setItem: vi.fn((_key: string, value: string) => { saved = value }) }
  return { storage, store: new ArkmeComposerDraftStore(storage) }
}

describe('extension draft ownership', () => {
  it.each(['', '未发出的正文'])('restores the parent and text after a full browser store reload (%s)', text => {
    const { store, storage } = fixture()
    store.setExtensionTarget(key, parent)
    store.setText(key, text)
    const refreshedKey = arkmeSourceComposerDraftKey(42, { kind: 'group_chat', sourceRef: 'new', sourceKey: 'chat:stable' })!
    expect(new ArkmeComposerDraftStore(storage).get(refreshedKey)).toMatchObject({ text, extensionTarget: { item: parent } })
  })

  it('preserves the parent through every plain editor operation and removing the last attachment', () => {
    const { store } = fixture()
    store.setExtensionTarget(key, parent)
    store.setText(key, '正文')
    store.insertMention(key, 'mention', '成员', 0)
    store.insertBotMention(key, 'bot', '助手', 0)
    store.insertAllMention(key, 0)
    store.insertHashTag(key, '标签', 0)
    store.insertEmoji(key, arkmeDefaultEmojis[0]!, 0)
    store.setRichText(key, '', [])
    store.appendAttachments(key, [{ localFile: { fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001',
      fileName: 'a.txt', mimeType: 'text/plain', size: 1, fileKind: 4 } }])
    store.removeAttachment(key, 'arkme-file-v1.00000000-0000-4000-8000-000000000001')
    expect(store.get(key)).toMatchObject({ text: '', attachments: [], extensionTarget: { item: parent } })
  })

  it('cancels only the parent and does not resurrect it on reload', () => {
    const { store, storage } = fixture()
    store.setExtensionTarget(key, parent)
    store.setText(key, '保留正文')
    store.setExtensionTarget(key, undefined)
    expect(store.get(key).text).toBe('保留正文')
    expect(store.get(key).extensionTarget).toBeUndefined()
    expect(new ArkmeComposerDraftStore(storage).get(key).extensionTarget).toBeUndefined()
  })

  it('consumes the parent with the draft and restores both plus send identity after failure', () => {
    const { store, storage } = fixture()
    store.setExtensionTarget(key, parent); store.setText(key, '延展正文')
    const identity = store.beginFileSend(key, 'extension:parent')
    const pending = store.take(key)
    expect(new ArkmeComposerDraftStore(storage).get(key).extensionTarget).toBeUndefined()
    store.restore(key, pending)
    const restored = new ArkmeComposerDraftStore(storage)
    expect(restored.get(key).extensionTarget?.item).toEqual(parent)
    expect(restored.beginFileSend(key, 'extension:parent')).toEqual(identity)
  })

  it.each(['plain', 'extension'] as const)('never attaches an old parent to a newer %s draft on late failure', mode => {
    const { store } = fixture()
    store.setExtensionTarget(key, parent); store.setText(key, '旧正文')
    store.beginFileSend(key, 'extension:parent')
    const pending = store.take(key)
    if (mode === 'extension') store.setExtensionTarget(key, { ...parent, itemUid: 'new', messageActionRef: 'new-action' })
    store.setText(key, '新正文')
    store.restore(key, pending)
    expect(store.get(key).text).toBe('新正文')
    expect(store.get(key).extensionTarget?.item.itemUid).toBe(mode === 'plain' ? undefined : 'new')
    expect(store.get(key).fileSendIdentity).toBeUndefined()
  })

  it('isolates accounts and clears the persisted parent on logout', () => {
    const { store, storage } = fixture()
    store.setExtensionTarget(key, parent)
    const other = arkmeSourceComposerDraftKey(43, { kind: 'group_chat', sourceRef: 'old', sourceKey: 'chat:stable' })!
    expect(store.get(other).extensionTarget).toBeUndefined()
    store.clearAccount(42)
    expect(new ArkmeComposerDraftStore(storage).get(key).extensionTarget).toBeUndefined()
  })

  it('replicates the parent with its text using the existing desktop draft snapshot', () => {
    const { store } = fixture()
    store.setExtensionTarget(key, parent); store.setText(key, '正文')
    const secondary = new ArkmeComposerDraftStore()
    secondary.applyRemote(key, JSON.parse(JSON.stringify(store.get(key))))
    expect(secondary.get(key)).toEqual(store.get(key))
    secondary.applyRemote(key, null)
    expect(secondary.get(key).extensionTarget).toBeUndefined()
  })

  it('persists a bounded preview without retaining the original timeline payload', () => {
    const { store, storage } = fixture()
    const block = { kind: 'image' as const, mediaRef: 'media', fileName: 'image.png', mimeType: 'image/png', size: 1, sortOrder: 0 }
    store.setExtensionTarget(key, { ...parent, textContent: '长'.repeat(20_000),
      contentBlocks: Array.from({ length: 20 }, () => ({ ...block, originalRef: 'unused-original' })),
      locationCapture: { ignored: 'not a preview' } as never,
    })
    const restored = new ArkmeComposerDraftStore(storage).get(key).extensionTarget!.item
    expect(restored.textContent).toHaveLength(2_000)
    expect(restored.contentBlocks).toHaveLength(3)
    expect(restored.contentBlocks![0]).not.toHaveProperty('originalRef')
    expect(restored).not.toHaveProperty('locationCapture')
  })

  it('does not downgrade a corrupt persisted extension draft into an ordinary send', () => {
    const saved = JSON.stringify([[key, { text: '延展正文', attachments: [], mentions: [], emojis: [],
      extensionTarget: { item: { ...parent, messageActionRef: '' } } }]])
    const restored = new ArkmeComposerDraftStore({ getItem: () => saved, setItem: () => {} })
    expect(restored.get(key).text).toBe('')
  })

  it('keeps the parent in memory when browser persistence is unavailable', () => {
    const store = new ArkmeComposerDraftStore({ getItem: () => null, setItem: () => { throw new Error('quota') } })
    store.setExtensionTarget(key, parent); store.setText(key, '正文')
    expect(store.get(key)).toMatchObject({ text: '正文', extensionTarget: { item: parent } })
  })
})
