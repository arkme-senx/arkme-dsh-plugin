import { describe, expect, it, vi } from 'vitest'
import {
  createJotmoRecordingToolDefinitions,
  parseRecordingLocalDate,
  type JotmoRecordingReadService,
} from '../src/recording-tools.js'
import type { JotmoRecordingCursorPayload } from '../src/types.js'

function fakeRecordingService(): JotmoRecordingReadService {
  return {
    recordingCalendar: vi.fn(async (fromStamp: number, toStamp: number) => ({
      fromStamp,
      toStamp,
      days: [{ dateStamp: fromStamp, durationMillis: 90_000, hasRecording: true, unreviewedCount: 1 }],
    })),
    recordingTranscript: vi.fn(),
    recordingProjection: vi.fn(),
    sealRecordingCursor: vi.fn(async (payload: JotmoRecordingCursorPayload) =>
      `cursor:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`),
    openRecordingCursor: vi.fn(),
  }
}

describe('recording tool dates', () => {
  it('parses a strict local calendar date without rollover', () => {
    expect(parseRecordingLocalDate('2026-08-17')).toMatchObject({
      date: '2026-08-17',
      timezoneOffsetMinutes: -new Date(2026, 7, 17).getTimezoneOffset(),
    })
    expect(() => parseRecordingLocalDate('2026-02-30')).toThrow(/日期格式无效/)
    expect(() => parseRecordingLocalDate('2026-8-7')).toThrow(/日期格式无效/)
  })

  it('lists an inclusive local-date range through the exclusive service boundary', async () => {
    const service = fakeRecordingService()
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_days_list')!
    const output = await tool.execute(
      { from_date: '2026-08-17', to_date: '2026-08-18' },
      { signal: new AbortController().signal } as never,
    ) as Record<string, unknown>

    expect(service.recordingCalendar).toHaveBeenCalledWith(
      new Date(2026, 7, 17).getTime(),
      new Date(2026, 7, 19).getTime(),
      expect.any(AbortSignal),
    )
    expect(output).toMatchObject({
      contract_version: 1,
      from_date: '2026-08-17',
      to_date: '2026-08-18',
      days: [{ date: '2026-08-17', duration_millis: 90_000, has_recording: true }],
      coverage: { state: 'complete' },
    })
    const rendered = tool.output.render(
      { from_date: '2026-08-17', to_date: '2026-08-18' },
      output as never,
    )
    expect(rendered).toEqual([{ type: 'text', text: expect.stringMatching(
      /^<data_from_jotmo_recording>\n[\s\S]+\n<\/data_from_jotmo_recording>$/,
    ) }])
  })

  it('rejects reversed and over-31-day ranges before service I/O', async () => {
    const service = fakeRecordingService()
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_days_list')!
    const exec = { signal: new AbortController().signal } as never

    await expect(tool.execute({ from_date: '2026-08-18', to_date: '2026-08-17' }, exec))
      .rejects.toThrow(/日期范围无效/)
    await expect(tool.execute({ from_date: '2026-07-01', to_date: '2026-08-01' }, exec))
      .rejects.toThrow(/最多查询 31 天/)
    expect(service.recordingCalendar).not.toHaveBeenCalled()
  })
})

