import { createRef } from 'react'
import { FileAudio } from '@phosphor-icons/react/dist/icons/FileAudio'
import { UploadSimple } from '@phosphor-icons/react/dist/icons/UploadSimple'
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
import { arkmeTheme } from '../src/client/arkme-theme.js'

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

function currentSnapshot(items: unknown[] = []) {
  return { items, owner: { state: 'available' as const } }
}

describe('recording import dialog behavior', () => {
  let renderer: ReactTestRenderer

  beforeEach(async () => {
    mocks.callArkme.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.preflight') return { duplicateFileNames: [] }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    mocks.uploadArkmeRecording.mockReset().mockResolvedValue({
      kind: 'local', importRef: 'opaque', revision: 1, phase: 'prepared', ownership: 'self',
      fileName: 'A.m4a', fileSize: 1, durationMillis: 1_000, startAtMillis: 1_725_000_000_000,
      endAtMillis: 1_725_000_001_000, progress: 0, status: 'preparing', statusDetail: '准备中',
      createdAtMillis: 1, updatedAtMillis: 1,
    })
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

  it('matches the desktop modal chrome with the upload-dialog close control', () => {
    expect(renderer.root.findAllByProps({ 'aria-label': '关闭上传文件' })).toHaveLength(1)
    expect(renderer.root.findByType('dialog').props.style).toMatchObject({ border: 0, outline: 'none' })
  })

  it('matches the desktop upload hierarchy without a second empty-file action and keeps only rows scrollable', async () => {
    expect(renderer.root.findAllByType(FileAudio)).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('暂无文件')
    expect(renderer.root.findAll(node => node.type === 'button' && renderedText(node) === '添加文件')).toHaveLength(0)

    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])

    const table = renderer.root.findByProps({ 'aria-label': '待导入录音' })
    expect(table.props.style).toMatchObject({ marginTop: 0, width: '100%' })
    expect(table.findByProps({ 'aria-label': '录音文件列表' }).props.style).toMatchObject({
      minHeight: 70,
      maxHeight: 250,
      overflowY: 'auto',
    })
    const stagedRow = table.findAllByProps({ role: 'row' })[1]!
    expect(stagedRow.findAllByType(FileAudio)).toHaveLength(0)
    for (const index of [2, 3, 5]) {
      expect((stagedRow.children[index] as ReactTestInstance).props.style)
        .toMatchObject({ display: 'grid', placeItems: 'center' })
    }
    expect((stagedRow.children[4] as ReactTestInstance).props.style)
      .toMatchObject({ display: 'grid', justifySelf: 'center' })
    expect((stagedRow.children[5] as ReactTestInstance).props.style)
      .toMatchObject({ fontSize: 13, fontWeight: 500, textAlign: 'center' })
    expect(renderer.root.findByProps({ 'aria-label': '选择 A.m4a' }).props.style).toMatchObject({
      width: 15,
      height: 15,
    })
    expect(button(renderer, '导入').findAllByType(UploadSimple)).toHaveLength(1)
  })

  it('keeps the desktop drop zone as the only empty upload entry while the owner read settles', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    let resolveList!: (value: ReturnType<typeof currentSnapshot>) => void
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return await new Promise<ReturnType<typeof currentSnapshot>>(resolve => { resolveList = resolve })
      throw new Error(`unexpected operation: ${String(operation)}`)
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

    expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取上传任务…')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('暂无文件')

    await act(async () => { resolveList(currentSnapshot()); await tick() })

    expect(JSON.stringify(renderer.toJSON())).not.toContain('暂无文件')
  })

  it('keeps local tasks actionable and retries when the Audio owner view is incomplete', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useFakeTimers()
    mocks.callArkme.mockClear()
    const active = {
      kind: 'local' as const, importRef: 'local-active', revision: 2, phase: 'failed' as const,
      ownership: 'self' as const, fileName: '待重试.m4a', fileSize: 2_048, durationMillis: 3_000,
      startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_003_000, progress: .5,
      status: 'failed' as const, statusDetail: '上传失败', retryable: true,
      createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation !== 'recordings.import.list') throw new Error(`unexpected operation: ${String(operation)}`)
      const listCalls = mocks.callArkme.mock.calls.filter(([name]) => name === 'recordings.import.list').length
      return listCalls === 1
        ? { items: [active], owner: { state: 'unavailable', message: 'Audio 上传任务读取失败，请稍后重试' } }
        : currentSnapshot([active])
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

    expect(renderer.root.findByProps({ 'aria-label': '重试 待重试.m4a' })).toBeDefined()
    expect(renderedText(renderer.root.findByProps({ role: 'alert' }))).toContain('Audio 上传任务读取失败')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('暂无文件')

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await tick() })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.list'))
      .toHaveLength(2)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('uses the desktop drag overlay instead of only tinting the drop zone', async () => {
    const dropzone = renderer.root.find(node => node.props?.role === 'button' && node.props?.['aria-disabled'] === false)

    await act(async () => { dropzone.props.onDragEnter({ preventDefault: vi.fn() }); await tick() })

    expect(JSON.stringify(renderer.toJSON())).toContain('松开上传至 Arkme')
  })

  it('exposes one dialog interface for the toolbar and empty-timeline import entries', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    const ref = createRef<ArkmeRecordingImportDialogHandle>()
    const showModal = vi.fn()
    const focus = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        ref={ref}
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        onAccepted={() => {}}
      />, { createNodeMock: element => element.type === 'dialog' ? { showModal, close: vi.fn(), focus } : null })
      await tick()
    })

    await act(async () => { ref.current?.open(); await tick() })

    expect(showModal).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
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

  it('uses the desktop case-insensitive file-name identity when staging duplicates', async () => {
    const first = new File(['same'], 'Meeting.WAV', { type: 'audio/wav' })
    const second = new File(['different-size'], 'meeting.wav', { type: 'audio/wav' })

    await choose([first, second])

    expect(renderer.root.findAllByProps({ 'aria-label': '选择 Meeting.WAV' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'aria-label': '选择 meeting.wav' })).toHaveLength(0)
    expect(mocks.inspectArkmeRecordingSelection).toHaveBeenCalledTimes(1)
    expect(renderedText(renderer.root.findByProps({ role: 'alert' }))).toContain('meeting.wav')
  })

  it('reserves staged file names synchronously across rapid add events', async () => {
    const input = renderer.root.findByProps({ 'aria-label': '选择录音文件' })
    const first = new File(['first'], '连续添加.m4a', { type: 'audio/mp4' })
    const second = new File(['second'], '连续添加.m4a', { type: 'audio/mp4' })

    await act(async () => {
      input.props.onChange({ target: { files: [first], value: 'first' } })
      input.props.onChange({ target: { files: [second], value: 'second' } })
      await tick()
    })

    expect(renderer.root.findAllByProps({ 'aria-label': '选择 连续添加.m4a' })).toHaveLength(1)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.preflight'))
      .toHaveLength(1)
  })

  it('checks Audio-owner duplicates when files are added and only removes duplicates after confirmation', async () => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.preflight') return { duplicateFileNames: ['A.m4a'] }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })

    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
    ])

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'recordings.import.preflight',
      { fileNames: ['A.m4a', 'B.m4a'] },
      expect.any(AbortSignal),
    )
    const duplicateDialog = renderer.root.findByProps({ 'aria-label': '重复录音文件' })
    expect(renderedText(duplicateDialog)).toContain('A.m4a')
    expect(mocks.uploadArkmeRecording).not.toHaveBeenCalled()

    await act(async () => { button(renderer, '跳过并继续').props.onClick(); await tick() })

    expect(JSON.stringify(renderer.toJSON())).not.toContain('A.m4a')
    expect(JSON.stringify(renderer.toJSON())).toContain('B.m4a')
    expect(mocks.uploadArkmeRecording).not.toHaveBeenCalled()
  })

  it('does not retain a stale duplicate verdict after the staged row is removed and selected again', async () => {
    let preflightCalls = 0
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.preflight') {
        preflightCalls += 1
        return { duplicateFileNames: preflightCalls === 1 ? ['A.m4a'] : [] }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    const file = new File(['a'], 'A.m4a', { type: 'audio/mp4' })

    await choose([file])
    expect(renderer.root.findByProps({ 'aria-label': '重复录音文件' })).toBeDefined()
    await act(async () => { renderer.root.findByProps({ 'aria-label': '删除 A.m4a' }).props.onClick(); await tick() })
    expect(renderer.root.findAllByProps({ 'aria-label': '重复录音文件' })).toHaveLength(0)

    await choose([file])
    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })

    expect(preflightCalls).toBe(3)
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledOnce()
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

  it('stops queued browser inspection when the account-scoped import owner unmounts', async () => {
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

  it('uses the current eight-column desktop table and keeps the time editor under the file name', async () => {
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])

    const table = renderer.root.findByProps({ 'aria-label': '待导入录音' })
    const rows = table.findAllByProps({ role: 'row' })
    expect(rows[0]?.children).toHaveLength(8)
    expect(rows[1]?.children).toHaveLength(8)
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
    expect(renderedText(rows[0]!)).toContain('处理耗时')
  })

  it('renders the desktop business-progress popover and its close interaction', async () => {
    const startAtMillis = new Date(2026, 7, 26, 2, 47, 11).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(startAtMillis + 12_000)
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot([{
        kind: 'owner', taskKey: 'owner-task', sessionRef: 'session-opaque',
        fileName: '后台.m4a', fileSize: 2_048, parsedSize: 2_048,
        durationMillis: 3_000, progress: .5, ownership: 'other', createdAtMillis: startAtMillis - 12_000,
        updatedAtMillis: startAtMillis - 2_000, startAtMillis, endAtMillis: startAtMillis + 3_000,
        status: 'transcribing', statusDetail: '转写中',
        importProgress: {
          status: 'processing', totalDurationMillis: 12_000, serverNowMillis: startAtMillis + 12_000,
          observedAtMillis: startAtMillis + 12_000,
          rows: [
            { code: 'upload', status: 'completed', startedAtMillis: startAtMillis, endedAtMillis: startAtMillis + 2_000, durationMillis: 2_000, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: 'continuous', relationDurationMillis: 0 },
            { code: 'import', status: 'completed', startedAtMillis: startAtMillis + 2_000, endedAtMillis: startAtMillis + 4_000, durationMillis: 2_000, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: 'wait', relationDurationMillis: 2_000 },
            { code: 'voice_recognition', status: 'completed', startedAtMillis: startAtMillis + 6_000, endedAtMillis: startAtMillis + 8_000, durationMillis: 2_000, provider: 'sensevoice', model: 'fsmn-campplus', modelVersion: 'v1', modelDurationMillis: 0, nextRelation: 'wait', relationDurationMillis: 1_000 },
            { code: 'primary_transcript', status: 'completed', startedAtMillis: startAtMillis + 9_000, endedAtMillis: startAtMillis + 11_000, durationMillis: 2_000, provider: 'sensevoice', model: 'sensevoice-small', modelVersion: 'v2', modelDurationMillis: 2_900, nextRelation: 'sidecar', relationDurationMillis: 0 },
            { code: 'enhancement_transcript', status: 'processing', startedAtMillis: startAtMillis + 11_000, endedAtMillis: 0, durationMillis: 1_000, provider: 'doubao', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: 'sidecar', relationDurationMillis: 0 },
          ],
        },
      }])
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
    expect(taskRow.children).toHaveLength(8)
    expect(renderedText(taskRow)).toContain('后台.m4a')
    expect(renderedText(taskRow)).toContain('2KB')
    expect(renderedText(taskRow)).toContain('3s')
    expect(renderedText(taskRow)).toContain('他人')
    expect(taskRow.findByProps({ 'aria-label': '后台.m4a录音开始时间' }).props.value).toBe('2026-08-26T02:47:11')
    expect(renderedText(taskRow)).toContain('02:47:14')
    expect(renderedText(taskRow)).toContain('转写中')
    const statusCell = taskRow.find(node => typeof node.props.title === 'string' && node.props.title.includes('转写中'))
    await act(async () => { statusCell.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 20, bottom: 40 }) } }); await tick() })
    expect(renderedText(renderer.root.findByProps({ 'aria-label': '后台.m4a上传状态详情' }))).toContain('转写中')
    await act(async () => { statusCell.props.onMouseLeave(); await tick() })
    const durationButton = taskRow.findByProps({ 'aria-label': '处理耗时 12s' })
    await act(async () => {
      durationButton.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 600, right: 648, top: 400, bottom: 428, width: 48, height: 28 }) } })
      await tick()
    })
    const details = renderer.root.findByProps({ 'aria-label': '后台.m4a处理耗时详情' })
    expect(details.props.style).toMatchObject({ width: 632, left: 16, top: 134, borderRadius: 10, padding: 0 })
    expect(renderedText(details)).toContain('处理耗时')
    for (const header of ['阶段 / 模型', '状态', '开始时间', '结束时间', '用户耗时', '模型耗时', '关系 / 说明']) {
      expect(renderedText(details)).toContain(header)
    }
    for (const phase of ['上传', '导入', '人声识别 · fsmn-campplus', '基础转写 · SenseVoice', '优化转写 · 豆包']) {
      expect(renderedText(details)).toContain(phase)
    }
    expect(renderedText(details)).toContain('决定文字可用')
    expect(renderedText(details)).toContain('并行增强，不阻塞完成')
    expect(renderedText(details)).toContain('等待 2s')
    expect(renderedText(details)).toContain('2.9s')
    expect(renderer.root.findByProps({ 'aria-label': '关闭 后台.m4a处理耗时详情' })).toBeDefined()
    expect(durationButton.props.style).toMatchObject({ background: arkmeTheme.active })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })
    expect(renderer.root.findByProps({ 'aria-label': '处理耗时 14s' })).toBeDefined()
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '关闭 后台.m4a处理耗时详情' }).props.onClick()
      await tick()
    })
    expect(renderer.root.findAllByProps({ 'aria-label': '后台.m4a处理耗时详情' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': '删除 后台.m4a' })).toBeDefined()
    expect(renderedText(taskRow)).not.toContain('取消')
    expect(renderer.root.findAllByProps({ 'aria-label': '导入任务' })).toHaveLength(0)
  })

  it('presents the desktop local upload fallback until Audio owner progress arrives', async () => {
    const startAtMillis = new Date(2026, 7, 26, 2, 47, 11).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(startAtMillis)
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot([{
        kind: 'local', importRef: 'opaque-local', revision: 2, phase: 'uploading',
        fileName: '本地上传.m4a', fileSize: 2_048, durationMillis: 3_000, progress: .5,
        ownership: 'self', createdAtMillis: startAtMillis - 12_000,
        updatedAtMillis: startAtMillis, startAtMillis, endAtMillis: startAtMillis + 3_000,
        status: 'uploading', statusDetail: '上传中',
      }])
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    const row = renderer.root.findByProps({ 'aria-label': '待导入录音' })
      .findAllByProps({ role: 'row' })[1]!
    expect(row.findByProps({ 'aria-label': '处理耗时 12s' })).toBeDefined()
    await act(async () => {
      row.findByProps({ 'aria-label': '处理耗时 12s' }).props.onClick()
      await tick()
    })
    const details = renderer.root.findByProps({ 'aria-label': '本地上传.m4a处理耗时详情' })
    expect(renderedText(details)).toContain('上传处理中')
    expect(renderedText(details)).toContain('导入未开始')
  })

  it('keeps the local import stage live after Audio accepts the upload and before owner progress arrives', async () => {
    const nowMillis = new Date(2026, 7, 26, 2, 47, 23).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(nowMillis)
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot([{
        kind: 'local', importRef: 'opaque-accepted', revision: 6, phase: 'accepted',
        fileName: '等待云端进度.m4a', fileSize: 2_048, durationMillis: 3_000, progress: 1,
        ownership: 'self', createdAtMillis: nowMillis - 12_000,
        updatedAtMillis: nowMillis - 2_000, startAtMillis: nowMillis, endAtMillis: nowMillis + 3_000,
        status: 'accepted', statusDetail: 'Audio 已接收',
      }])
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    const row = renderer.root.findByProps({ 'aria-label': '待导入录音' })
      .findAllByProps({ role: 'row' })[1]!
    expect(row.findByProps({ 'aria-label': '处理耗时 12s' })).toBeDefined()
    await act(async () => {
      row.findByProps({ 'aria-label': '处理耗时 12s' }).props.onClick()
      await tick()
    })
    const details = renderer.root.findByProps({ 'aria-label': '等待云端进度.m4a处理耗时详情' })
    expect(renderedText(details)).toContain('上传已完成')
    expect(renderedText(details)).toContain('导入处理中')

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })

    expect(renderer.root.findByProps({ 'aria-label': '处理耗时 14s' })).toBeDefined()
  })

  it('keeps the timing popover after the accepted local task becomes an owner task', async () => {
    const nowMillis = new Date(2026, 7, 26, 2, 47, 23).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(nowMillis)
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot([{
        kind: 'owner', taskKey: 'owner-handoff', sessionRef: 'session-opaque',
        fileName: '交接中.m4a', fileSize: 2_048, parsedSize: 2_048,
        durationMillis: 3_000, progress: 1, ownership: 'self',
        createdAtMillis: nowMillis - 12_000, updatedAtMillis: nowMillis - 2_000,
        startAtMillis: nowMillis, endAtMillis: nowMillis + 3_000,
        status: 'waiting', statusDetail: '等待中',
        localImportTiming: {
          startedAtMillis: nowMillis - 12_000,
          acceptedAtMillis: nowMillis - 2_000,
        },
      }])
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    const row = renderer.root.findByProps({ 'aria-label': '待导入录音' })
      .findAllByProps({ role: 'row' })[1]!
    const durationButton = row.findByProps({ 'aria-label': '处理耗时 12s' })
    await act(async () => {
      durationButton.props.onClick()
      await tick()
    })

    const details = renderer.root.findByProps({ 'aria-label': '交接中.m4a处理耗时详情' })
    expect(renderedText(details)).toContain('上传已完成')
    expect(renderedText(details)).toContain('导入处理中')

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })

    expect(renderer.root.findByProps({ 'aria-label': '处理耗时 14s' })).toBeDefined()
  })

  it('opens the desktop completed page and keeps terminal owner tasks out of the current list', async () => {
    const startAtMillis = new Date(2026, 7, 25, 18, 30, 0).getTime()
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') return {
        items: [{
          sessionRef: 'session-opaque', taskKey: 'completed-1', ownership: 'self', fileName: '已完成.wav',
          fileSize: 4_096, parsedSize: 2_048, durationMillis: 65_000, startAtMillis,
          endAtMillis: startAtMillis + 65_000, status: 'completed', statusDetail: '已完成',
          importProgress: {
            status: 'completed', totalDurationMillis: 18_000,
            serverNowMillis: startAtMillis + 18_000, observedAtMillis: startAtMillis + 18_000,
            rows: [{
              code: 'upload', status: 'completed', startedAtMillis: startAtMillis,
              endedAtMillis: startAtMillis + 18_000, durationMillis: 18_000,
              provider: '', model: '', modelVersion: '', modelDurationMillis: 0,
              nextRelation: 'continuous', relationDurationMillis: 0,
            }],
          },
          createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis + 18_000,
          progress: 1,
        }],
        total: 1,
        offset: Number(params?.offset ?? 0),
        hasMore: false,
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })

    const history = renderer.root.findByProps({ 'aria-label': '已完成录音导入' })
    expect(renderedText(history)).toContain('已完成（1）')
    expect(history.props.style).toMatchObject({ width: 'min(780px,calc(100vw - 32px))' })
    expect(history.findByProps({ 'aria-label': '已完成任务内容' }).props.style).toMatchObject({
      padding: '0 16px 12px',
    })
    expect(history.findByProps({ 'aria-label': '已完成任务表格' }).props.style).toMatchObject({
      width: '100%', minWidth: 748,
    })
    expect(renderedText(history)).toContain('已完成.wav')
    expect(history.findByProps({ 'aria-label': '已完成.wav录音开始时间' }).props.value).toBe('2026-08-25T18:30:00')
    expect(renderedText(history)).toContain('18:31:05')
    expect(renderedText(history)).toContain('1m5s')
    expect(renderedText(history)).toContain('18s')
    expect(history.findByProps({ 'aria-label': '已完成.wav录音时长 1m5s' }).props.style).toMatchObject({
      padding: '0 6px', boxSizing: 'border-box', fontSize: 12,
    })
    expect(history.findByProps({ 'aria-label': '已完成.wav文件大小 4KB' }).props.style).toMatchObject({
      padding: '0 6px', boxSizing: 'border-box', fontSize: 12,
    })
    expect(renderer.root.findAllByProps({ 'aria-label': '待导入录音' })).toHaveLength(0)
    expect(mocks.callArkme).toHaveBeenCalledWith(
      'recordings.import.history',
      expect.objectContaining({ offset: 0 }),
      expect.any(AbortSignal),
    )
  })

  it('paginates the completed page against one fixed owner snapshot without duplicating rows', async () => {
    const startAtMillis = new Date(2026, 7, 25, 18, 30, 0).getTime()
    const item = (taskKey: string, fileName: string) => ({
      sessionRef: `session-${taskKey}`, taskKey, ownership: 'self', fileName,
      fileSize: 4_096, parsedSize: 4_096, durationMillis: 65_000, startAtMillis,
      endAtMillis: startAtMillis + 65_000, status: 'completed', statusDetail: '已完成',
      createdAtMillis: startAtMillis,
      updatedAtMillis: startAtMillis + 18_000, progress: 1,
    })
    const historyRequests: Array<Record<string, unknown>> = []
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') {
        historyRequests.push(params as Record<string, unknown>)
        const offset = Number(params?.offset ?? 0)
        return offset === 0
          ? { items: [item('completed-1', '第一页.wav')], total: 2, offset, hasMore: true }
          : { items: [item('completed-1', '第一页.wav'), item('completed-2', '第二页.wav')], total: 2, offset, hasMore: false }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })
    const historyList = renderer.root.findByProps({ 'aria-label': '已完成任务列表' })
    await act(async () => {
      historyList.props.onScroll({ currentTarget: { scrollTop: 850, clientHeight: 100, scrollHeight: 1_000 } })
      await tick()
    })

    const history = renderer.root.findByProps({ 'aria-label': '已完成录音导入' })
    expect(renderedText(history)).toContain('第一页.wav')
    expect(renderedText(history)).toContain('第二页.wav')
    expect(renderedText(history).match(/第一页\.wav/g)).toHaveLength(1)
    expect(historyRequests).toHaveLength(2)
    expect(historyRequests[1]).toMatchObject({ offset: 1, limit: 50, toMillis: historyRequests[0]!.toMillis })
    expect(renderer.root.findAll(node => node.type === 'button' && renderedText(node) === '加载更多')).toHaveLength(0)
  })

  it('matches the desktop completed-page empty copy and vertical rhythm', async () => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') return { items: [], total: 0, offset: 0, hasMore: false }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })

    const empty = renderer.root.findByProps({ 'aria-label': '暂无已完成任务' })
    expect(renderedText(empty)).toContain('暂无已完成任务')
    expect(renderedText(empty)).toContain('导入完成的音频会显示在这里')
    expect(empty.props.style).toMatchObject({ height: 488 })
  })

  it('matches the desktop completed-page loading indicator without extra copy', async () => {
    let resolveHistory!: (value: { items: []; total: 0; offset: 0; hasMore: false }) => void
    const historyResult = new Promise<{ items: []; total: 0; offset: 0; hasMore: false }>(resolve => {
      resolveHistory = resolve
    })
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') return historyResult
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })

    const loading = renderer.root.findByProps({ 'aria-label': '正在读取已完成任务' })
    expect(renderedText(loading)).toBe('')
    expect(loading.findByProps({ 'data-arkme-recording-history-spinner': 'large' }).props.style)
      .toMatchObject({ width: 36, height: 36, borderRadius: 999 })

    await act(async () => { resolveHistory({ items: [], total: 0, offset: 0, hasMore: false }); await tick() })
  })

  it('does not turn live business-progress rendering into a second completed-page polling state', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useFakeTimers()
    const startAtMillis = new Date(2026, 7, 25, 18, 30, 0).getTime()
    let historyCalls = 0
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') {
        historyCalls += 1
        return {
          items: [{
            sessionRef: 'session-live', taskKey: 'live', ownership: 'self', fileName: '状态刷新.wav',
            fileSize: 4_096, parsedSize: 4_096, durationMillis: 65_000, startAtMillis,
            endAtMillis: startAtMillis + 65_000, status: 'completed',
            statusDetail: '导入完成',
            importProgress: {
              status: 'processing', totalDurationMillis: 10_000,
              serverNowMillis: startAtMillis + 10_000, observedAtMillis: startAtMillis + 10_000,
              rows: [{
                code: 'upload', status: 'processing', startedAtMillis: startAtMillis,
                endedAtMillis: 0, durationMillis: 10_000, provider: '', model: '', modelVersion: '',
                modelDurationMillis: 0, nextRelation: '', relationDurationMillis: 0,
              }],
            },
            createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis + 18_000, progress: 1,
          }],
          total: 1, offset: 0, hasMore: false,
        }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })
    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })
    expect(renderedText(renderer.root.findByProps({ 'aria-label': '已完成录音导入' }))).toContain('导入完成')

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); await tick() })

    expect(historyCalls).toBe(1)
    const history = renderer.root.findByProps({ 'aria-label': '已完成录音导入' })
    expect(renderedText(history)).toContain('导入完成')
    expect(renderedText(history)).not.toContain('正在读取已完成任务')
  })

  it('renders completed-history failure recovery and does not invent a zero processing duration', async () => {
    const startAtMillis = new Date(2026, 7, 25, 18, 30, 0).getTime()
    let historyAttempts = 0
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') {
        historyAttempts += 1
        if (historyAttempts === 1) throw new Error('已完成任务暂不可用')
        return {
          items: [{
            sessionRef: 'session-completed', taskKey: 'completed', ownership: 'self', fileName: '无耗时.wav',
            fileSize: 4_096, parsedSize: 4_096, durationMillis: 65_000, startAtMillis,
            endAtMillis: startAtMillis + 65_000, status: 'completed', statusDetail: '已完成',
            importProgress: {
              status: 'completed', totalDurationMillis: 0,
              serverNowMillis: startAtMillis, observedAtMillis: startAtMillis,
              rows: [{
                code: 'upload', status: 'completed', startedAtMillis: startAtMillis,
                endedAtMillis: startAtMillis, durationMillis: 0,
                provider: '', model: '', modelVersion: '', modelDurationMillis: 0,
                nextRelation: '', relationDurationMillis: 0,
              }],
            },
            createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis,
            progress: 1,
          }],
          total: 1, offset: 0, hasMore: false,
        }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })

    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })
    const historyError = renderedText(renderer.root.findByProps({ role: 'alert' }))
    expect(historyError).toContain('暂时无法加载已完成任务')
    expect(historyError).toContain('请检查网络后重新加载')
    await act(async () => { button(renderer, '重新加载').props.onClick(); await tick() })

    const history = renderer.root.findByProps({ 'aria-label': '已完成录音导入' })
    expect(renderedText(history)).toContain('无耗时.wav')
    expect(renderedText(history)).toContain('—')
    expect(history.findAllByProps({ 'aria-label': '处理耗时 0s' })).toHaveLength(0)
    expect(historyAttempts).toBe(2)
  })

  it('keeps a confirmed owner start edit visible when the follow-up projection refresh fails', async () => {
    const startAtMillis = new Date(2026, 7, 25, 18, 30, 0).getTime()
    let listCalls = 0
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') {
        listCalls += 1
        if (listCalls > 1) throw new Error('任务刷新失败')
        return currentSnapshot([{
          kind: 'owner', taskKey: 'owner-edit', sessionRef: 'session-edit', ownership: 'self',
          fileName: '修改时间.wav', fileSize: 4_096, parsedSize: 2_048, durationMillis: 65_000,
          startAtMillis, endAtMillis: startAtMillis + 65_000, status: 'uploading', statusDetail: '上传中',
          createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis,
          progress: .5,
        }])
      }
      if (operation === 'recordings.import.session.update-start') return undefined
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })
    const input = renderer.root.findByProps({ 'aria-label': '修改时间.wav录音开始时间' })
    const nextValue = '2026-08-25T18:29:00'

    await act(async () => {
      input.props.onChange({ target: { value: nextValue } })
      input.props.onBlur({ target: { value: nextValue } })
      await tick()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.import.session.update-start', {
      sessionRef: 'session-edit', startAtMillis: new Date(nextValue).getTime(),
    })
    expect(renderer.root.findByProps({ 'aria-label': '修改时间.wav录音开始时间' }).props.value).toBe(nextValue)
    expect(renderedText(renderer.root.findByProps({ role: 'alert' }))).toContain('任务刷新失败')
  })

  it('keeps a confirmed completed-task edit visible when the history refresh fails', async () => {
    const startAtMillis = new Date(2026, 7, 25, 18, 30, 0).getTime()
    let historyCalls = 0
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.history') {
        historyCalls += 1
        if (historyCalls > 1) throw new Error('已完成任务刷新失败')
        return {
          items: [{
            sessionRef: 'session-completed-edit', taskKey: 'completed-edit', ownership: 'self',
            fileName: '已完成修改.wav', fileSize: 4_096, parsedSize: 4_096, durationMillis: 65_000,
            startAtMillis, endAtMillis: startAtMillis + 65_000, status: 'completed', statusDetail: '已完成',
            createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis, progress: 1,
          }],
          total: 1, offset: 0, hasMore: false,
        }
      }
      if (operation === 'recordings.import.session.update-start') return undefined
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer.unmount()
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={() => {}}
      />)
      await tick()
    })
    await act(async () => { button(renderer, '已完成').props.onClick(); await tick() })
    const input = renderer.root.findByProps({ 'aria-label': '已完成修改.wav录音开始时间' })
    const nextValue = '2026-08-25T18:29:00'

    await act(async () => {
      input.props.onChange({ target: { value: nextValue } })
      input.props.onBlur({ target: { value: nextValue } })
      await tick()
    })

    expect(renderer.root.findByProps({ 'aria-label': '已完成修改.wav录音开始时间' }).props.value).toBe(nextValue)
    expect(renderedText(renderer.root.findByProps({ role: 'alert' }))).toContain('当前显示上次结果，云端同步失败')
  })

  it('asks for desktop deletion confirmation before cancelling a background import', async () => {
    const active = {
      kind: 'local' as const, importRef: 'opaque', revision: 2, phase: 'uploading' as const, ownership: 'self' as const,
      fileName: '后台.m4a', fileSize: 2_048, durationMillis: 3_000, progress: .5,
      startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_003_000,
      status: 'uploading' as const, statusDetail: '上传中',
      createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot([active])
      if (operation === 'recordings.import.cancel') return {
        ...active,
        phase: 'cancelled',
        status: 'cancelled',
        statusDetail: '已取消',
      }
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

  it('rechecks files at submission time to close the race after the add-time duplicate check', async () => {
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.preflight') {
        const call = mocks.callArkme.mock.calls.filter(([name]) => name === 'recordings.import.preflight').length
        return { duplicateFileNames: call === 1 ? [] : ['B.m4a'] }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
    ])

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.preflight'))
      .toHaveLength(1)

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
    expect(JSON.stringify(renderer.toJSON())).toContain('A.m4a')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('B.m4a')
  })

  it('observes background completion after the workspace becomes inactive and refreshes the calendar', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useFakeTimers()
    mocks.callArkme.mockClear()
    const onAccepted = vi.fn()
    const active = {
      kind: 'local', importRef: 'opaque', revision: 2, phase: 'uploading', ownership: 'self',
      fileName: 'A.m4a', fileSize: 1,
      durationMillis: 1_000, progress: .5, createdAtMillis: 1, updatedAtMillis: 2,
      startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_001_000,
      status: 'uploading', statusDetail: '上传中',
    }
    const owner = {
      kind: 'owner', taskKey: 'owner-A', sessionRef: 'session-A', ownership: 'self',
      fileName: 'A.m4a', fileSize: 1, parsedSize: 1, durationMillis: 1_000,
      startAtMillis: 1, endAtMillis: 1_001, progress: 1,
      status: 'processing', statusDetail: '处理中',
      createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation !== 'recordings.import.list') throw new Error(`unexpected operation: ${String(operation)}`)
      const listCalls = mocks.callArkme.mock.calls.filter(([name]) => name === 'recordings.import.list').length
      return currentSnapshot(listCalls === 1 ? [active] : [owner])
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

    await act(async () => {
      renderer.update(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        foreground={false}
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

  it('keeps polling an owner-active task when optional status enrichment is unavailable', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useFakeTimers()
    mocks.callArkme.mockClear()
    const owner = {
      kind: 'owner', taskKey: 'owner-unavailable', sessionRef: 'session-unavailable', ownership: 'self',
      fileName: '仍在处理.wav', fileSize: 1, parsedSize: 1, durationMillis: 1_000,
      startAtMillis: 1, endAtMillis: 1_001, progress: 1,
      status: 'unavailable', statusDetail: '状态不可用',
      createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot([owner])
      throw new Error(`unexpected operation: ${String(operation)}`)
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
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.list'))
      .toHaveLength(1)

    await act(async () => {
      renderer.update(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import"
        defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42}
        foreground={false}
        onAccepted={() => {}}
      />)
      await tick()
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); await tick() })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.list'))
      .toHaveLength(2)
  })

  it('retains the last owner projection without reporting a false calendar change during an owner outage', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.useFakeTimers()
    mocks.callArkme.mockClear()
    const onAccepted = vi.fn()
    const owner = {
      kind: 'owner', taskKey: 'owner-retained', sessionRef: 'session-retained', ownership: 'self',
      fileName: '仍在处理.wav', fileSize: 1, parsedSize: 1, durationMillis: 1_000,
      startAtMillis: 1, endAtMillis: 1_001, progress: 1,
      status: 'transcribing', statusDetail: '转写中',
      createdAtMillis: 1, updatedAtMillis: 2,
    }
    mocks.callArkme.mockImplementation(async operation => {
      if (operation !== 'recordings.import.list') throw new Error(`unexpected operation: ${String(operation)}`)
      const listCalls = mocks.callArkme.mock.calls.filter(([name]) => name === 'recordings.import.list').length
      return listCalls === 2
        ? { items: [], owner: { state: 'unavailable', message: 'Audio 上传任务读取失败，请稍后重试' } }
        : currentSnapshot([owner])
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

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); await tick() })

    expect(JSON.stringify(renderer.toJSON())).toContain('仍在处理.wav')
    expect(renderedText(renderer.root.findByProps({ role: 'alert' }))).toContain('Audio 上传任务读取失败')
    expect(onAccepted).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await tick() })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.import.list'))
      .toHaveLength(3)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('does not miss calendar refresh when a small accepted import finishes before the first list refresh', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    const onAccepted = vi.fn()
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.list') return currentSnapshot()
      if (operation === 'recordings.import.preflight') return { duplicateFileNames: [] }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingImportDialog
        importPath="/arkme-self/api/recording/import" defaultStartAtMillis={1_725_000_000_000}
        currentUserId={42} onAccepted={onAccepted}
      />)
      await tick()
    })
    await choose([new File(['a'], 'A.m4a', { type: 'audio/mp4' })])

    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })

    expect(mocks.uploadArkmeRecording).toHaveBeenCalledOnce()
    expect(onAccepted).toHaveBeenCalledOnce()
  })

  it('keeps the upload picker usable while locking only rows already committed to the current batch', async () => {
    mocks.uploadArkmeRecording.mockImplementationOnce(async () => await new Promise(() => undefined))
    await choose([
      new File(['a'], 'A.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'B.m4a', { type: 'audio/mp4' }),
    ])

    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })

    expect(renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.disabled).toBe(false)
    expect(renderer.root.findAllByProps({ 'aria-label': '选择 B.m4a' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': 'B.m4a录音开始时间' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '删除 B.m4a' }).props.disabled).toBe(true)
    expect(renderedText(renderer.root)).not.toContain('已选择2个')
    expect(renderer.root.findAllByProps({ 'aria-label': '上传进度 0%' })).toHaveLength(1)
    expect(renderedText(renderer.root.findByProps({ 'aria-label': 'B.m4a数据归属' }).parent!)).toContain('等待中')
    expect(button(renderer, '导入').props.disabled).toBe(true)
    expect(button(renderer, '导入').props.style).toMatchObject({ cursor: 'default' })
    expect(renderer.root.findByProps({ 'aria-label': 'B.m4a数据归属' }).findAllByType('button'))
      .toSatisfy(buttons => buttons.every(ownerButton => ownerButton.props.disabled === true))
    expect(renderer.root.findAllByProps({ 'aria-label': '全选' })).toHaveLength(0)
  })

  it('shows desktop processing details for the active browser upload without marking queued files as uploading', async () => {
    const nowMillis = new Date(2026, 8, 3, 15, 10, 40).getTime()
    vi.useFakeTimers()
    vi.setSystemTime(nowMillis)
    let uploadOptions: {
      signal?: AbortSignal
      onProgress?: (progress: { uploadedBytes: number; totalBytes: number }) => void
    } | undefined
    mocks.uploadArkmeRecording.mockImplementationOnce(async (
      _path: string,
      _file: File,
      _startAtMillis: number,
      _belongUserId: number,
      options: typeof uploadOptions,
    ) => {
      uploadOptions = options
      return await new Promise(() => undefined)
    })
    await choose([
      new File(['abcd'], '正在上传.m4a', { type: 'audio/mp4' }),
      new File(['queued'], '等待上传.m4a', { type: 'audio/mp4' }),
    ])

    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })

    const table = renderer.root.findByProps({ 'aria-label': '待导入录音' })
    const activeRow = table.findAllByProps({ role: 'row' })[1]!
    const queuedRow = table.findAllByProps({ role: 'row' })[2]!
    expect(renderedText(activeRow)).toContain('上传中')
    expect(renderedText(queuedRow)).toContain('等待中')
    expect(activeRow.findByProps({ 'aria-label': '处理耗时 0s' })).toBeDefined()
    expect(queuedRow.findAll(node => typeof node.props?.['aria-label'] === 'string'
      && node.props['aria-label'].startsWith('处理耗时 '))).toHaveLength(0)

    await act(async () => {
      uploadOptions?.onProgress?.({ uploadedBytes: 3, totalBytes: 4 })
      await tick()
    })
    expect(activeRow.findByProps({ 'aria-label': '上传进度 75%' })).toBeDefined()

    await act(async () => {
      activeRow.findByProps({ 'aria-label': '处理耗时 0s' }).props.onClick()
      await tick()
    })
    const details = renderer.root.findByProps({ 'aria-label': '正在上传.m4a处理耗时详情' })
    expect(renderedText(details)).toContain('上传处理中')
    expect(renderedText(details)).toContain('导入未开始')
    expect(renderedText(details)).toContain('人声识别未开始')
    expect(renderedText(details)).toContain('基础转写 · SenseVoice未开始')
    expect(renderedText(details)).toContain('优化转写 · 豆包未开始')

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })
    expect(activeRow.findByProps({ 'aria-label': '处理耗时 2s' })).toBeDefined()
  })

  it('keeps an open processing popover across browser upload, local import and owner handoff', async () => {
    const browserStartedAtMillis = new Date(2026, 8, 3, 15, 10, 40).getTime()
    const localStartedAtMillis = browserStartedAtMillis + 1_000
    const ownerClockOffsetMillis = 60_000
    vi.useFakeTimers()
    vi.setSystemTime(browserStartedAtMillis)
    let resolveUpload!: (value: unknown) => void
    mocks.uploadArkmeRecording.mockImplementationOnce(async () => await new Promise(resolve => { resolveUpload = resolve }))
    let listCalls = 0
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'recordings.import.preflight') return { duplicateFileNames: [] }
      if (operation === 'recordings.import.list') {
        listCalls += 1
        if (listCalls === 1) return currentSnapshot()
        return currentSnapshot([{
          kind: 'owner', taskKey: 'owner-handoff', sessionRef: 'session-opaque',
          fileName: '完整交接.m4a', fileSize: 4, parsedSize: 4,
          durationMillis: 3_000, progress: 1, ownership: 'self',
          createdAtMillis: localStartedAtMillis, updatedAtMillis: localStartedAtMillis + 1_000,
          startAtMillis: browserStartedAtMillis, endAtMillis: browserStartedAtMillis + 3_000,
          status: 'waiting', statusDetail: '等待中',
          localImportTiming: {
            startedAtMillis: localStartedAtMillis,
            acceptedAtMillis: localStartedAtMillis + 1_000,
          },
          importProgress: {
            status: 'processing', totalDurationMillis: 0,
            serverNowMillis: browserStartedAtMillis + ownerClockOffsetMillis + 5_000,
            observedAtMillis: browserStartedAtMillis + 5_000,
            rows: [
              { code: 'upload', status: 'completed', startedAtMillis: localStartedAtMillis + ownerClockOffsetMillis, endedAtMillis: browserStartedAtMillis + ownerClockOffsetMillis + 3_000, durationMillis: 2_000, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: 'continuous', relationDurationMillis: 0 },
              { code: 'import', status: 'processing', startedAtMillis: browserStartedAtMillis + ownerClockOffsetMillis + 3_000, endedAtMillis: 0, durationMillis: 2_000, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: '', relationDurationMillis: 0 },
              { code: 'voice_recognition', status: 'pending', startedAtMillis: 0, endedAtMillis: 0, durationMillis: 0, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: '', relationDurationMillis: 0 },
              { code: 'primary_transcript', status: 'pending', startedAtMillis: 0, endedAtMillis: 0, durationMillis: 0, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: '', relationDurationMillis: 0 },
              { code: 'enhancement_transcript', status: 'pending', startedAtMillis: 0, endedAtMillis: 0, durationMillis: 0, provider: '', model: '', modelVersion: '', modelDurationMillis: 0, nextRelation: 'sidecar', relationDurationMillis: 0 },
            ],
          },
        }])
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    await choose([new File(['abcd'], '完整交接.m4a', { type: 'audio/mp4' })])
    await act(async () => { button(renderer, '导入').props.onClick(); await tick() })
    const activeRow = renderer.root.findByProps({ 'aria-label': '待导入录音' }).findAllByProps({ role: 'row' })[1]!
    await act(async () => {
      activeRow.findByProps({ 'aria-label': '处理耗时 0s' }).props.onClick()
      await tick()
    })
    expect(renderer.root.findByProps({ 'aria-label': '完整交接.m4a处理耗时详情' })).toBeDefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      resolveUpload({
        kind: 'local', importRef: 'opaque-local', revision: 1, phase: 'prepared', ownership: 'self',
        fileName: '完整交接.m4a', fileSize: 4, durationMillis: 3_000, progress: 0,
        startAtMillis: browserStartedAtMillis, endAtMillis: browserStartedAtMillis + 3_000,
        status: 'preparing', statusDetail: '准备中',
        createdAtMillis: localStartedAtMillis, updatedAtMillis: localStartedAtMillis,
      })
      await tick()
      await tick()
    })

    const details = renderer.root.findByProps({ 'aria-label': '完整交接.m4a处理耗时详情' })
    expect(renderedText(details)).toContain('上传已完成')
    expect(renderedText(details)).toContain('导入处理中')
    expect(renderedText(details)).toContain('上传已完成15:11:4115:11:433s')
    expect(renderer.root.findByProps({ 'aria-label': '处理耗时 5s' })).toBeDefined()
    expect(listCalls).toBeGreaterThanOrEqual(2)
  })

  it('allows closing the dialog through the desktop Escape path while upload continues', async () => {
    await act(async () => { renderer.unmount(); await tick() })
    const close = vi.fn()
    let uploadSignal: AbortSignal | undefined
    mocks.uploadArkmeRecording.mockImplementationOnce(async (
      _path: string,
      _file: File,
      _startAtMillis: number,
      _belongUserId: number,
      options: { signal?: AbortSignal },
    ) => {
      uploadSignal = options.signal
      return await new Promise(() => undefined)
    })
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
    expect(JSON.stringify(renderer.toJSON())).not.toContain('停止上传')
    await act(async () => {
      renderer.root.findByType('dialog').props.onCancel({ preventDefault: vi.fn() })
      await tick()
    })
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.uploadArkmeRecording).toHaveBeenCalledOnce()
    expect(uploadSignal?.aborted).toBe(false)
  })

  it('locks submission behind the add-time duplicate check and aborts it when the account owner unmounts', async () => {
    let preflightSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementation(async (operation, _params, signal?: AbortSignal) => {
      if (operation === 'recordings.import.list') return currentSnapshot()
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
    expect(renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.disabled).toBe(false)
    await act(async () => { renderer.unmount(); await tick() })
    expect(preflightSignal?.aborted).toBe(true)
  })
})
