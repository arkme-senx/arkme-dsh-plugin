import { createRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicRecordingImportCurrentItem, PublicRecordingImportJob } from '../src/recording-import-shared.js'
import { toPublicRecordingImportJob } from '../src/recording-import-contract.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), uploadArkmeRecording: vi.fn(), inspectArkmeRecordingSelection: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme, uploadArkmeRecording: mocks.uploadArkmeRecording }))
vi.mock('../src/client/recordings/recording-import-selection.js', () => ({ inspectArkmeRecordingSelection: mocks.inspectArkmeRecordingSelection }))

import { ArkmeRecordingImportDialog, ArkmeRecordingImportTrigger, type ArkmeRecordingImportDialogHandle, type RecordingImportButtonStatus } from '../src/client/recordings/ArkmeRecordingImportDialog.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const job = (phase: PublicRecordingImportJob['phase'], importRef = 'local'): PublicRecordingImportJob => toPublicRecordingImportJob({
  jobId: importRef, userId: 42, phase, revision: 1, belongUserId: 42, fileName: `${importRef}.m4a`,
  fileSize: 4, durationMillis: 1_000, startAtMillis: 1_725_000_000_000, mimeType: 'audio/mp4',
  sha256: 'a'.repeat(64), sourceHandle: '/private/test.upload', uploadedBytes: 2, createdAtMillis: 1, updatedAtMillis: 1,
  ...(phase === 'failed' ? { retryable: true } : {}),
}, importRef)

