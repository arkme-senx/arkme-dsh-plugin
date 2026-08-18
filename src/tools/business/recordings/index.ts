import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  ArkmeRecordingCursorPayload,
  ArkmeRecordingTimelineEvent,
  ArkmeRecordingToolContent,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingVersion,
  ArkmeRecordingSection,
} from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import type { ArkmeRecordingToolPort } from '../../ports/recordings.js'

const RECORDING_TEXT_BUDGET = 20_000

interface ArkmeRecordingLocalDate {
  date: string
  dateStamp: number
  timezone: string
  timezoneOffsetMinutes: number
}

interface RecordingReadArgs {
  date: string
  content: ArkmeRecordingToolContent
  limit?: number
  cursor?: string
  version_id?: string
}

export function parseRecordingLocalDate(value: string): ArkmeRecordingLocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) throw new Error('日期格式无效，必须使用 YYYY-MM-DD')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const local = new Date(year, month - 1, day)
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day
    || local.getHours() !== 0 || local.getMinutes() !== 0) {
    throw new Error('日期格式无效，必须是真实的本地自然日')
  }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    dateStamp: local.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    timezoneOffsetMinutes: -local.getTimezoneOffset(),
  }
}

function formatLocalDate(stamp: number): string {
  const date = new Date(stamp)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function inclusiveRange(
  from: ArkmeRecordingLocalDate,
  to: ArkmeRecordingLocalDate,
): { toExclusive: number; count: number } {
  if (from.dateStamp > to.dateStamp) throw new Error('日期范围无效：from_date 不能晚于 to_date')
  const cursor = new Date(from.dateStamp)
  let count = 0
  while (cursor.getTime() <= to.dateStamp && count <= 31) {
    count += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  if (count > 31) throw new Error('录音日期范围最多查询 31 天')
  return { toExclusive: cursor.getTime(), count }
}

function codePointLength(value: string): number {
  return [...value].length
}

function recordingFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function transcriptModelItem(item: ArkmeRecordingTranscriptItem) {
  return {
    start_at_millis: item.startAtMillis,
    end_at_millis: item.endAtMillis,
    speaker: item.isSelf ? '我' : item.speakerLabel,
    is_self: item.isSelf,
    is_background: item.isBackground,
    text: item.text,
  }
}

function assertCursorScope(
  cursor: ArkmeRecordingCursorPayload,
  dateStamp: number,
  content: ArkmeRecordingToolContent,
): void {
  if (cursor.dateStamp !== dateStamp || cursor.content !== content) {
    throw new Error('录音分页游标与当前日期或内容类型不匹配')
  }
}

function boundedTranscriptLimit(value: number | undefined): number {
  if (value === undefined) return 50
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error('limit 必须是 1–100 的整数')
  }
  return value
}

function boundedTimelineLimit(value: number | undefined): number {
  if (value === undefined) return 20
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error('timeline limit 必须在 1 到 50 之间且为整数')
  }
  return value
}

function validateRecordingReadArgs(args: RecordingReadArgs): number | undefined {
  if (args.cursor !== undefined && args.version_id !== undefined) {
    throw new Error('cursor 与 version_id 不能同时使用')
  }
  if (args.version_id !== undefined && args.version_id.trim() === '') {
    throw new Error('version_id 不能为空')
  }
  if (args.content === 'transcript') {
    if (args.version_id !== undefined) throw new Error('transcript 不支持 version_id')
    return boundedTranscriptLimit(args.limit)
  }
  if (args.content === 'summary') {
    if (args.limit !== undefined) throw new Error('summary 不支持 limit')
    return undefined
  }
  return boundedTimelineLimit(args.limit)
}

function safeVersions(items: ArkmeRecordingVersion[]) {
  return items.map(version => ({
    version_id: version.id,
    status: version.status,
    generated_at_millis: version.generatedAtMillis,
    model_display_name: version.modelDisplayName,
    selectable: version.selectable,
  }))
}

function selectCompletedVersion(
  items: ArkmeRecordingVersion[],
  requested?: string,
): ArkmeRecordingVersion | undefined {
  if (requested !== undefined) {
    const selected = items.find(item => item.id === requested)
    if (selected === undefined || !selected.selectable || selected.status !== 'done') {
      throw new Error('指定的录音内容版本不存在或不可读取')
    }
    return selected
  }
  return items.find(item => item.status === 'done' && item.selectable)
}

