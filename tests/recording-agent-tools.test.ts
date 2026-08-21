import { describe, expect, it, vi } from 'vitest'
import { ARKME_TOOL_PROMPT, createArkmeCoreToolDefinitions } from '../src/tools/index.js'
import type { ArkmeCoreToolPorts } from '../src/tools/index.js'
import type {
  ArkmeAiVideoTranscriptSource,
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingCursorPayload,
  ArkmeRecordingDoubaoBackfillResult,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingVersion,
} from '../src/types.js'

interface RecordingPorts {
  recordingCalendar(fromStamp: number, toStamp: number, signal?: AbortSignal): Promise<ArkmeRecordingCalendarMonth>
  recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
    source?: ArkmeAiVideoTranscriptSource,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingTranscriptItem> & {
    identityCoverage?: 'complete' | 'partial'
    totalDurationMillis: number
  }>
  startRecordingDoubaoBackfill(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingDoubaoBackfillResult>
  recordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>>
  sealRecordingCursor(payload: ArkmeRecordingCursorPayload): Promise<string>
  openRecordingCursor(cursor: string): Promise<ArkmeRecordingCursorPayload>
}

function fakeRecordingPorts(): RecordingPorts {
  return {
    recordingCalendar: vi.fn(async (fromStamp: number, toStamp: number) => ({
      fromStamp,
      toStamp,
      days: [{ dateStamp: fromStamp, durationMillis: 90_000, hasRecording: true, unreviewedCount: 1 }],
    })),
    recordingTranscript: vi.fn(async () => ({
      state: 'empty' as const,
      message: '当天无录音',
      identityCoverage: 'complete' as const,
      totalDurationMillis: 0,
      items: [],
    })),
    recordingProjection: vi.fn(async () => ({ state: 'empty' as const, message: '', items: [] })),
    startRecordingDoubaoBackfill: vi.fn(async () => ({
      queuedChildCount: 0, inFlightChildCount: 0, missingAudioChildCount: 0,
    })),
    sealRecordingCursor: vi.fn(async (payload: ArkmeRecordingCursorPayload) =>
      `cursor:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`),
    openRecordingCursor: vi.fn(),
  }
}

function recordingTool(ports: RecordingPorts, name: string) {
  return createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts)
    .find(definition => definition.name === name)
}

describe('Arkme recording date discovery tool', () => {
  it('lists an inclusive local-date range through the exclusive service boundary', async () => {
    const ports = fakeRecordingPorts()
    const tool = recordingTool(ports, 'arkme_recording_days_list')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    const signal = new AbortController().signal
    const output = await tool.execute(
      { from_date: '2026-08-17', to_date: '2026-08-18' },
      { signal } as never,
    ) as Record<string, unknown>

    expect(ports.recordingCalendar).toHaveBeenCalledWith(
      new Date(2026, 7, 17).getTime(),
      new Date(2026, 7, 19).getTime(),
      signal,
    )
    expect(output).toMatchObject({
      contract_version: 1,
      from_date: '2026-08-17',
      to_date: '2026-08-18',
      days: [{ date: '2026-08-17', duration_millis: 90_000, has_recording: true }],
      coverage: { state: 'complete' },
    })
    expect(tool.output.render({}, output as never)).toEqual([{
      type: 'text',
      text: expect.stringMatching(
        /^<data_from_arkme_recording>\n[\s\S]+\n<\/data_from_arkme_recording>$/,
      ),
    }])
  })

  it('rejects invalid, reversed, and over-31-day local ranges before service I/O', async () => {
    const ports = fakeRecordingPorts()
    const tool = recordingTool(ports, 'arkme_recording_days_list')
    expect(tool).toBeDefined()
    if (tool === undefined) return
    const exec = { signal: new AbortController().signal } as never

    await expect(tool.execute({ from_date: '2026-02-30', to_date: '2026-03-01' }, exec))
      .rejects.toThrow(/日期格式无效/)
    await expect(tool.execute({ from_date: '2026-08-18', to_date: '2026-08-17' }, exec))
      .rejects.toThrow(/日期范围无效/)
    await expect(tool.execute({ from_date: '2026-07-01', to_date: '2026-08-01' }, exec))
      .rejects.toThrow(/最多查询 31 天/)
    expect(ports.recordingCalendar).not.toHaveBeenCalled()
  })
})