describe('recording import button feedback', () => {
  let renderer: ReactTestRenderer
  let items: PublicRecordingImportCurrentItem[]
  const handle = createRef<ArkmeRecordingImportDialogHandle>()
  const dialog = { open: false, showModal() { this.open = true }, close() { this.open = false }, focus() {} }

  function Surface({ account = 'one', foreground = true }: { account?: string; foreground?: boolean }) {
    const [feedback, setFeedback] = useState<{ account: string; status: RecordingImportButtonStatus }>()
    return <>
      <ArkmeRecordingImportTrigger status={feedback?.account === account ? feedback.status : 'idle'} onClick={() => handle.current?.open()} />
      <ArkmeRecordingImportDialog key={account} ref={handle} importPath="/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={account === 'one' ? 42 : 43} foreground={foreground} onAccepted={() => {}}
        onStatusChange={status => setFeedback(current => current?.account === account && current.status === status ? current : { account, status })} />
    </>
  }

  const trigger = () => renderer.root.findByType(ArkmeRecordingImportTrigger).findByType('button')
  const label = () => trigger().children.filter(child => typeof child === 'string').join('')
  const notice = () => renderer.root.findAllByProps({ 'data-arkme-recording-import-notice': true })
  const open = async () => { await act(async () => { trigger().props.onClick(); await tick() }) }
  const close = async () => { await act(async () => { renderer.root.findByProps({ 'aria-label': '关闭上传文件' }).props.onClick(); await tick() }) }
  const poll = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1_500); await tick() }) }

  beforeEach(async () => {
    vi.useFakeTimers()
    items = []
    dialog.open = false
    mocks.callArkme.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return { items, owner: { state: 'available' } }
      if (operation === 'recordings.import.preflight') return { duplicateFileNames: [] }
      if (operation === 'recordings.import.retry') { items = [job('uploading')]; return {} }
      throw new Error(String(operation))
    })
    mocks.uploadArkmeRecording.mockReset()
    mocks.inspectArkmeRecordingSelection.mockReset().mockResolvedValue({ ok: true, format: 'M4A', durationMillis: 1_000 })
    await act(async () => {
      renderer = create(<Surface />, { createNodeMock: element => element.type === 'dialog' ? dialog : null })
      await tick()
    })
  })

  afterEach(async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useRealTimers()
  })

  it('uses equal-width readable states and stays clickable through transfer and handoff', async () => {
    expect(label()).toBe('导入历史音频')
    const width = trigger().props.style.width
    expect(width).toBeGreaterThan(0)
    for (const [phase, expected] of [['prepared', '音频上传中'], ['uploading', '音频上传中'], ['finalizing', '正在完成导入'], ['accepted', '导入历史音频']] as const) {
      items = [job(phase)]
      await open()
      await poll()
      expect(label()).toBe(expected)
      expect(trigger().props.style.width).toBe(width)
      expect(trigger().props.disabled).not.toBe(true)
    }
  })

  it('does not show uploads for unsubmitted files, cancelled tasks, or Audio transcription', async () => {
    items = [job('cancelled'), {
      kind: 'owner', taskKey: 'owner', sessionRef: 'audio', ownership: 'self', fileName: 'cloud.m4a',
      fileSize: 4, parsedSize: 4, durationMillis: 1_000, startAtMillis: 1, endAtMillis: 1_001,
      progress: 1, status: 'transcribing', statusDetail: '转写中', createdAtMillis: 1, updatedAtMillis: 1,
    }]
    await open()
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.onChange({ target: { files: [new File(['data'], 'new.m4a')], value: '' } })
      await tick()
    })
    expect(label()).toBe('导入历史音频')
    await close()
    expect(notice()).toHaveLength(0)
  })

  it('shows owner-reported unfinished uploads without confusing later transcription failures with upload failures', async () => {
    const owner = {
      kind: 'owner' as const, taskKey: 'owner', sessionRef: 'audio', ownership: 'self' as const, fileName: 'cloud.m4a',
      fileSize: 4, parsedSize: 2, durationMillis: 1_000, startAtMillis: 1, endAtMillis: 1_001,
      progress: .5, status: 'uploading' as const, statusDetail: '上传中', createdAtMillis: 1, updatedAtMillis: 1,
    }
    items = [owner]
    await open()
    expect(label()).toBe('音频上传中')
    items = [{ ...owner, parsedSize: 4, progress: 1, status: 'transcribing', statusDetail: '转写中' }]
    await poll()
    expect(label()).toBe('导入历史音频')
    items = [{ ...owner, parsedSize: 4, progress: 1, status: 'failed', statusDetail: '处理失败' }]
    await poll()
    expect(label()).toBe('导入历史音频')
  })

  it('keeps browser uploads running after Escape, gives one notice per upload, and expires it', async () => {
    let signal: AbortSignal | undefined
    let rejectUpload!: (reason: Error) => void
    mocks.uploadArkmeRecording.mockImplementation(async (_path, _file, _start, _owner, options) => {
      signal = options.signal
      return await new Promise((_resolve, reject) => { rejectUpload = reject })
    })
    await open()
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.onChange({ target: { files: [new File(['data'], 'new.m4a')], value: '' } })
      await tick()
    })
    await act(async () => {
      renderer.root.findAll(node => node.type === 'button' && node.children.includes('导入'))[0]!.props.onClick()
      await tick()
    })
    expect(label()).toBe('音频上传中')
    await act(async () => { renderer.root.findByType('dialog').props.onCancel({ preventDefault() {} }); await tick() })
    expect(notice()).toHaveLength(1)
    expect(notice()[0]!.children.join('')).toContain('音频会继续上传')
    expect(signal?.aborted).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await tick() })
    expect(notice()).toHaveLength(0)
    await open()
    await close()
    expect(notice()).toHaveLength(0)
    await act(async () => { rejectUpload(new Error('网络中断')); await tick() })
    expect(label()).toBe('导入失败，查看')
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledOnce()
  })

  it('prioritizes active uploads over failures, exposes failures afterward, and follows retry', async () => {
    items = [job('failed'), job('uploading', 'second')]
    await open()
    expect(label()).toBe('音频上传中')
    items = [job('failed'), job('finalizing', 'second')]
    await poll()
    expect(label()).toBe('正在完成导入')
    items = [job('failed'), job('accepted', 'second')]
    await poll()
    expect(label()).toBe('导入失败，查看')
    await act(async () => { renderer.root.findByProps({ 'aria-label': '重试 local.m4a' }).props.onClick(); await tick() })
    expect(label()).toBe('音频上传中')
  })

  it.each(['success', 'failure'] as const)('retains an admitted upload when an older list returns %s during a multi-file submission', async result => {
    const owner = {
      kind: 'owner' as const, taskKey: 'owner', sessionRef: 'audio', ownership: 'self' as const, fileName: 'cloud.m4a',
      fileSize: 4, parsedSize: 4, durationMillis: 1_000, startAtMillis: 1, endAtMillis: 1_001,
      progress: 1, status: 'transcribing' as const, statusDetail: '转写中', createdAtMillis: 1, updatedAtMillis: 1,
    }
    items = [owner]
    await open()
    let acceptFirst!: (value: PublicRecordingImportJob) => void
    let rejectSecond!: (reason: Error) => void
    mocks.uploadArkmeRecording
      .mockImplementationOnce(() => new Promise(resolve => { acceptFirst = resolve }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSecond = reject }))
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.onChange({ target: {
        files: [new File(['data'], 'first.m4a'), new File(['data'], 'second.m4a')], value: '',
      } })
      await tick()
    })
    await act(async () => {
      renderer.root.findAll(node => node.type === 'button' && node.children.includes('导入'))[0]!.props.onClick()
      await tick()
    })
    let finishOldList!: (value: unknown) => void
    let rejectOldList!: (reason: Error) => void
    mocks.callArkme.mockImplementationOnce(() => new Promise((resolve, reject) => { finishOldList = resolve; rejectOldList = reject }))
    await poll()
    await act(async () => { acceptFirst(job('prepared', 'first')); await tick() })
    expect(renderer.root.findAllByProps({ 'aria-label': '删除 first.m4a' })).toHaveLength(1)
    await act(async () => {
      if (result === 'success') finishOldList({ items: [owner], owner: { state: 'available' } })
      else rejectOldList(new Error('过期请求错误'))
      await tick()
    })
    expect(renderer.root.findAllByProps({ 'aria-label': '删除 first.m4a' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)

    mocks.callArkme.mockRejectedValueOnce(new Error('任务列表暂不可用'))
    await act(async () => { rejectSecond(new Error('第二个文件上传失败')); await tick() })
    expect(label()).toBe('音频上传中')
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledTimes(2)
    items = [owner, job('accepted', 'first')]
    await poll()
    expect(label()).toBe('导入失败，查看')
  })

  it('gives a new notice for a later upload and uses the matching finalizing label', async () => {
    items = [job('uploading')]
    await open()
    await close()
    expect(notice()).toHaveLength(1)
    items = [job('finalizing')]
    await poll()
    expect(notice()[0]!.children.join('')).toContain('正在完成导入')
    items = [job('accepted')]
    await poll()
    expect(label()).toBe('导入历史音频')
    expect(notice()).toHaveLength(0)
    items = [job('finalizing', 'next')]
    await open()
    await close()
    expect(notice()).toHaveLength(1)
    expect(notice()[0]!.children.join('')).toContain('正在完成导入')
  })

  it('silently closes for navigation, keeps observing background work, and isolates accounts', async () => {
    items = [job('uploading')]
    await open()
    await act(async () => { handle.current?.close(); renderer.update(<Surface foreground={false} />); await tick() })
    expect(notice()).toHaveLength(0)
    expect(label()).toBe('音频上传中')
    items = [job('finalizing')]
    await poll()
    expect(label()).toBe('正在完成导入')
    items = []
    await act(async () => { renderer.update(<Surface account="two" />); await tick() })
    expect(label()).toBe('导入历史音频')
    expect(notice()).toHaveLength(0)
  })

  it('only closes on a backdrop click and does not repeat the notice when reopened', async () => {
    items = [job('uploading')]
    await open()
    const backdrop = {}
    await act(async () => { renderer.root.findByType('dialog').props.onClick({ target: {}, currentTarget: backdrop }); await tick() })
    expect(dialog.open).toBe(true)
    expect(notice()).toHaveLength(0)
    await act(async () => { renderer.root.findByType('dialog').props.onClick({ target: backdrop, currentTarget: backdrop }); await tick() })
    expect(dialog.open).toBe(false)
    expect(notice()).toHaveLength(1)
    await open()
    await close()
    expect(notice()).toHaveLength(0)
  })

  it('clears failed feedback only after the existing cancellation succeeds', async () => {
    items = [job('failed')]
    await open()
    await act(async () => { renderer.root.findByProps({ 'aria-label': '删除 local.m4a' }).props.onClick(); await tick() })
    expect(label()).toBe('导入失败，查看')
    await act(async () => { renderer.root.findByProps({ 'aria-label': '取消删除' }).props.onClick(); await tick() })
    expect(label()).toBe('导入失败，查看')
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.cancel') { items = []; return {} }
      if (operation === 'recordings.import.list') return { items, owner: { state: 'available' } }
      throw new Error(String(operation))
    })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '删除 local.m4a' }).props.onClick(); await tick() })
    await act(async () => { renderer.root.findByProps({ 'aria-label': '确认删除' }).props.onClick(); await tick() })
    expect(label()).toBe('导入历史音频')
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.cancel')).toHaveLength(1)
  })

  it('does not mistake an unavailable owner view for a completed upload and recovers on a fresh snapshot', async () => {
    items = [{
      kind: 'owner', taskKey: 'owner', sessionRef: 'audio', ownership: 'self', fileName: 'cloud.m4a',
      fileSize: 4, parsedSize: 2, durationMillis: 1_000, startAtMillis: 1, endAtMillis: 1_001,
      progress: .5, status: 'uploading', statusDetail: '上传中', createdAtMillis: 1, updatedAtMillis: 1,
    }]
    await open()
    mocks.callArkme.mockResolvedValueOnce({ items: [], owner: { state: 'unavailable', message: 'Audio 暂不可用' } })
    await poll()
    expect(label()).toBe('音频上传中')
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Audio 暂不可用')
    await close()
    expect(notice()).toHaveLength(1)
    items = []
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await tick() })
    expect(label()).toBe('导入历史音频')
    expect(notice()).toHaveLength(0)
  })

  it('ignores repeated submission, continues after one file fails, and permits staging the next batch', async () => {
    mocks.uploadArkmeRecording.mockRejectedValueOnce(new Error('第一个文件失败'))
      .mockImplementationOnce(() => new Promise(() => undefined))
    await open()
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.onChange({ target: {
        files: [new File(['data'], 'first.m4a'), new File(['data'], 'second.m4a')], value: '',
      } })
      await tick()
    })
    await act(async () => {
      const submit = renderer.root.findAll(node => node.type === 'button' && node.children.includes('导入'))[0]!
      submit.props.onClick(); submit.props.onClick()
      await tick()
    })
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledTimes(2)
    expect(label()).toBe('音频上传中')
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.onChange({ target: { files: [new File(['data'], 'third.m4a')], value: '' } })
      await tick()
    })
    expect(renderer.root.findByProps({ 'aria-label': 'third.m4a录音开始时间' }).props.disabled).toBe(false)
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledTimes(2)
    await close()
    expect(dialog.open).toBe(false)
    expect(label()).toBe('音频上传中')
  })
})
