import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { arkmeAuthStore } from '../src/client/auth-store.js'
import { usePersonalNoteDetail } from '../src/client/use-personal-note-detail.js'

const preview: ArkmeTimelineItem = {
  itemUid: 'note', senderName: '我', isMe: true, sendAtMillis: 1, title: '', textContent: '列表正文', status: 1,
  recordVersion: 2, version: 2, messageActionRef: 'topic-action', updateAtMillis: 0,
  selfTopic: { topicHierarchyKey: 'topic', title: '待落实需求', sourceRef: 'topic-source' },
}
const canonical: ArkmeTimelineItem = {
  ...preview, messageActionRef: undefined, selfTopic: undefined,
  hasManualEdit: true, textContent: '完整正文', updateAtMillis: 100,
}

describe('personal note details use the Record owner instead of a list projection', () => {
  let renderer: ReactTestRenderer | undefined
  let detail: ReturnType<typeof usePersonalNoteDetail>
  type Props = { item?: ArkmeTimelineItem; enabled?: boolean; sourceKey?: string; revision?: number }
  function Harness({ item = preview, enabled = true, sourceKey = 'topic-source', revision = 0 }: Props) {
    detail = usePersonalNoteDetail(item, enabled, sourceKey, revision)
    return null
  }
  async function render(props: Props = {}) {
    await act(async () => {
      if (renderer) renderer.update(<Harness {...props} />)
      else renderer = create(<Harness {...props} />)
    })
  }
  beforeEach(() => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 11 })
    mocks.callArkme.mockReset().mockResolvedValue(canonical)
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined })

  it('fills missing edit metadata and fresh content while retaining the topic-bound actions', async () => {
    await render()
    expect(mocks.callArkme).toHaveBeenCalledExactlyOnceWith('record.app.detail', { recordUid: 'note' }, expect.any(AbortSignal))
    expect(detail.item).toMatchObject({ textContent: '完整正文', hasManualEdit: true, updateAtMillis: 100,
      messageActionRef: 'topic-action', selfTopic: preview.selfTopic })
    expect(detail.loading).toBe(false)
    expect(detail.error).toBeUndefined()
  })

  it('refreshes the same note for another entry point and after a committed edit invalidation', async () => {
    await render()
    await render({ sourceKey: 'all-source' })
    mocks.callArkme.mockResolvedValue({ ...canonical, textContent: '再次编辑', recordVersion: 3, version: 3 })
    await render({ sourceKey: 'all-source', revision: 1 })
    expect(mocks.callArkme).toHaveBeenCalledTimes(3)
    expect(detail.item).toMatchObject({ textContent: '再次编辑', hasManualEdit: true, recordVersion: 3 })
  })

  it('does not refetch because a refreshed list produced another object with the same version', async () => {
    await render()
    await render({ item: { ...preview } })
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
  })

  it('keeps preview content and exposes retry on a failed read', async () => {
    mocks.callArkme.mockRejectedValueOnce(new Error('读取失败'))
    await render()
    expect(detail.item).toBe(preview)
    expect(detail.error).toBe('读取失败')
    await act(async () => { detail.retry() })
    expect(detail.item?.hasManualEdit).toBe(true)
    expect(detail.error).toBeUndefined()
  })

  it.each([
    { ...canonical, itemUid: 'another-note' },
    { ...canonical, recordVersion: 1, version: 1 },
    { ...canonical, status: 0 },
  ])('rejects an unrelated, stale or inaccessible response: %j', async response => {
    mocks.callArkme.mockResolvedValue(response)
    await render()
    expect(detail.item).toBe(preview)
    expect(detail.error).toBeTruthy()
  })

  it('does not infer a manual edit from a higher content version', async () => {
    mocks.callArkme.mockResolvedValue({ ...canonical, hasManualEdit: undefined, recordVersion: 9 })
    await render()
    expect(detail.item?.hasManualEdit).toBeUndefined()
  })

  it('discards a cancelled response after selecting a different note', async () => {
    let resolve!: (value: ArkmeTimelineItem) => void
    let signal!: AbortSignal
    mocks.callArkme.mockImplementationOnce((_op, _params, inputSignal) => {
      signal = inputSignal
      return new Promise(done => { resolve = done })
    })
    await render()
    expect(detail.loading).toBe(true)
    mocks.callArkme.mockResolvedValue({ ...canonical, itemUid: 'next-note', textContent: '另一条正文' })
    await render({ item: { ...preview, itemUid: 'next-note' } })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve(canonical) })
    expect(detail.item).toMatchObject({ itemUid: 'next-note', textContent: '另一条正文' })
  })

  it('clears the previous account detail and cancels its pending read when accounts change', async () => {
    let resolve!: (value: ArkmeTimelineItem) => void
    let signal!: AbortSignal
    mocks.callArkme.mockImplementationOnce((_op, _params, inputSignal) => {
      signal = inputSignal
      return new Promise(done => { resolve = done })
    })
    await render()
    mocks.callArkme.mockResolvedValue({ ...canonical, textContent: '新账号正文', hasManualEdit: false })
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 12 }) })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve(canonical) })
    expect(detail.item).toMatchObject({ textContent: '新账号正文', hasManualEdit: false })
  })

  it('cancels reads when the detail closes and does not read when disabled', async () => {
    let signal!: AbortSignal
    mocks.callArkme.mockImplementation((_op, _params, inputSignal) => {
      signal = inputSignal
      return new Promise(() => {})
    })
    await render({ enabled: false })
    expect(mocks.callArkme).not.toHaveBeenCalled()
    await render()
    await render({ enabled: false })
    expect(signal.aborted).toBe(true)
    expect(detail.item).toBe(preview)
    expect(detail.loading).toBe(false)
  })
})