function timelineModelItem(item: ArkmeRecordingTimelineEvent) {
  return {
    time_range: item.timeRange,
    title: item.title,
    description: item.description,
    scene: item.scene,
    emotion: item.emotion,
    todo: item.todo,
    tags: item.tags,
    participants: item.participants,
  }
}

function timelineModelItemLength(item: ReturnType<typeof timelineModelItem>): number {
  return [
    item.time_range,
    item.title,
    item.description,
    item.scene,
    item.emotion,
    item.todo,
    ...item.tags,
    ...item.participants,
  ].reduce((total, value) => total + codePointLength(value), 0)
}

const DAYS_OUTPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    contract_version: { type: 'integer' as const, required: true, const: 1 },
    from_date: { type: 'string' as const, required: true },
    to_date: { type: 'string' as const, required: true },
    timezone: { type: 'string' as const, required: true },
    timezone_offset_minutes: { type: 'integer' as const, required: true },
    days: {
      type: 'array' as const,
      required: true,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          date: { type: 'string' as const, required: true },
          duration_millis: { type: 'integer' as const, required: true },
          has_recording: { type: 'boolean' as const, required: true },
          unreviewed_count: { type: 'integer' as const, required: true },
        },
      },
    },
    coverage: {
      type: 'object' as const,
      required: true,
      additionalProperties: false,
      properties: { state: { type: 'string' as const, required: true, const: 'complete' } },
    },
  },
} as const

const READ_BASE_PROPERTIES = {
  contract_version: { type: 'integer', required: true, const: 1 },
  date: { type: 'string', required: true },
  timezone: { type: 'string', required: true },
  timezone_offset_minutes: { type: 'integer', required: true },
  section_state: {
    type: 'string',
    required: true,
    enum: ['ready', 'empty', 'processing', 'failed', 'error'],
  },
  coverage: {
    type: 'object',
    required: true,
    additionalProperties: false,
    properties: {
      state: {
        type: 'string',
        required: true,
        enum: ['complete', 'bounded', 'processing', 'partial', 'unavailable', 'source_changed'],
      },
      reason: { type: 'string' },
      ready_count: { type: 'integer' },
      unavailable_count: { type: 'integer' },
    },
  },
  has_more: { type: 'boolean', required: true },
  next_cursor: { type: 'string' },
} as const

const AVAILABLE_VERSIONS_PROPERTY = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      version_id: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: ['processing', 'done', 'failed'] },
      generated_at_millis: { type: 'integer', required: true },
      model_display_name: { type: 'string', required: true },
      selectable: { type: 'boolean', required: true },
    },
  },
} as const

const TRANSCRIPT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...READ_BASE_PROPERTIES,
    content: { type: 'string', required: true, const: 'transcript' },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          start_at_millis: { type: 'integer', required: true },
          end_at_millis: { type: 'integer', required: true },
          speaker: { type: 'string', required: true },
          is_self: { type: 'boolean', required: true },
          is_background: { type: 'boolean', required: true },
          text: { type: 'string', required: true },
        },
      },
    },
  },
} as const

const SUMMARY_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...READ_BASE_PROPERTIES,
    content: { type: 'string', required: true, const: 'summary' },
    selected_version_id: { type: 'string' },
    available_versions: AVAILABLE_VERSIONS_PROPERTY,
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projection_id: { type: 'string', required: true },
          generated_at_millis: { type: 'integer', required: true },
          model_display_name: { type: 'string', required: true },
          text: { type: 'string', required: true },
          continued: { type: 'boolean', required: true },
        },
      },
    },
  },
} as const

const TIMELINE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...READ_BASE_PROPERTIES,
    content: { type: 'string', required: true, const: 'timeline' },
    selected_version_id: { type: 'string' },
    available_versions: AVAILABLE_VERSIONS_PROPERTY,
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          time_range: { type: 'string', required: true },
          title: { type: 'string', required: true },
          description: { type: 'string', required: true },
          scene: { type: 'string', required: true },
          emotion: { type: 'string', required: true },
          todo: { type: 'string', required: true },
          tags: { type: 'array', required: true, items: { type: 'string' } },
          participants: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
  },
} as const

const READ_OUTPUT_SCHEMA = {
  oneOf: [TRANSCRIPT_OUTPUT_SCHEMA, SUMMARY_OUTPUT_SCHEMA, TIMELINE_OUTPUT_SCHEMA],
} as const

