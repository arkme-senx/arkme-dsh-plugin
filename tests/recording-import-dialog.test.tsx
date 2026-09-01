import { createRef } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  uploadArkmeRecording: vi.fn(),
  inspectArkmeRecordingSelection: vi.fn(),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  uploadArkmeRecording: mocks.uploadArkmeRecording,
}))
vi.mock('../src/client/recordings/recording-import-selection.js', () => ({
  inspectArkmeRecordingSelection: mocks.inspectArkmeRecordingSelection,
}))

import { ArkmeRecordingImportDialog, type ArkmeRecordingImportDialogHandle } from '../src/client/recordings/ArkmeRecordingImportDialog.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const matches = renderer.root.findAll(node => node.type === 'button'
    && node.children.filter(child => typeof child === 'string').join('').trim() === label)
  expect(matches).toHaveLength(1)
  return matches[0]!
}

function renderedText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('')
}

describe('recording import dialog behavior', () => {
  let renderer: ReactTestRenderer

  beforeEach(async () => {
    mocks.callArkme.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return []
      if (operation === 'recordings.import.preflight') return { duplicateFileNames: [] }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    mocks.uploadArkmeRecording.mockReset().mockResolvedValue({ importRef: 'opaque', phase: 'prepared' })
    mocks.inspectArkmeRecordingSelection.mockReset().mockResolvedValue({
      ok: true, format: 'M4A', durationMillis: 1_000,
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        onAccepted={() => {}}
      />)
      await tick()
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function choose(files: File[]) {
    const input = renderer.root.findByProps({ 'aria-label': '选择录音文件' })
    await act(async () => {
      input.props.onChange({ target: { files, value: 'selected' } })
      await tick()
    })
  }

  it('exposes an explicit close control so the modal never traps the user', () => {
    expect(renderer.root.findAllByProps({ 'aria-label': '关闭上传文件' })).toHaveLength(1)
  })

  it('exposes one dialog interface for the toolbar and empty-timeline import entries', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    const ref = createRef<ArkmeRecordingImportDialogHandle>()
    const showModal = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        ref={ref}
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        onAccepted={() => {}}
      />, { createNodeMock: element => element.type === 'dialog' ? { showModal, close: vi.fn() } : null })
      await tick()
    })

    await act(async () => { ref.current?.open(); await tick() })

    expect(showModal).toHaveBeenCalledOnce()
  })

  it('deduplicates same-name files by the Audio owner rule inside one browser selection', async () => {
    const first = new File(['same'], '会议.m4a', { type: 'audio/mp4' })
    const second = new File(['different-size'], '会议.m4a', { type: 'audio/mp4' })

    await choose([first, second])

    expect(renderer.root.findAll(node => typeof node.props?.['aria-label'] === 'string'
      && node.props['aria-label'] === '选择 会议.m4a')).toHaveLength(1)
    expect(mocks.inspectArkmeRecordingSelection).toHaveBeenCalledTimes(1)
    expect(renderedText(renderer.root.findByProps({ role: 'alert' }))).toContain('同一批次不能包含同名录音：会议.m4a')
  })

  it('inspects large-file metadata sequentially instead of starting unbounded browser work', async () => {
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    mocks.inspectArkmeRecordingSelection.mockReset().mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseFirst = resolve })
      return { ok: true, format: 'M4A', durationMillis: 1_000 }
    }).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseSecond = resolve })
      return { ok: true, format: 'M4A', durationMillis: 1_000 }
    }).mockResolvedValue({ ok: true, format: 'M4A', durationMillis: 1_000 })

    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
      new File(['c'], 'C.m4a', { type: 'audio/mp4' }),
    ])
    expect(mocks.inspectArkmeRecordingSelection).toHaveBeenCalledTimes(1)

    await act(async () => { releaseFirst(); await tick() })
    expect(mocks.inspectArkmeRecordingSelection).toHaveBeenCalledTimes(2)
    await act(async () => { releaseSecond(); await tick() })
  })

  it('does not keep inspecting queued files after the recording page unmounts', async () => {
    let releaseFirst!: () => void
    mocks.inspectArkmeRecordingSelection.mockReset().mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseFirst = resolve })
      return { ok: true, format: 'M4A', durationMillis: 1_000 }
    }).mockResolvedValue({ ok: true, format: 'M4A', durationMillis: 1_000 })
    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
    ])
    expect(mocks.inspectArkmeRecordingSelection).toHaveBeenCalledTimes(1)

    await act(async () => { renderer.unmount(); releaseFirst(); await tick() })

    expect(mocks.inspectArkmeRecordingSelection).toHaveBeenCalledTimes(1)
  })

  it('uses the seven-column desktop table and keeps the time editor under the file name', async () => {
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])

    const table = renderer.root.findByProps({ 'aria-label': '待导入录音' })
    const rows = table.findAllByProps({ role: 'row' })
    expect(rows[0]?.children).toHaveLength(7)
    expect(rows[1]?.children).toHaveLength(7)
    expect(rows[1]?.children[1]).toMatchObject({
      props: { style: expect.objectContaining({ display: 'grid' }) },
    })
    expect(rows[1]?.findByProps({ 'aria-label': 'A.m4a录音开始时间' })).toBeDefined()
    expect(rows[1]?.findByProps({ 'aria-label': 'A.m4a录音结束时间' })).toBeDefined()
    expect(renderedText(rows[1]!)).toContain('待导入')
    expect(renderedText(rows[1]!)).not.toContain('待上传')
    expect(renderedText(rows[1]!)).toContain('1B')
    expect(renderedText(rows[1]!)).toContain('1s')
    expect(renderedText(rows[1]!)).not.toContain('00:00:01')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('录音时间')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('返回上传')
  })

  it('renders background tasks inside the same seven-column desktop table', async () => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return [{
        importRef: 'opaque', revision: 2, phase: 'uploading', fileName: '后台.m4a', fileSize: 2_048,
        durationMillis: 3_000, progress: .5, ownership: 'other', createdAtMillis: 1, updatedAtMillis: 2,
      }]
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        onAccepted={() => {}}
      />)
      await tick()
    })

    const tables = renderer.root.findAllByProps({ 'aria-label': '待导入录音' })
    expect(tables).toHaveLength(1)
    const taskRow = tables[0]!.findAllByProps({ role: 'row' })[1]!
    expect(taskRow.children).toHaveLength(7)
    expect(renderedText(taskRow)).toContain('后台.m4a')
    expect(renderedText(taskRow)).toContain('2KB')
    expect(renderedText(taskRow)).toContain('3s')
    expect(renderedText(taskRow)).toContain('他人')
    expect(renderedText(taskRow)).toContain('导入中')
    expect(renderedText(taskRow)).not.toContain('上传中')
    expect(renderer.root.findByProps({ 'aria-label': '删除 后台.m4a' })).toBeDefined()
    expect(renderedText(taskRow)).not.toContain('取消')
    expect(renderer.root.findAllByProps({ 'aria-label': '导入任务' })).toHaveLength(0)
  })

  it('asks for desktop deletion confirmation before cancelling a background import', async () => {
    const active = {
      importRef: 'opaque', revision: 2, phase: 'uploading' as const, ownership: 'self' as const,
      fileName: '后台.m4a', fileSize: 2_048, durationMillis: 3_000, progress: .5,
      createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return [active]
      if (operation === 'recordings.import.cancel') return { ...active, phase: 'cancelled' }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => { renderer.unmount(); renderer = create(<ArkmeRecordingImportDialog
      importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
      currentUserId={42} onAccepted={() => {}}
    />); await tick() })

    await act(async () => { renderer.root.findByProps({ 'aria-label': '删除 后台.m4a' }).props.onClick(); await tick() })

    expect(renderer.root.findByProps({ 'aria-label': '确认删除录音' })).toBeDefined()
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'recordings.import.cancel')).toBe(false)
  })

  it('asks for confirmation before changing the desktop data ownership selection', async () => {
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])
    const ownership = renderer.root.findByProps({ 'aria-label': 'A.m4a数据归属' })

    await act(async () => { ownership.findAllByType('button')[1]!.props.onClick(); await tick() })

    expect(renderer.root.findByProps({ 'aria-label': '确认修改数据归属' })).toBeDefined()
    expect(ownership.findAllByType('button')[0]!.props['aria-pressed']).toBe(true)
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '确认修改数据归属' }).findByProps({ 'aria-label': '确认' }).props.onClick()
      await tick()
    })
    expect(renderer.root.findByProps({ 'aria-label': 'A.m4a数据归属' }).findAllByType('button')[1]!.props['aria-pressed'])
      .toBe(true)
  })

  it('dismisses the top confirmation on Escape before closing the upload dialog', async () => {
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])
    const ownership = renderer.root.findByProps({ 'aria-label': 'A.m4a数据归属' })
    await act(async () => { ownership.findAllByType('button')[1]!.props.onClick(); await tick() })
    expect(renderer.root.findByProps({ 'aria-label': '确认修改数据归属' })).toBeDefined()

    const preventDefault = vi.fn()
    await act(async () => {
      renderer.root.findByType('dialog').props.onCancel({ preventDefault })
      await tick()
    })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ 'aria-label': '确认修改数据归属' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': '选择 A.m4a' })).toBeDefined()
  })

  it('rechecks the remaining files after skipping duplicates discovered by the first preflight', async () => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return []
      if (operation === 'recordings.import.preflight') {
        const call = mocks.callArkme.mock.calls.filter(([name]) => name === 'recordings.import.preflight').length
        return { duplicateFileNames: call === 1 ? ['A.m4a'] : ['B.m4a'] }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
    ])

    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })
    const duplicateDialog = renderer.root.findByProps({ 'aria-label': '重复录音文件' })
    expect(duplicateDialog.props.role).toBe('dialog')
    expect(renderedText(duplicateDialog)).toContain('发现 1 个重复文件')
    expect(renderedText(duplicateDialog)).toContain('将跳过这些文件，并继续导入其余音频')
    expect(renderedText(duplicateDialog)).not.toContain('返回')
    await act(async () => { button(renderer, '跳过并继续').props.onClick(); await tick() })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.preflight'))
      .toHaveLength(2)
    expect(mocks.uploadArkmeRecording).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('B.m4a')
  })

  it('observes background completion and refreshes the calendar while the dialog is closed', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useFakeTimers()
    mocks.callArkme.mockClear()
    const onAccepted = vi.fn()
    const active = {
      importRef: 'opaque', revision: 2, phase: 'uploading', fileName: 'A.m4a', fileSize: 1,
      durationMillis: 1_000, progress: .5, createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation !== 'recordings.import.list') throw new Error(`unexpected operation: ${String(operation)}`)
      const listCalls = mocks.callArkme.mock.calls.filter(([name]) => name === 'recordings.import.list').length
      return listCalls === 1 ? [active] : [{ ...active, revision: 3, phase: 'accepted', progress: 1 }]
    })

    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        onAccepted={onAccepted}
      />)
      await tick()
    })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.list'))
      .toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); await tick() })

    expect(onAccepted).toHaveBeenCalledOnce()
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.list'))
      .toHaveLength(2)
  })

  it('freezes every staged row while the sequential import snapshot is being submitted', async () => {
    mocks.uploadArkmeRecording.mockImplementationOnce(async () => await new Promise(() => undefined))
    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
    ])

    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })

    expect(renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '选择 B.m4a' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'B.m4a录音开始时间' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '删除 B.m4a' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'B.m4a数据归属' }).findAllByType('button'))
      .toSatisfy(buttons => buttons.every(ownerButton => ownerButton.props.disabled === true))
    expect(renderer.root.findByProps({ 'aria-label': '全选' }).props.disabled).toBe(true)
  })

  it('allows closing the dialog while upload continues without treating close as cancellation', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    const close = vi.fn()
    mocks.uploadArkmeRecording.mockImplementationOnce(async () => await new Promise(() => undefined))
    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        onAccepted={() => {}}
      />, { createNodeMock: element => element.type === 'dialog' ? { showModal: vi.fn(), close } : null })
      await tick()
    })
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])

    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })
    const closeButton = renderer.root.findByProps({ 'aria-label': '关闭上传文件' })

    expect(closeButton.props.disabled).not.toBe(true)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('停止上传')
    await act(async () => { closeButton.props.onClick(); await tick() })
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledOnce()
  })

  it('locks the submission during duplicate preflight and aborts that read on unmount', async () => {
    let preflightSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementation(async (operation, _params, signal?: AbortSignal) => {
      if (operation === 'recordings.import.list') return []
      if (operation === 'recordings.import.preflight') {
        preflightSignal = signal
        return await new Promise(() => undefined)
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])
    const importButton = button(renderer, '导入')

    await act(async () => {
      importButton.props.onClick()
      importButton.props.onClick()
      await tick()
    })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.preflight'))
      .toHaveLength(1)
    expect(renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.disabled).toBe(true)
    await act(async () => { renderer.unmount(); await tick() })
    expect(preflightSignal?.aborted).toBe(true)
  })
})
