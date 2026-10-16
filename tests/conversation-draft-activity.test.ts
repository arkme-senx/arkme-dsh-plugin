import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { ArkmeComposerDraftStore, arkmeDraftEditedAtMillis, arkmeSourceComposerDraftKey as draftKey } from '../src/client/composer-draft-store.js'
import { selfConversationDraftPreview, withConversationDraftActivity } from '../src/client/conversation-draft-preview.js'
import { connectConversationDrafts } from '../src/client/conversation-window-sync.js'

afterEach(() => { vi.restoreAllMocks() })
const source = (id: string, time: number, kind: ArkmeSourceItem['kind'] = 'private_chat'): ArkmeSourceItem => ({
  kind, sourceRef: id, sourceKey: id, displayName: id, activeAtMillis: time,
})
const older = source('older', 1000), newer = source('newer', 2000), pinned = source('pinned', 500)
const key = draftKey(42, older)!
const markdown = { source: '待处理', mentions: [], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '待处理' }] }] } }
const rows = [newer, older, pinned].map(source => ({ source, activeAtMillis: source.activeAtMillis, pinned: source === pinned }))
const localFile = { fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', fileName: 'one.txt', mimeType: 'text/plain', size: 1, fileKind: 4 as const }

describe('draft edit time', () => {
  it('records genuine content edits, not repeated projections, reads or file-send bookkeeping', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const store = new ArkmeComposerDraftStore()
    store.setMarkdown(key, markdown, '待处理', [], [])
    expect(store.get(key).editedAtMillis).toBe(3000)
    now.mockReturnValue(4000)
    store.setMarkdown(key, structuredClone(markdown), '待处理', [], [])
    store.beginFileSend(key)
    expect(store.get(key).editedAtMillis).toBe(3000)
    store.appendAttachments(key, [{ localFile }])
    expect(store.get(key).editedAtMillis).toBe(4000)
    now.mockReturnValue(5000)
    store.removeAttachment(key, localFile.fileRef)
    expect(store.get(key).editedAtMillis).toBe(5000)
  })

  it('persists the original timestamp across refresh instead of using hydration time', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    let saved = ''
    const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value } }
    const store = new ArkmeComposerDraftStore(storage)
    store.setMarkdown(key, markdown, '待处理', [], [])
    store.markConversationLeft(key, 4500)
    now.mockReturnValue(9000)
    const restored = new ArkmeComposerDraftStore(storage)
    expect(restored.get(key).editedAtMillis).toBe(3000)
    expect(restored.get(key).leftAtMillis).toBe(4500)
    expect(withConversationDraftActivity(rows, restored, 42).map(row => row.source.sourceRef)).toEqual(['pinned', 'older', 'newer'])
    restored.setMarkdown(key, structuredClone(markdown), '待处理', [], [])
    expect(restored.get(key).editedAtMillis).toBe(3000)
  })

  it('keeps legacy drafts undated until a real edit, and ignores malformed timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    const legacy = { text: '待处理', markdown, attachments: [], mentions: [], emojis: [] }
    const store = new ArkmeComposerDraftStore({ getItem: () => JSON.stringify([[key, legacy]]), setItem: () => {} })
    expect(store.get(key).editedAtMillis).toBeUndefined()
    store.setMarkdown(key, structuredClone(markdown), '待处理', [], [])
    expect(store.get(key).editedAtMillis).toBeUndefined()
    expect(withConversationDraftActivity(rows, store, 42).map(row => row.source.sourceRef)).toEqual(['pinned', 'newer', 'older'])
    store.setText(key, '真正的新编辑')
    expect(store.get(key).editedAtMillis).toBe(5000)
    for (const editedAtMillis of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) {
      store.applyRemote(key, { ...legacy, editedAtMillis })
      expect(arkmeDraftEditedAtMillis(store.get(key))).toBe(0)
    }
  })

  it('preserves the submitted time on failure and the newer edit time when merging concurrent input', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const store = new ArkmeComposerDraftStore()
    store.setText(key, '提交内容')
    const sent = store.take(key)
    now.mockReturnValue(6000)
    store.restore(key, sent)
    expect(store.get(key).editedAtMillis).toBe(3000)
    const retry = store.take(key)
    store.setText(key, '发送期间的新内容')
    now.mockReturnValue(9000)
    store.restore(key, retry)
    expect(store.get(key)).toMatchObject({ text: '发送期间的新内容', editedAtMillis: 6000 })
  })

  it('transports the original edit time through the desktop bridge and does not restamp snapshots', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    let snapshot: any[] = []
    const bridge: any = { snapshot: async () => snapshot, onEvent: () => () => {}, publish: vi.fn(async (event: any) => { snapshot = [event] }) }
    const first = new ArkmeComposerDraftStore()
    const stop = await connectConversationDrafts(bridge, first, 42, 'test:42')
    first.setText(key, '跨窗口草稿')
    stop()
    expect(snapshot[0].value.editedAtMillis).toBe(3000)
    now.mockReturnValue(9000)
    const second = new ArkmeComposerDraftStore()
    const stopSecond = await connectConversationDrafts(bridge, second, 42, 'test:42')
    expect(second.get(key).editedAtMillis).toBe(3000)
    expect(bridge.publish).toHaveBeenCalledTimes(1)
    stopSecond()
  })
})

