import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

const item: ArkmeRecordingWorkbenchItem = { itemId: 'item', itemRef: 'sealed', transcriptSource: 'system', sessionKey: 'session',
  speakerLabel: '万宇', assignedSpeakerOptionKey: 'assigned', speakerColorIndex: 1, speakerNumber: 1, speakerKey: 'speaker',
  sameSpeakerItemCount: 3, text: '内容', startAtMillis: 1000, endAtMillis: 2000, isBackground: false, isSelf: false }
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
describe('speaker removal interaction', () => {
  let renderer: ReactTestRenderer
  const onClose = vi.fn(), onUpdated = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    onClose.mockReset(); onUpdated.mockReset()
    mocks.call.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.speaker.cached-options') return null
      if (operation === 'recordings.speaker.options') return []
      if (operation === 'recordings.speaker.recommendation') return {}
      return { scope: 'item', affectedCount: 1, day: { dateStamp: 1 } }
    })
  })
  afterEach(async () => { await act(async () => { renderer?.unmount(); await tick() }); vi.unstubAllGlobals() })
  const open = async (value = item, forceBatchUpdate = false) => {
    await act(async () => { renderer = create(<ArkmeRecordingSpeakerEditor item={value} forceBatchUpdate={forceBatchUpdate} onUpdated={onUpdated} onClose={onClose} />); await tick() })
  }
  const remove = () => renderer.root.findByProps({ 'aria-label': '取消说话人标记' })

  it('pins a one-click removal even when the assigned person is missing from candidate results', async () => {
    await open()
    expect(remove().children).toEqual(['取消标记'])
    await act(async () => { remove().props.onClick(); await tick() })
    expect(mocks.call).toHaveBeenCalledWith('recordings.speaker.unassign-item', { itemRef: 'sealed', scope: 'item', expectedCount: 1 }, expect.any(AbortSignal))
    expect(onUpdated).toHaveBeenCalledWith({ dateStamp: 1 }, { itemId: 'item', scope: 'item', count: 1 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([false, true])('shows the exact bulk count and uses that scope (timeline=%s)', async forced => {
    await open(item, forced)
    if (!forced) await act(async () => { renderer.root.findByProps({ 'aria-label': '批量修改' }).props.onChange({ target: { checked: true } }); await tick() })
    expect(remove().children.join('')).toBe('取消 3 处标记')
    await act(async () => { remove().props.onClick(); await tick() })
    expect(mocks.call).toHaveBeenCalledWith('recordings.speaker.unassign-item', { itemRef: 'sealed', scope: 'speaker', expectedCount: 3 }, expect.any(AbortSignal))
  })

  it('keeps the dialog and error on failure, and never sends duplicate writes', async () => {
    await open()
    let reject!: (error: Error) => void
    mocks.call.mockImplementation(operation => operation === 'recordings.speaker.unassign-item'
      ? new Promise((_resolve, fail) => { reject = fail }) : Promise.resolve([]))
    await act(async () => { const click = remove().props.onClick; click(); click(); await tick() })
    expect(remove().props.disabled).toBe(true)
    await act(async () => { reject(new Error('取消失败')); await tick() })
    expect(mocks.call.mock.calls.filter(([op]) => op === 'recordings.speaker.unassign-item')).toHaveLength(1)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('取消失败')
    expect(onClose).not.toHaveBeenCalled()
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('refreshes partial results while retaining the conflict warning', async () => {
    await open()
    mocks.call.mockImplementation(async operation => operation === 'recordings.speaker.unassign-item'
      ? { day: { dateStamp: 1 }, warning: '标记已变化' } : [])
    await act(async () => { remove().props.onClick(); await tick() })
    expect(onUpdated).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['标记已变化'])
  })

  it('does not offer removal for an unmarked system speaker', async () => {
    const { assignedSpeakerOptionKey: _assignment, ...unmarked } = item
    await open(unmarked)
    expect(renderer.root.findAllByProps({ 'aria-label': '取消说话人标记' })).toHaveLength(0)
  })
})