function renderRecordingData(_args: unknown, value: unknown) {
  return [{
    type: 'text' as const,
    text: `<data_from_arkme_recording>\n${JSON.stringify(value, undefined, 2)}\n</data_from_arkme_recording>`,
  }]
}

async function readTranscriptPage(
  ports: ArkmeRecordingToolPort,
  localDate: ArkmeRecordingLocalDate,
  continued: ArkmeRecordingCursorPayload | undefined,
  limit: number,
  signal: AbortSignal,
) {
  const section = await ports.recordingTranscript(localDate.dateStamp, signal)
  const fingerprint = recordingFingerprint(section.items)
  if (continued !== undefined && continued.fingerprint !== fingerprint) {
    return {
      contract_version: 1 as const,
      date: localDate.date,
      timezone: localDate.timezone,
      timezone_offset_minutes: localDate.timezoneOffsetMinutes,
      content: 'transcript' as const,
      section_state: section.state,
      coverage: {
        state: 'source_changed' as const,
        reason: 'recording_projection_changed',
        ready_count: 0,
        unavailable_count: 0,
      },
      items: [],
      has_more: false,
    }
  }

  let itemOffset = continued?.itemOffset ?? 0
  let usedCodePoints = 0
  let unavailableCount = 0
  const items: ReturnType<typeof transcriptModelItem>[] = []
  while (itemOffset < section.items.length && items.length < limit) {
    const item = section.items[itemOffset]
    if (item === undefined) break
    const itemLength = codePointLength(item.text)
    if (itemLength > RECORDING_TEXT_BUDGET) {
      itemOffset += 1
      unavailableCount += 1
      continue
    }
    if (usedCodePoints + itemLength > RECORDING_TEXT_BUDGET) break
    items.push(transcriptModelItem(item))
    usedCodePoints += itemLength
    itemOffset += 1
  }
  const hasMore = itemOffset < section.items.length
  const nextCursor = hasMore
    ? await ports.sealRecordingCursor({
      version: 1,
      dateStamp: localDate.dateStamp,
      content: 'transcript',
      itemOffset,
      textOffset: 0,
      fingerprint,
    })
    : undefined
  const partial = section.identityCoverage === 'partial' || unavailableCount > 0
  return {
    contract_version: 1 as const,
    date: localDate.date,
    timezone: localDate.timezone,
    timezone_offset_minutes: localDate.timezoneOffsetMinutes,
    content: 'transcript' as const,
    section_state: section.state,
    coverage: {
      state: partial ? 'partial' as const : hasMore ? 'bounded' as const : 'complete' as const,
      ready_count: items.length,
      unavailable_count: unavailableCount,
    },
    items,
    has_more: hasMore,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
  }
}

function projectionStatePage(
  localDate: ArkmeRecordingLocalDate,
  content: 'summary' | 'timeline',
  sectionState: ArkmeRecordingSection<ArkmeRecordingVersion>['state'],
  coverageState: 'complete' | 'processing' | 'unavailable' | 'source_changed',
  availableVersions: ReturnType<typeof safeVersions>,
  reason?: string,
) {
  const base = {
    contract_version: 1 as const,
    date: localDate.date,
    timezone: localDate.timezone,
    timezone_offset_minutes: localDate.timezoneOffsetMinutes,
    section_state: sectionState,
    coverage: {
      state: coverageState,
      ...(reason === undefined ? {} : { reason }),
      ready_count: 0,
      unavailable_count: coverageState === 'unavailable' ? 1 : 0,
    },
    available_versions: availableVersions,
    items: [],
    has_more: false,
  }
  return content === 'summary'
    ? { ...base, content: 'summary' as const }
    : { ...base, content: 'timeline' as const }
}