describe('recording transcript reads', () => {
  it('reads only transcript content and removes UI and resource identifiers', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingTranscript).mockResolvedValue({
      state: 'ready',
      message: '',
      identityCoverage: 'complete',
      totalDurationMillis: 10_000,
      items: [{
        itemId: 'child-secret:0',
        sessionId: 'session-secret',
        childId: 'child-secret',
        startAtMillis: 100,
        endAtMillis: 200,
        speakerNumber: 1,
        speakerColorIndex: 3,
        speakerLabel: '说话人 1',
        isSelf: true,
        isBackground: false,
        text: '项目复盘',
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!
    const output = await tool.execute(
      { date: '2026-08-17', content: 'transcript', limit: 50 },
      { signal: new AbortController().signal } as never,
    ) as Record<string, unknown>

    expect(output).toMatchObject({
      content: 'transcript',
      section_state: 'ready',
      coverage: { state: 'complete' },
      items: [{
        start_at_millis: 100,
        end_at_millis: 200,
        speaker: '我',
        text: '项目复盘',
      }],
      has_more: false,
    })
    expect(JSON.stringify(output)).not.toMatch(/child-secret|session-secret|speakerColorIndex/)
    expect(service.recordingProjection).not.toHaveBeenCalled()
  })

  it('returns a signed cursor when transcript item limit is reached', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingTranscript).mockResolvedValue({
      state: 'ready',
      message: '',
      identityCoverage: 'complete',
      totalDurationMillis: 10_000,
      items: [0, 1].map(index => ({
        itemId: `item-${index}`,
        sessionId: 'session',
        childId: 'child',
        startAtMillis: index * 100,
        endAtMillis: index * 100 + 10,
        speakerNumber: 1,
        speakerColorIndex: 0,
        speakerLabel: '说话人 1',
        isSelf: false,
        isBackground: false,
        text: `text-${index}`,
      })),
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!
    const output = await tool.execute(
      { date: '2026-08-17', content: 'transcript', limit: 1 },
      { signal: new AbortController().signal } as never,
    ) as { has_more: boolean; next_cursor?: string; coverage: { state: string } }

    expect(output).toMatchObject({ has_more: true, coverage: { state: 'bounded' } })
    expect(output.next_cursor).toMatch(/^cursor:/)
    expect(service.sealRecordingCursor).toHaveBeenCalledWith(expect.objectContaining({
      content: 'transcript',
      itemOffset: 1,
      textOffset: 0,
    }))
  })

  it('returns source_changed when a continued transcript fingerprint changes', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.openRecordingCursor).mockResolvedValue({
      version: 1,
      dateStamp: new Date(2026, 7, 17).getTime(),
      content: 'transcript',
      itemOffset: 1,
      textOffset: 0,
      fingerprint: 'old-fingerprint',
    })
    vi.mocked(service.recordingTranscript).mockResolvedValue({
      state: 'ready',
      message: '',
      identityCoverage: 'complete',
      totalDurationMillis: 1,
      items: [{
        itemId: 'changed',
        sessionId: 's',
        childId: 'c',
        startAtMillis: 1,
        endAtMillis: 2,
        speakerNumber: 1,
        speakerColorIndex: 0,
        speakerLabel: '说话人 1',
        isSelf: false,
        isBackground: false,
        text: 'changed',
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'transcript', cursor: 'cursor-value' },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({
      items: [],
      has_more: false,
      coverage: { state: 'source_changed', reason: 'recording_projection_changed' },
    })
  })

  it('rejects a cursor bound to another date or content before reading recording data', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.openRecordingCursor).mockResolvedValue({
      version: 1,
      dateStamp: new Date(2026, 7, 16).getTime(),
      content: 'summary',
      versionId: 'summary-1',
      itemOffset: 0,
      textOffset: 0,
      fingerprint: 'fingerprint',
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'transcript', cursor: 'cursor-value' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/游标与当前日期或内容类型不匹配/)
    expect(service.recordingTranscript).not.toHaveBeenCalled()
    expect(service.recordingProjection).not.toHaveBeenCalled()
  })

  it('skips an oversized transcript item and reports partial coverage', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingTranscript).mockResolvedValue({
      state: 'ready',
      message: '',
      identityCoverage: 'complete',
      totalDurationMillis: 1,
      items: [{
        itemId: 'large',
        sessionId: 's',
        childId: 'c',
        startAtMillis: 1,
        endAtMillis: 2,
        speakerNumber: 1,
        speakerColorIndex: 0,
        speakerLabel: '说话人 1',
        isSelf: false,
        isBackground: false,
        text: '录'.repeat(20_001),
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'transcript' },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({
      items: [],
      has_more: false,
      coverage: { state: 'partial', unavailable_count: 1 },
    })
  })

  it('rejects an invalid transcript limit before cursor or recording I/O', async () => {
    const service = fakeRecordingService()
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'transcript', limit: 101, cursor: 'cursor-value' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/1–100 的整数/)
    expect(service.openRecordingCursor).not.toHaveBeenCalled()
    expect(service.recordingTranscript).not.toHaveBeenCalled()
  })
})

describe('recording projection reads', () => {
  it('selects the newest completed summary and returns safe version metadata', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
      state: 'processing',
      message: '内容仍在生成',
      items: [
        {
          id: 'processing', status: 'processing', selectable: false, generationStage: 1,
          generatedAtMillis: 300, modelDisplayName: 'new', content: '', timelineEvents: [], error: '',
        },
        {
          id: 'done', status: 'done', selectable: true, generationStage: 2,
          generatedAtMillis: 200, modelDisplayName: 'stable', content: '完成总结', timelineEvents: [], error: '',
        },
      ],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'summary' },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({
      section_state: 'ready',
      coverage: { state: 'complete' },
      selected_version_id: 'done',
      available_versions: [
        { version_id: 'processing', status: 'processing', selectable: false },
        { version_id: 'done', status: 'done', selectable: true },
      ],
      items: [{ projection_id: 'done', text: '完成总结', continued: false }],
    })
  })

  it('splits a long summary by Unicode code points and binds the selected version in the cursor', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
      state: 'ready',
      message: '',
      items: [{
        id: 'summary-1', status: 'done', selectable: true, generationStage: 2,
        generatedAtMillis: 200, modelDisplayName: 'stable', content: '总'.repeat(20_001),
        timelineEvents: [], error: '',
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!
    const output = await tool.execute(
      { date: '2026-08-17', content: 'summary' },
      { signal: new AbortController().signal } as never,
    ) as { items: Array<{ text: string; continued: boolean }>; has_more: boolean }

    expect([...output.items[0]!.text]).toHaveLength(20_000)
    expect(output).toMatchObject({ items: [{ continued: true }], has_more: true })
    expect(service.sealRecordingCursor).toHaveBeenCalledWith(expect.objectContaining({
      content: 'summary',
      versionId: 'summary-1',
      itemOffset: 0,
      textOffset: 20_000,
    }))
  })

  it('returns only structured timeline events without raw text or event ids', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
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
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!
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
  ] as const)('rejects invalid recording read args %#', async (args, message) => {
    const service = fakeRecordingService()
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(args, { signal: new AbortController().signal } as never))
      .rejects.toThrow(message)
    expect(service.recordingTranscript).not.toHaveBeenCalled()
    expect(service.recordingProjection).not.toHaveBeenCalled()
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
  ] as const)('projects summary lifecycle without inventing empty data %#', async (items, expected) => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
      state: items.length === 0
        ? 'empty'
        : items[0]!.status === 'processing' ? 'processing' : 'failed',
      message: '',
      items: [...items],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'summary' },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject(expected)
  })

  it('rejects an unavailable requested projection version instead of falling back', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
      state: 'ready',
      message: '',
      items: [{
        id: 'done', status: 'done', selectable: true, generationStage: 2,
        generatedAtMillis: 2, modelDisplayName: 'model', content: '完成总结', timelineEvents: [], error: '',
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!

    await expect(tool.execute(
      { date: '2026-08-17', content: 'summary', version_id: 'missing' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/指定的录音内容版本不存在或不可读取/)
  })

  it('continues a summary from the signed Unicode offset on the same version', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
      state: 'ready',
      message: '',
      items: [{
        id: 'summary-1', status: 'done', selectable: true, generationStage: 2,
        generatedAtMillis: 200, modelDisplayName: 'stable', content: `${'总'.repeat(20_000)}结`,
        timelineEvents: [], error: '',
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!
    const first = await tool.execute(
      { date: '2026-08-17', content: 'summary' },
      { signal: new AbortController().signal } as never,
    ) as { next_cursor: string }
    const cursorPayload = vi.mocked(service.sealRecordingCursor).mock.calls[0]?.[0]
    expect(cursorPayload).toMatchObject({ versionId: 'summary-1', textOffset: 20_000 })
    vi.mocked(service.openRecordingCursor).mockResolvedValue(cursorPayload!)

    await expect(tool.execute(
      { date: '2026-08-17', content: 'summary', cursor: first.next_cursor },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({
      selected_version_id: 'summary-1',
      items: [{ text: '结', continued: false }],
      has_more: false,
      coverage: { state: 'complete' },
    })
  })

  it('continues timeline events from a cursor bound to the selected version', async () => {
    const service = fakeRecordingService()
    vi.mocked(service.recordingProjection).mockResolvedValue({
      state: 'ready',
      message: '',
      items: [{
        id: 'timeline-1', status: 'done', selectable: true, generationStage: 2,
        generatedAtMillis: 200, modelDisplayName: 'stable', content: 'raw', error: '',
        timelineEvents: [0, 1].map(index => ({
          eventId: `internal-${index}`,
          startAt: `0${String(9 + index)}:00`,
          endAt: `0${String(9 + index)}:30`,
          timeRange: `0${String(9 + index)}:00–0${String(9 + index)}:30`,
          title: `事件 ${String(index)}`,
          description: '',
          scene: '',
          emotion: '',
          todo: '',
          tags: [],
          participants: [],
          rawText: 'internal',
        })),
      }],
    })
    const tool = createJotmoRecordingToolDefinitions(service)
      .find(definition => definition.name === 'jotmo_recording_read')!
    const first = await tool.execute(
      { date: '2026-08-17', content: 'timeline', limit: 1 },
      { signal: new AbortController().signal } as never,
    ) as { next_cursor: string }
    const cursorPayload = vi.mocked(service.sealRecordingCursor).mock.calls[0]?.[0]
    expect(cursorPayload).toMatchObject({ versionId: 'timeline-1', itemOffset: 1 })
    vi.mocked(service.openRecordingCursor).mockResolvedValue(cursorPayload!)

    await expect(tool.execute(
      { date: '2026-08-17', content: 'timeline', limit: 1, cursor: first.next_cursor },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({
      selected_version_id: 'timeline-1',
      items: [{ title: '事件 1' }],
      has_more: false,
      coverage: { state: 'complete' },
    })
  })
})