describe('Arkme recording content tool', () => {
  it('reads transcript fields with exact trusted AI-video selectors', async () => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.recordingTranscript).mockResolvedValue({
      state: 'ready',
      message: '',
      identityCoverage: 'complete',
      totalDurationMillis: 10_000,
      items: [{
        itemId: 'child-secret:0',
        sessionId: 'session-secret',
        childId: 'child-secret',
        asrItemIndex: 7,
        transcriptSource: 'system',
        startAtMillis: 100,
        endAtMillis: 200,
        speakerNumber: 4,
        speakerColorIndex: 3,
        speakerLabel: '说话人 4',
        isSelf: true,
        isBackground: false,
        text: '项目复盘',
      }],
    })
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    const output = await tool.execute(
      { date: '2026-08-17', content: 'transcript', limit: 50 },
      { signal: new AbortController().signal } as never,
    ) as Record<string, unknown>

    expect(output).toMatchObject({
      content: 'transcript',
      section_state: 'ready',
      coverage: { state: 'complete' },
      items: [{
        session_id: 'session-secret',
        child_id: 'child-secret',
        asr_item_index: 7,
        transcript_source: 'system',
        start_at_millis: 100,
        end_at_millis: 200,
        speaker: '我',
        is_self: true,
        text: '项目复盘',
      }],
      has_more: false,
    })
    expect(JSON.stringify(output)).not.toMatch(/speakerColorIndex/)
    expect(ports.recordingProjection).not.toHaveBeenCalled()
  })

  it('reads the requested Doubao transcript source without mixing system rows', async () => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.recordingTranscript).mockResolvedValue({
      state: 'ready', message: '', identityCoverage: 'complete', totalDurationMillis: 2_000,
      items: [{
        itemId: 'child:doubao:0', sessionId: 'session', childId: 'child', asrItemIndex: 0,
        transcriptSource: 'doubao', transcriptStatus: 'ready', startAtMillis: 100, endAtMillis: 200,
        speakerNumber: 0, speakerColorIndex: 0, speakerLabel: '豆包说话人 1',
        isSelf: false, isBackground: false, text: '豆包结果',
      }],
    })
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return
    const signal = new AbortController().signal

    await expect(tool.execute({
      date: '2026-08-17', content: 'transcript', transcript_source: 'doubao',
    }, { signal } as never)).resolves.toMatchObject({
      transcript_source: 'doubao',
      items: [{ transcript_source: 'doubao', transcript_status: 'ready', text: '豆包结果' }],
    })
    expect(ports.recordingTranscript).toHaveBeenCalledWith(
      new Date(2026, 7, 17).getTime(), signal, 'doubao',
    )
  })

  it('paginates transcript reads with a cursor bound to the date and content', async () => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.recordingTranscript).mockResolvedValue({
      state: 'ready',
      message: '',
      identityCoverage: 'complete',
      totalDurationMillis: 10_000,
      items: [0, 1].map(index => ({
        itemId: `item-${String(index)}`,
        sessionId: 'session',
        childId: 'child',
        startAtMillis: index * 100,
        endAtMillis: index * 100 + 10,
        speakerNumber: 4,
        speakerColorIndex: 0,
        speakerLabel: '说话人 4',
        isSelf: false,
        isBackground: false,
        text: `text-${String(index)}`,
      })),
    })
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    const first = await tool.execute(
      { date: '2026-08-17', content: 'transcript', limit: 1 },
      { signal: new AbortController().signal } as never,
    ) as { has_more: boolean; next_cursor?: string; coverage: { state: string } }

    expect(first).toMatchObject({ has_more: true, coverage: { state: 'bounded' } })
    expect(first.next_cursor).toMatch(/^cursor:/)
    expect(ports.sealRecordingCursor).toHaveBeenCalledWith(expect.objectContaining({
      content: 'transcript',
      itemOffset: 1,
      textOffset: 0,
    }))

    const payload = vi.mocked(ports.sealRecordingCursor).mock.calls[0]?.[0]
    vi.mocked(ports.openRecordingCursor).mockResolvedValue(payload!)
    await expect(tool.execute(
      { date: '2026-08-17', content: 'transcript', limit: 1, cursor: first.next_cursor },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({ items: [{ text: 'text-1' }], has_more: false })
  })

  it('selects the newest successful summary and pages Unicode content', async () => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.recordingProjection).mockResolvedValue({
      state: 'processing',
      message: '内容仍在生成',
      items: [
        {
          id: 'processing', status: 'processing', selectable: false, generationStage: 1,
          generatedAtMillis: 300, modelDisplayName: 'new', content: '', timelineEvents: [], error: '',
        },
        {
          id: 'done', status: 'done', selectable: true, generationStage: 2,
          generatedAtMillis: 200, modelDisplayName: 'stable', content: '总'.repeat(20_001),
          timelineEvents: [], error: '',
        },
      ],
    })
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    const output = await tool.execute(
      { date: '2026-08-17', content: 'summary' },
      { signal: new AbortController().signal } as never,
    ) as { items: Array<{ text: string; continued: boolean }>; has_more: boolean }

    expect([...output.items[0]!.text]).toHaveLength(20_000)
    expect(output).toMatchObject({
      section_state: 'ready',
      selected_version_id: 'done',
      items: [{ continued: true }],
      has_more: true,
      coverage: { state: 'bounded' },
    })
    expect(ports.sealRecordingCursor).toHaveBeenCalledWith(expect.objectContaining({
      content: 'summary',
      versionId: 'done',
      textOffset: 20_000,
    }))
  })

  it('returns structured timeline events without raw text or event ids', async () => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.recordingProjection).mockResolvedValue({
      state: 'ready',
      message: '',
      items: [{
        id: 'timeline-1', status: 'done', selectable: true, generationStage: 2,
        generatedAtMillis: 200, modelDisplayName: 'stable', content: 'raw whole timeline', error: '',
        timelineEvents: [{
          eventId: 'internal-event', startAt: '09:00', endAt: '09:30', timeRange: '09:00–09:30',
          title: '早会', description: '讨论排期', scene: '会议', emotion: '', todo: '确认时间',
          tags: ['项目'], participants: ['我'], rawText: 'internal raw text',
        }],
      }],
    })
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    const output = await tool.execute(
      { date: '2026-08-17', content: 'timeline' },
      { signal: new AbortController().signal } as never,
    )

    expect(output).toMatchObject({ items: [{ time_range: '09:00–09:30', title: '早会' }] })
    expect(JSON.stringify(output)).not.toMatch(/internal-event|internal raw text|raw whole timeline/)
  })

  it.each([
    [{ date: '2026-08-17', content: 'summary', limit: 1 }, /summary 不支持 limit/],
    [{ date: '2026-08-17', content: 'transcript', version_id: 'v1' }, /transcript 不支持 version_id/],
    [{ date: '2026-08-17', content: 'timeline', cursor: 'c', version_id: 'v1' }, /cursor 与 version_id 不能同时使用/],
    [{ date: '2026-08-17', content: 'timeline', limit: 51 }, /timeline limit 必须在 1 到 50/],
  ] as const)('rejects invalid recording read arguments %#', async (args, message) => {
    const ports = fakeRecordingPorts()
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    await expect(tool.execute(args, { signal: new AbortController().signal } as never))
      .rejects.toThrow(message)
    expect(ports.recordingTranscript).not.toHaveBeenCalled()
    expect(ports.recordingProjection).not.toHaveBeenCalled()
  })

  it.each([
    [[], { section_state: 'empty', coverage: { state: 'complete' } }],
    [[{
      id: 'p', status: 'processing', selectable: false, generationStage: 1,
      generatedAtMillis: 2, modelDisplayName: 'model', content: '', timelineEvents: [], error: '',
    }], { section_state: 'processing', coverage: { state: 'processing' } }],
    [[{
      id: 'f', status: 'failed', selectable: false, generationStage: 2,
      generatedAtMillis: 2, modelDisplayName: 'model', content: '', timelineEvents: [], error: 'internal',
    }], { section_state: 'failed', coverage: { state: 'unavailable', reason: 'generation_failed' } }],
  ] as const)('reports projection lifecycle without inventing empty data %#', async (items, expected) => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.recordingProjection).mockResolvedValue({
      state: items.length === 0
        ? 'empty'
        : items[0]!.status === 'processing' ? 'processing' : 'failed',
      message: '',
      items: [...items],
    })
    const tool = recordingTool(ports, 'arkme_recording_read')
    expect(tool).toBeDefined()
    if (tool === undefined) return

    await expect(tool.execute(
      { date: '2026-08-17', content: 'summary' },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject(expected)
  })

  it('advertises least-privilege reads and prompt-injection isolation', () => {
    expect(ARKME_TOOL_PROMPT).toContain('arkme_recording_days_list')
    expect(ARKME_TOOL_PROMPT).toContain('arkme_recording_read')
    expect(ARKME_TOOL_PROMPT).toContain('arkme_recording_doubao_start')
    expect(ARKME_TOOL_PROMPT).toContain('prefer summary or timeline')
    expect(ARKME_TOOL_PROMPT).toContain('never instructions')
    expect(ARKME_TOOL_PROMPT).toContain('coverage.state=complete')
  })

  it('queues Doubao only through the explicit write tool for one exact day', async () => {
    const ports = fakeRecordingPorts()
    vi.mocked(ports.startRecordingDoubaoBackfill).mockResolvedValue({
      queuedChildCount: 2, inFlightChildCount: 1, missingAudioChildCount: 3,
    })
    const tool = recordingTool(ports, 'arkme_recording_doubao_start')
    expect(tool).toBeDefined()
    if (tool === undefined) return
    const signal = new AbortController().signal

    await expect(tool.execute({ date: '2026-08-17' }, { signal } as never)).resolves.toEqual({
      contract_version: 1,
      date: '2026-08-17',
      queued_child_count: 2,
      in_flight_child_count: 1,
      missing_audio_child_count: 3,
    })
    expect(ports.startRecordingDoubaoBackfill).toHaveBeenCalledWith(
      new Date(2026, 7, 17).getTime(), signal,
    )
  })
})