async function readSummaryPage(
  ports: ArkmeRecordingToolPort,
  localDate: ArkmeRecordingLocalDate,
  section: ArkmeRecordingSection<ArkmeRecordingVersion>,
  selected: ArkmeRecordingVersion,
  availableVersions: ReturnType<typeof safeVersions>,
  continued: ArkmeRecordingCursorPayload | undefined,
) {
  const fingerprint = recordingFingerprint(selected)
  const codePoints = [...selected.content]
  const textOffset = continued?.textOffset ?? 0
  if ((continued !== undefined && continued.fingerprint !== fingerprint)
    || textOffset > codePoints.length) {
    return projectionStatePage(
      localDate,
      'summary',
      section.state,
      'source_changed',
      availableVersions,
      'recording_projection_changed',
    )
  }
  const endOffset = Math.min(codePoints.length, textOffset + RECORDING_TEXT_BUDGET)
  const text = codePoints.slice(textOffset, endOffset).join('')
  const hasMore = endOffset < codePoints.length
  const nextCursor = hasMore
    ? await ports.sealRecordingCursor({
      version: 1,
      dateStamp: localDate.dateStamp,
      content: 'summary',
      versionId: selected.id,
      itemOffset: 0,
      textOffset: endOffset,
      fingerprint,
    })
    : undefined
  return {
    contract_version: 1 as const,
    date: localDate.date,
    timezone: localDate.timezone,
    timezone_offset_minutes: localDate.timezoneOffsetMinutes,
    content: 'summary' as const,
    section_state: 'ready' as const,
    coverage: {
      state: hasMore ? 'bounded' as const : 'complete' as const,
      ready_count: text === '' ? 0 : 1,
      unavailable_count: 0,
    },
    selected_version_id: selected.id,
    available_versions: availableVersions,
    items: text === '' ? [] : [{
      projection_id: selected.id,
      generated_at_millis: selected.generatedAtMillis,
      model_display_name: selected.modelDisplayName,
      text,
      continued: hasMore,
    }],
    has_more: hasMore,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
  }
}

async function readTimelinePage(
  ports: ArkmeRecordingToolPort,
  localDate: ArkmeRecordingLocalDate,
  section: ArkmeRecordingSection<ArkmeRecordingVersion>,
  selected: ArkmeRecordingVersion,
  availableVersions: ReturnType<typeof safeVersions>,
  continued: ArkmeRecordingCursorPayload | undefined,
  limit: number,
) {
  const fingerprint = recordingFingerprint({
    versionId: selected.id,
    timelineEvents: selected.timelineEvents,
  })
  let itemOffset = continued?.itemOffset ?? 0
  if ((continued !== undefined && continued.fingerprint !== fingerprint)
    || itemOffset > selected.timelineEvents.length) {
    return projectionStatePage(
      localDate,
      'timeline',
      section.state,
      'source_changed',
      availableVersions,
      'recording_projection_changed',
    )
  }
  let usedCodePoints = 0
  let unavailableCount = 0
  const items: ReturnType<typeof timelineModelItem>[] = []
  while (itemOffset < selected.timelineEvents.length && items.length < limit) {
    const event = selected.timelineEvents[itemOffset]
    if (event === undefined) break
    const item = timelineModelItem(event)
    const itemLength = timelineModelItemLength(item)
    if (itemLength > RECORDING_TEXT_BUDGET) {
      itemOffset += 1
      unavailableCount += 1
      continue
    }
    if (usedCodePoints + itemLength > RECORDING_TEXT_BUDGET) break
    items.push(item)
    usedCodePoints += itemLength
    itemOffset += 1
  }
  const hasMore = itemOffset < selected.timelineEvents.length
  const nextCursor = hasMore
    ? await ports.sealRecordingCursor({
      version: 1,
      dateStamp: localDate.dateStamp,
      content: 'timeline',
      versionId: selected.id,
      itemOffset,
      textOffset: 0,
      fingerprint,
    })
    : undefined
  return {
    contract_version: 1 as const,
    date: localDate.date,
    timezone: localDate.timezone,
    timezone_offset_minutes: localDate.timezoneOffsetMinutes,
    content: 'timeline' as const,
    section_state: 'ready' as const,
    coverage: {
      state: unavailableCount > 0
        ? 'partial' as const
        : hasMore ? 'bounded' as const : 'complete' as const,
      ready_count: items.length,
      unavailable_count: unavailableCount,
    },
    selected_version_id: selected.id,
    available_versions: availableVersions,
    items,
    has_more: hasMore,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
  }
}

