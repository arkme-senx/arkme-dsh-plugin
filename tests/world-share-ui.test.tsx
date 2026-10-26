import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeWorldShareActions } from '../src/client/ArkmeWorldShareActions.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'
import type { ArkmeWorldFeedItem, ArkmeWorldShareResult } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), copy: vi.fn(), forward: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => mock.call(...args) }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: (...args: unknown[]) => mock.copy(...args) }))
vi.mock('../src/client/local-snapshot-forward.js', () => ({ openLocalSnapshotForward: (...args: unknown[]) => mock.forward(...args) }))
const item: ArkmeWorldFeedItem = { recordRef: 'world-ref', authorName: '作者', headline: '', textContent: '内容', imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, tags: [], extendCount: 0, templateKind: 0, createdAtMillis: 1, publishedAtMillis: 1 }
const share: ArkmeWorldShareResult = { url: 'https://app-test.arkme.ai/shijie/author_7/record/record-1', title: '公开动态', previewText: '公开正文' }
let ui: ReactTestRenderer | undefined
beforeEach(() => { vi.clearAllMocks(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }); mock.call.mockResolvedValue(share); mock.copy.mockResolvedValue(undefined); mock.forward.mockResolvedValue({ completed: false }) })
afterEach(async () => { await act(async () => { ui?.unmount() }); ui = undefined })
async function mount() { await act(async () => { ui = create(<ArkmeWorldShareActions item={item} />) }) }
async function action(id: string) { await act(async () => { ui!.root.findByType(ArkmeActionMenu).props.actions.find((entry: { id: string }) => entry.id === id).onSelect() }) }
describe('World share action menu', () => {
  it('opens without network requests and copies the server-verified public URL', async () => {
    await mount()
    await act(async () => { ui!.root.findByProps({ 'aria-label': '分享' }).props.onClick() })
    expect(mock.call).not.toHaveBeenCalled()
    expect(ui!.root.findByType(ArkmeActionMenu).props.actions.map((value: { label: string }) => value.label)).toEqual(['复制链接', '转发'])
    await action('copy')
    expect(mock.call).toHaveBeenCalledWith('world.share', { recordRef: 'world-ref', expectedUserId: 42 }, expect.any(AbortSignal))
    expect(mock.copy).toHaveBeenCalledWith(share.url)
    expect(JSON.stringify(ui!.toJSON())).toContain('已复制链接')
  })
  it('uses the common picker and keeps a stable send identity when retrying a target', async () => {
    await mount()
    let sends = 0
    mock.call.mockImplementation(async (operation: string) => {
      if (operation === 'world.share') return share
      if (++sends === 1) throw new Error('网络中断')
      return { localState: 'synced', itemUid: 'sent' }
    })
    mock.forward.mockImplementation(async (content, signal) => {
      const target = { sourceRef: 'selected', sourceKey: 'selected', kind: 'private_chat', peerUserId: 7 }
      await expect(content.delivery.send(target, '附言', signal)).rejects.toThrow('网络中断')
      await content.delivery.send(target, '附言', signal)
      await content.delivery.send(target, '附言', signal)
      return { completed: true }
    })
    await action('forward')
    const writes = mock.call.mock.calls.filter(([operation]) => operation === 'world.forward')
    expect(writes).toHaveLength(2)
    expect(writes[0]![1].recordUid).toBe(writes[1]![1].recordUid)
    expect(writes[0]![1]).toMatchObject({ expectedUserId: 42, recordRef: item.recordRef, targetSourceRef: 'selected', commentText: '附言' })
    expect(JSON.stringify(ui!.toJSON())).toContain('已转发')
  })
  it('does not copy after an account switch or report success after a rejected publication', async () => {
    let resolve!: (value: ArkmeWorldShareResult) => void
    mock.call.mockImplementation(() => new Promise(done => { resolve = done }))
    await mount(); await action('copy')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 }); resolve(share) })
    expect(mock.copy).not.toHaveBeenCalled()
    mock.call.mockRejectedValue(new Error('这条内容已不可公开分享，请刷新世界'))
    await action('copy')
    expect(mock.copy).not.toHaveBeenCalled()
    expect(JSON.stringify(ui!.toJSON())).toContain('这条内容已不可公开分享')
  })
})
