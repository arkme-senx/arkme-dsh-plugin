import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), recommendation: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (operation: string, ...args: unknown[]) => operation === 'recordings.speaker.cached-options' ? Promise.resolve(null) : operation === 'recordings.speaker.recommendation' ? mocks.recommendation(...args) : mocks.callArkme(operation, ...args), ArkmeClientError: class extends Error {} }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'
import { recordingSpeakerOptions, recordingSpeakerItemContexts } from '../src/client/recordings/recording-speaker-options-store.js'

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const item: ArkmeRecordingWorkbenchItem = {
  itemId: 'item-a', itemRef: 'item-ref-a', speakerLabel: '说话人 1', speakerColorIndex: 1,
  speakerNumber: 1, speakerKey: 'transcript-speaker', sameSpeakerItemCount: 1,
  text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
}
const options: ArkmeRecordingSpeakerOption[] = [
  { optionKey: 'voiceprint', speakerRef: 'voiceprint-ref', label: '同名', kind: 'speaker', recommended: false, currentAssignment: false, isCurrentUser: false },
  { optionKey: 'user', speakerRef: 'user-ref', label: '同名', kind: 'arkme-user', recommended: false, currentAssignment: false, isCurrentUser: false },
]

describe('speaker cache interaction and lifecycle', () => {
  let renderer: ReactTestRenderer
  let onUpdated: ReturnType<typeof vi.fn>
  let onClose: ReturnType<typeof vi.fn>
  const open = async (target = item) => {
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={target} onUpdated={onUpdated} onClose={onClose} />)
      await tick()
    })
  }
  const chooseUser = async () => {
    const row = renderer.root.findAll(node => node.type === 'button' && node.findAll(child => child.type === 'span' && child.children.includes('同名')).length > 0)[1]!
    await act(async () => { row.props.onClick(); await tick() })
  }
  const confirm = () => renderer.root.findAll(node => node.type === 'button' && node.children.join('') === '确认')[0]!
  beforeEach(() => {
    mocks.recommendation.mockReset().mockResolvedValue({})
    recordingSpeakerOptions.reset()
    recordingSpeakerItemContexts.reset()
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    mocks.callArkme.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.speaker.options') return options
      throw new Error('unexpected operation')
    })
    onUpdated = vi.fn(); onClose = vi.fn()
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    recordingSpeakerOptions.reset()
    recordingSpeakerItemContexts.reset()
    vi.unstubAllGlobals()
  })

  it('submits a cached candidate without waiting for refresh and separates same-name targets', async () => {
    await open()
    await act(async () => { renderer.unmount(); await tick() })
    const refresh = deferred<ArkmeRecordingSpeakerOption[]>()
    const write = deferred<unknown>()
    let readSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementation((operation, _input, signal) => {
      if (operation === 'recordings.speaker.options') { readSignal = signal; return refresh.promise }
      return write.promise
    })
    await open(); await chooseUser()
    const originalReadSignal = readSignal
    expect(confirm().props.disabled).toBe(false)
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.speaker.assign-item', {
      itemRef: item.itemRef, scope: 'item', speakerRef: 'user-ref',
    }, expect.any(AbortSignal))
    expect(readSignal?.aborted).toBe(false)
    await act(async () => { write.resolve({ day: { dateStamp: 1 } }); refresh.resolve(options); await tick() })
    expect(onUpdated).toHaveBeenCalledOnce()
    expect(originalReadSignal?.aborted).toBe(true)
  })

  it('shows the shared directory and the new item assignment while recommendation is pending', async () => {
    await open({ ...item, assignedSpeakerOptionKey: 'voiceprint' })
    await act(async () => { renderer.unmount(); await tick() })
    const recommendation = deferred<{ optionKey?: string }>()
    mocks.recommendation.mockReturnValue(recommendation.promise)
    const refresh = deferred<ArkmeRecordingSpeakerOption[]>()
    mocks.callArkme.mockImplementation(operation => operation === 'recordings.speaker.options' ? refresh.promise : Promise.resolve({ day: { dateStamp: 1 } }))
    await open({ ...item, itemRef: 'another-item', assignedSpeakerOptionKey: 'user' })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
    expect(confirm().props.disabled).toBe(true)
    const voiceprint = renderer.root.findAll(node => node.type === 'button' && node.findAll(child => child.type === 'span' && child.children.includes('同名')).length > 0)[0]!
    await act(async () => { voiceprint.props.onClick(); await tick() })
    expect(confirm().props.disabled).toBe(false)
    await act(async () => { recommendation.resolve({ optionKey: 'user' }); await tick() })
    expect(confirm().props.disabled).toBe(false)
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.speaker.assign-item', {
      itemRef: 'another-item', scope: 'item', speakerRef: 'voiceprint-ref',
    }, expect.any(AbortSignal))
    await act(async () => { refresh.resolve(options); await tick() })
  })

  it('does not let a failed recommendation hide candidates or block saving', async () => {
    mocks.recommendation.mockRejectedValue(new Error('推荐服务超时'))
    await open(); await chooseUser()
    expect(confirm().props.disabled).toBe(false)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('推荐服务超时')
    mocks.callArkme.mockImplementation(async operation => operation === 'recordings.speaker.options' ? options : { day: { dateStamp: 1 } })
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(onUpdated).toHaveBeenCalledOnce()
  })

  it('does not apply a saved day after the editor unmounts', async () => {
    await open(); await chooseUser()
    const write = deferred<unknown>()
    mocks.callArkme.mockImplementation(operation => operation === 'recordings.speaker.assign-item' ? write.promise : Promise.resolve(options))
    await act(async () => { confirm().props.onClick(); await tick() })
    await act(async () => { renderer.unmount(); await tick() })
    await act(async () => { write.resolve({ day: { dateStamp: 1 } }); await tick() })
    expect(onUpdated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('ignores a late save %s after switching accounts and back', async finish => {
    await open(); await chooseUser()
    const write = deferred<unknown>()
    mocks.callArkme.mockImplementation(operation => operation === 'recordings.speaker.assign-item' ? write.promise : Promise.resolve(options))
    await act(async () => { confirm().props.onClick(); await tick() })
    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      if (finish === 'resolve') write.resolve({ day: { dateStamp: 1 } })
      else write.reject(new Error('旧账号保存失败'))
      await tick()
    })
    expect(onUpdated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).not.toContain('旧账号保存失败')
    expect(JSON.stringify(renderer.toJSON())).toContain('同名')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
  })

  it('does not apply a saved day if auth changes during post-save reconciliation', async () => {
    await open(); await chooseUser()
    let changed = false
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.speaker.assign-item') return { day: { dateStamp: 1 } }
      if (!changed) {
        changed = true
        arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
        arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      }
      return options
    })
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(changed).toBe(true)
    expect(onUpdated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('同名')
  })

  it('recovers visible candidates and ignores a late save after a Provider restart', async () => {
    const { reconcileArkmeProviderInstance } = await import('../src/client/provider-instance-runtime.js')
    let instanceId = 'speaker-cache-provider-a'
    const write = deferred<unknown>()
    let writeSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementation((operation, _input, signal) => {
      if (operation === 'provider.instance') return Promise.resolve({ instanceId })
      if (operation === 'recordings.speaker.assign-item') { writeSignal = signal; return write.promise }
      return Promise.resolve(options)
    })
    await reconcileArkmeProviderInstance()
    await open(); await chooseUser()
    await act(async () => { confirm().props.onClick(); await tick() })
    instanceId = 'speaker-cache-provider-b'
    await act(async () => { await reconcileArkmeProviderInstance(); await tick() })
    expect(writeSignal?.aborted).toBe(true)
    await act(async () => { write.resolve({ day: { dateStamp: 1 } }); await tick() })
    expect(onUpdated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('同名')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
  })

  it('keeps the newly opened item usable when an old item save completes', async () => {
    await open(); await chooseUser()
    const write = deferred<unknown>()
    mocks.callArkme.mockImplementation(operation => operation === 'recordings.speaker.assign-item' ? write.promise : Promise.resolve(options))
    await act(async () => { confirm().props.onClick(); await tick() })
    await act(async () => {
      renderer.update(<ArkmeRecordingSpeakerEditor item={{ ...item, itemId: 'b', itemRef: 'b-ref' }} onUpdated={onUpdated} onClose={onClose} />)
      await tick()
    })
    await act(async () => { write.resolve({ day: { dateStamp: 1 } }); await tick() })
    expect(onUpdated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('同名')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
  })

  it.each([
    { force: false, batch: false, scope: 'item' },
    { force: false, batch: true, scope: 'speaker' },
    { force: true, batch: false, scope: 'speaker' },
  ])('submits the intended assignment scope: %j', async scenario => {
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{ ...item, sameSpeakerItemCount: 3 }} forceBatchUpdate={scenario.force} onUpdated={onUpdated} onClose={onClose} />)
      await tick()
    })
    await chooseUser()
    if (scenario.batch) await act(async () => {
      renderer.root.findByProps({ 'aria-label': '批量修改' }).props.onChange({ target: { checked: true } })
      await tick()
    })
    mocks.callArkme.mockImplementation(async operation => operation === 'recordings.speaker.assign-item' ? { day: { dateStamp: 1 } } : options)
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.speaker.assign-item', {
      itemRef: item.itemRef, scope: scenario.scope, speakerRef: 'user-ref',
    }, expect.any(AbortSignal))
  })

  it.each([{ initialOptions: [] }, { initialOptions: options }])('allows a trimmed new name with $initialOptions candidates without mixing references', async ({ initialOptions }) => {
    mocks.callArkme.mockResolvedValueOnce(initialOptions)
    await open()
    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取候选')
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '说话人名称' }).props.onChange({ target: { value: '  新说话人  ' } })
      await tick()
    })
    mocks.callArkme.mockImplementation(async operation => operation === 'recordings.speaker.assign-item' ? { day: { dateStamp: 1 } } : options)
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.speaker.assign-item', {
      itemRef: item.itemRef, scope: 'item', newSpeakerName: '新说话人',
    }, expect.any(AbortSignal))
  })

  it('requires a new selection if the chosen candidate disappears during refresh', async () => {
    await open()
    await act(async () => { renderer.unmount(); await tick() })
    const response = deferred<ArkmeRecordingSpeakerOption[]>()
    mocks.callArkme.mockReturnValueOnce(response.promise)
    await open(); await chooseUser()
    await act(async () => { response.resolve([options[0]!]); await tick() })
    expect(confirm().props.disabled).toBe(true)
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item')).toHaveLength(0)
  })

  it('re-reads candidates after a partial write failure and never auto-retries the command', async () => {
    await open(); await chooseUser()
    const read = deferred<ArkmeRecordingSpeakerOption[]>()
    mocks.callArkme.mockImplementation(operation => operation === 'recordings.speaker.assign-item'
      ? Promise.reject(new Error('分配失败')) : read.promise)
    await act(async () => { confirm().props.onClick(); await tick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('分配失败')
    expect(confirm().props.disabled).toBe(true)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item')).toHaveLength(1)
    await act(async () => { read.resolve(options); await tick() })
    expect(confirm().props.disabled).toBe(false)
  })
})