describe('conversation activity ordering', () => {
  it('uses the later of departure and message times, preserves pins, and never mutates source truth', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const store = new ArkmeComposerDraftStore()
    store.setText(key, '未发送')
    store.markConversationLeft(key, 3000)
    const sorted = withConversationDraftActivity(rows, store, 42)
    expect(sorted.map(row => row.source.sourceRef)).toEqual(['pinned', 'older', 'newer'])
    expect(sorted[1]!.activeAtMillis).toBe(3000)
    expect(older.activeAtMillis).toBe(1000)
    expect(rows[1]!.activeAtMillis).toBe(1000)
    now.mockReturnValue(1500)
    store.setText(key, '更早的草稿')
    store.markConversationLeft(key, 1500)
    expect(withConversationDraftActivity(rows, store, 42).map(row => row.source.sourceRef)).toEqual(['pinned', 'newer', 'older'])
    expect(withConversationDraftActivity(rows, store, 43).map(row => row.source.sourceRef)).toEqual(['pinned', 'newer', 'older'])
  })

  it('restores normal ordering when cleared or consumed, including attachment-only drafts', () => {
    vi.spyOn(Date, 'now').mockReturnValue(3000)
    const store = new ArkmeComposerDraftStore()
    store.appendAttachments(key, [{ localFile }])
    store.markConversationLeft(key, 3000)
    expect(withConversationDraftActivity(rows, store, 42)[1]!.source).toBe(older)
    store.removeAttachment(key, localFile.fileRef)
    expect(withConversationDraftActivity(rows, store, 42)[1]!.source).toBe(newer)
    store.setText(key, '发送'); store.take(key)
    expect(withConversationDraftActivity(rows, store, 42)[1]!.source).toBe(newer)
  })

  it('chooses the newest self-topic by saved edit time, not replay order', () => {
    const store = new ArkmeComposerDraftStore()
    const a = source('主题A', 1, 'topic'), b = source('主题B', 1, 'topic')
    store.applyRemote(draftKey(42, a)!, { text: '新草稿', attachments: [], mentions: [], emojis: [], editedAtMillis: 3000 })
    store.applyRemote(draftKey(42, b)!, { text: '晚恢复的旧草稿', attachments: [], mentions: [], emojis: [], editedAtMillis: 1000 })
    expect(selfConversationDraftPreview(store, 42, [a, b])).toMatchObject({ source: a, activityAtMillis: 3000, preview: '主题A · 新草稿' })
  })
})
