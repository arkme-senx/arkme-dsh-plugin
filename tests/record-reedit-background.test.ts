import { describe, expect, it, vi } from 'vitest'
import { RecordReeditAcceptanceUnknown, RecordReeditBackgroundQueue } from '../src/client/record-reedit-background.js'
import type { ArkmeRecordReeditSubmissionView } from '../src/record-reedit-contract.js'

const view: ArkmeRecordReeditSubmissionView = { submissionId: 'local-1', itemUid: 'A', baseVersion: 3,
  state: 'pending', title: '', textContent: '点击发送时的修改', attachments: [] }
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }

describe('background re-edit preparation', () => {
  it('publishes immediately, survives conversation changes, and hands off only after a matching Host receipt', async () => {
    const queue = new RecordReeditBackgroundQueue()
    let finish!: (value: ArkmeRecordReeditSubmissionView) => void
    const run = vi.fn(() => new Promise<ArkmeRecordReeditSubmissionView>(resolve => { finish = resolve }))
    const failed = vi.fn()
    expect(queue.start({ accountKey: 'test:42', sourceKey: 'topic', view, run, failed })).toBe(true)
    expect(queue.views('test:42', 'topic')).toEqual([view])
    expect(run).not.toHaveBeenCalled()
    expect(queue.views('test:43', 'topic')).toEqual([])
    expect(queue.views('test:42', 'another')).toEqual([])
    expect(queue.start({ accountKey: 'test:42', sourceKey: 'all', view, run, failed })).toBe(false)
    await flush()
    const accepted = { ...view, submissionId: 'host-1' }
    finish(accepted); await flush()
    queue.observe('test:42', 'topic', [{ ...accepted, submissionId: 'older-host-receipt' }])
    expect(queue.views('test:42', 'topic')).toEqual([accepted])
    queue.observe('test:42', 'topic', [accepted])
    expect(queue.views('test:42', 'topic')).toEqual([])
    expect(failed).not.toHaveBeenCalled()
  })
  it('preserves failures and reload recovery without automatically resubmitting', async () => {
    const journal = storage()
    const queue = new RecordReeditBackgroundQueue(journal)
    const failed = vi.fn()
    queue.start({ accountKey: 'test:42', sourceKey: 'all', view, run: async () => { throw new Error('网络中断') }, failed })
    await flush()
    expect(queue.views('test:42', 'all')[0]).toMatchObject({ state: 'failed', textContent: view.textContent, error: '网络中断' })
    expect(failed).toHaveBeenCalledOnce()
    const restored = new RecordReeditBackgroundQueue(journal)
    expect(restored.recovery('test:42', 'A')).toMatchObject({ textContent: view.textContent, state: 'failed' })
    expect(restored.recovery('test:43', 'A')).toBeUndefined()
    restored.forgetFailed('test:42', 'A')
    expect(restored.views('test:42', 'all')).toEqual([])
  })
  it('backs up text before slow preparation and removes the backup after durable acceptance', async () => {
    const journal = storage()
    const queue = new RecordReeditBackgroundQueue(journal)
    let finish!: (value: ArkmeRecordReeditSubmissionView) => void
    queue.start({ accountKey: 'test:42', sourceKey: 'all', view, run: () => new Promise(resolve => { finish = resolve }), failed: vi.fn() })
    await flush()
    const restored = new RecordReeditBackgroundQueue(journal)
    expect(restored.views('test:42', 'all')[0]).toMatchObject({ state: 'uncertain', textContent: view.textContent })
    restored.observe('test:42', 'all', [], true)
    expect(restored.recovery('test:42', 'A')?.textContent).toBe(view.textContent)
    finish({ ...view, submissionId: 'host' }); await flush()
    expect(new RecordReeditBackgroundQueue(journal).views('test:42', 'all')).toEqual([])
  })
  it('keeps edits recoverable if local persistence fails and never starts a write', async () => {
    const queue = new RecordReeditBackgroundQueue({ getItem: () => null, setItem: () => { throw new Error('磁盘已满') } })
    const run = vi.fn(), failed = vi.fn()
    queue.start({ accountKey: 'test:42', sourceKey: 'all', view, run, failed })
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(queue.recovery('test:42', 'A')?.textContent).toBe(view.textContent)
    expect(failed).toHaveBeenCalledOnce()
  })
  it('holds an unknown acceptance until a matching receipt or explicit reconciliation arrives', async () => {
    const queue = new RecordReeditBackgroundQueue()
    queue.start({ accountKey: 'test:42', sourceKey: 'all', view,
      run: async () => { throw new RecordReeditAcceptanceUnknown('连接中断') }, failed: vi.fn() })
    await flush()
    expect(queue.views('test:42', 'all')[0]?.state).toBe('uncertain')
    expect(queue.pending('test:42', 'A')).toBe(true)
    queue.observe('test:42', 'all', [])
    expect(queue.recovery('test:42', 'A')).toBeUndefined()
    queue.observe('test:42', 'all', [{ ...view, submissionId: 'host-confirmed' }])
    expect(queue.views('test:42', 'all')).toEqual([])
  })
})