async function readProjectionPage(
  ports: ArkmeRecordingToolPort,
  args: RecordingReadArgs,
  localDate: ArkmeRecordingLocalDate,
  continued: ArkmeRecordingCursorPayload | undefined,
  limit: number | undefined,
  signal: AbortSignal,
) {
  if (args.content === 'transcript') throw new Error('内部错误：转写内容不能进入投影读取路径')
  const section = await ports.recordingProjection(localDate.dateStamp, args.content, signal)
  const availableVersions = safeVersions(section.items)
  let selected: ArkmeRecordingVersion | undefined
  if (continued !== undefined) {
    if (continued.versionId === undefined) throw new Error('录音分页游标缺少版本信息')
    selected = section.items.find(item => item.id === continued.versionId
      && item.status === 'done' && item.selectable)
    if (selected === undefined) {
      return projectionStatePage(
        localDate,
        args.content,
        section.state,
        'source_changed',
        availableVersions,
        'recording_projection_changed',
      )
    }
  } else {
    selected = selectCompletedVersion(
      section.items,
      args.version_id === undefined ? undefined : args.version_id.trim(),
    )
  }

  if (selected === undefined) {
    if (section.items.length === 0) {
      return projectionStatePage(localDate, args.content, 'empty', 'complete', availableVersions)
    }
    if (section.items.some(version => version.status === 'processing')) {
      return projectionStatePage(localDate, args.content, 'processing', 'processing', availableVersions)
    }
    return projectionStatePage(
      localDate,
      args.content,
      'failed',
      'unavailable',
      availableVersions,
      'generation_failed',
    )
  }

  return args.content === 'summary'
    ? await readSummaryPage(ports, localDate, section, selected, availableVersions, continued)
    : await readTimelinePage(
      ports,
      localDate,
      section,
      selected,
      availableVersions,
      continued,
      limit ?? 20,
    )
}

async function readRecordingPage(
  ports: ArkmeRecordingToolPort,
  args: RecordingReadArgs,
  signal: AbortSignal,
) {
  const limit = validateRecordingReadArgs(args)
  const localDate = parseRecordingLocalDate(args.date)
  const continued = args.cursor === undefined
    ? undefined
    : await ports.openRecordingCursor(args.cursor)
  if (continued !== undefined) assertCursorScope(continued, localDate.dateStamp, args.content)
  if (args.content === 'transcript') {
    return await readTranscriptPage(ports, localDate, continued, limit ?? 50, signal)
  }
  return await readProjectionPage(ports, args, localDate, continued, limit, signal)
}

export const recordingDaysListToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.days-list.v1',
    toolName: 'arkme_recording_days_list',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_recording_days_list',
      description: 'List local calendar days in a bounded date range and report which days contain the signed-in user\'s existing all-day recordings. This is read-only and does not generate, repair, download, or play recordings.',
      parameters: {
        from_date: {
          type: 'string',
          required: true,
          description: 'Inclusive local date in strict YYYY-MM-DD format.',
        },
        to_date: {
          type: 'string',
          required: true,
          description: 'Inclusive local date in strict YYYY-MM-DD format; maximum range is 31 days.',
        },
      },
      output: { schema: DAYS_OUTPUT_SCHEMA, render: renderRecordingData },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const from = parseRecordingLocalDate(args.from_date)
        const to = parseRecordingLocalDate(args.to_date)
        const range = inclusiveRange(from, to)
        const result = await ports.recordingCalendar(from.dateStamp, range.toExclusive, exec.signal)
        return {
          contract_version: 1 as const,
          from_date: from.date,
          to_date: to.date,
          timezone: from.timezone,
          timezone_offset_minutes: from.timezoneOffsetMinutes,
          days: result.days.map(day => ({
            date: formatLocalDate(day.dateStamp),
            duration_millis: day.durationMillis,
            has_recording: day.hasRecording,
            unreviewed_count: day.unreviewedCount,
          })),
          coverage: { state: 'complete' as const },
        }
      },
    })
  },
})

export const recordingReadToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.read.v1',
    toolName: 'arkme_recording_read',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_recording_read',
      description: 'Read one existing all-day recording content layer for one local date. content=summary or timeline is preferred; use transcript only when exact wording, speakers, or fine detail is necessary. This tool is read-only.',
      parameters: {
        date: {
          type: 'string',
          required: true,
          description: 'Local date in strict YYYY-MM-DD format.',
        },
        content: {
          type: 'string',
          required: true,
          enum: ['transcript', 'summary', 'timeline'],
        },
        limit: {
          type: 'integer',
          description: 'Transcript: 1-100, default 50. Timeline: 1-50, default 20. Do not pass for summary.',
        },
        cursor: {
          type: 'string',
          description: 'Opaque next_cursor returned by the immediately preceding page.',
        },
        version_id: {
          type: 'string',
          description: 'Summary/timeline completed version id returned by available_versions; first page only.',
        },
      },
      output: { schema: READ_OUTPUT_SCHEMA, render: renderRecordingData },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await readRecordingPage(ports, args, exec.signal)
      },
    })
  },
})

export const recordingToolModules = [recordingDaysListToolModule, recordingReadToolModule] as const
