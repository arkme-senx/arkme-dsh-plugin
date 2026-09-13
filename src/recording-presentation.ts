import type {
  ArkmeRecordingSummaryModelConfig,
  ArkmeRecordingTimelineEvent,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingVersion,
  ArkmeRecordingVersionStatus,
} from './types.js'

function recordingGenerationDateLabel(value: number): string {
  const date = new Date(value)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-')
}

function recordingGenerationClockLabel(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(wholeSeconds / 3_600)
  const minutes = Math.floor((wholeSeconds % 3_600) / 60)
  const remainingSeconds = wholeSeconds % 60
  return [hours, minutes, remainingSeconds].map(value => String(value).padStart(2, '0')).join(':')
}

function recordingGenerationDurationLabel(startSeconds: number, endSeconds: number): string {
  const seconds = Math.max(0, endSeconds - startSeconds)
  if (seconds < 60) return `${String(seconds)}秒`
  if (seconds < 3_600) return `${String(Math.floor(seconds / 60))}分${String(seconds % 60)}秒`
  return `${String(Math.floor(seconds / 3_600))}小时${String(Math.floor((seconds % 3_600) / 60))}分`
}

export function buildRecordingGenerationTranscript(
  items: readonly (ArkmeRecordingTranscriptItem & { event?: string; generationText?: string })[],
  kind: 'summary' | 'timeline',
  dayStartMillis: number,
): string {
  const available = items
    .filter(item => item.text.trim() !== '' && item.endAtMillis > item.startAtMillis)
    .toSorted((left, right) => left.startAtMillis - right.startAtMillis || left.endAtMillis - right.endAtMillis)
  let selfSpeakerLabel = ''
  const sections = available.map(item => {
    if (item.isSelf) selfSpeakerLabel = item.speakerLabel
    const startSeconds = Math.round((item.startAtMillis - dayStartMillis) / 1_000)
    const endSeconds = Math.round((item.endAtMillis - dayStartMillis) / 1_000)
    const event = item.event?.trim() ?? ''
    const text = item.generationText?.trim() || item.text
    return [
      `说话人：${item.speakerLabel}`,
      ...(item.isSelf ? [] : ['[important_note]: 这句话不是我本人说的']),
      `[${recordingGenerationDateLabel(item.startAtMillis)} ${recordingGenerationClockLabel(startSeconds)} ${recordingGenerationDurationLabel(startSeconds, endSeconds)}] ${event}：`,
      text,
    ].join('\n')
  })
  sections.push(selfSpeakerLabel === '' ? '其中，没有发现我自己说的话' : `其中，${selfSpeakerLabel}是我自己`)
  sections.push([
    `不需要开头中的声明或推测，直接输出「${kind === 'timeline' ? '时间轴' : '总结'}」正文内容，`,
    '不需要结语中的「帮我干」的内容，直接生成正文部分',
    '总结时，不能将不是我说的话，归结为我说的内容',
    '禁止在输出结果中出现[important_note]等内部字段',
    ...(kind === 'timeline' ? ['如果某些时段或一整天都没有我的说话的数据，则认为录制都是环境音，以此环境音分析我的一天或每个时间段可能在做什么'] : []),
  ].join('\n'))
  return sections.join('\n\n')
}

export function projectRecordingSummaryModelConfig(value: unknown): ArkmeRecordingSummaryModelConfig {
  const root = objectValue(value)
  const nestedItem = objectValue(root.item)
  const item = Object.keys(nestedItem).length > 0 ? nestedItem : root
  const seen = new Set<string>()
  const options = listValue(item.allowed_route_options ?? item.allowedRouteOptions).flatMap(raw => {
    const option = objectValue(raw)
    const routeKey = stringValue(option.route_key ?? option.routeKey).trim()
    if (routeKey === '' || seen.has(routeKey)) return []
    seen.add(routeKey)
    const provider = stringValue(option.provider).trim()
    const modelKey = stringValue(option.model_key ?? option.modelKey).trim()
    const displayName = stringValue(option.display_name ?? option.displayName).trim() || modelKey || routeKey
    return [{ routeKey, provider, modelKey, displayName }]
  })
  const personalRouteKey = stringValue(item.personal_route_key ?? item.personalRouteKey).trim()
  return {
    defaultRouteKey: stringValue(item.default_route_key ?? item.defaultRouteKey).trim(),
    effectiveRouteKey: stringValue(item.effective_route_key ?? item.effectiveRouteKey).trim(),
    ...(personalRouteKey === '' ? {} : { personalRouteKey }),
    options,
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function optionalNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(value => stringValue(value).trim()).filter(value => value !== ''))]
}

function displayVersionTimestamp(value: unknown): number | undefined {
  const numeric = optionalNumberValue(value)
  if (numeric !== undefined) {
    return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(stringValue(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeStructuredTimeline(value: unknown): ArkmeRecordingTimelineEvent[] {
  const root = objectValue(value)
  const rows = Array.isArray(value)
    ? value
    : listValue(root.timelines ?? root.timeline ?? root.items)
  return rows.map((raw, index) => {
    const row = objectValue(raw)
    const rawRange = stringValue(row.time_range).trim()
    const rangeMatch = TIMELINE_HEADER.exec(rawRange)
    const startAt = stringValue(row.start_at ?? row.startAt ?? row.start_time).trim() || rangeMatch?.[1] || ''
    const endAt = stringValue(row.end_at ?? row.endAt ?? row.end_time).trim() || rangeMatch?.[2] || ''
    const dialoguePoints = listValue(row.dialogue_points ?? row.dialogues).map(objectValue)
    const participantValues = [
      ...listValue(row.participants ?? row.roles).map(item => {
        const participant = objectValue(item)
        return Object.keys(participant).length === 0 ? item : participant.name ?? participant.spk_name
      }),
      ...dialoguePoints.map(item => item.spk_name ?? item.speaker_name),
    ]
    const tags = listValue(row.event_tags ?? row.tags)
    return {
      eventId: stringValue(row.id ?? row.event_id).trim() || `event-${index}`,
      startAt,
      endAt,
      timeRange: startAt !== '' && endAt !== '' ? `${startAt}–${endAt}` : startAt || endAt,
      title: stringValue(row.title ?? row.name ?? row.scene_title ?? row.period_label).trim() || '时间轴记录',
      description: stringValue(row.description ?? row.content ?? row.event).trim(),
      scene: stringValue(row.position ?? row.scene ?? row.scene_type).trim(),
      emotion: stringValue(row.emotion ?? row.mood).trim(),
      todo: stringValue(row.todo ?? row.todo_item ?? row.todos).trim(),
      tags: uniqueStrings(tags),
      participants: uniqueStrings(participantValues),
      rawText: stringValue(row.raw_source).trim(),
    }
  }).filter(item => item.startAt !== '' || item.endAt !== '' || item.title !== '' || item.description !== '')
}

interface MutableMarkdownEvent {
  startAt: string
  endAt: string
  title: string
  lines: string[]
}

const TIMELINE_HEADER = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—~～至]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/
const TIMELINE_SECTION_LABELS = new Set([
  '场景类型', '场景', '角色', '说话人', '发生的事情', '内容描述', '我的心情', '心情', '待办',
  '代表性原话', '关键对话', '环境', '环境说明', '评价', '表扬', '事件标签',
])

function cleanMarkdownLine(source: string): string {
  return source.trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/^[-*+•]\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

function sectionValue(lines: string[], names: string[]): string {
  const values: string[] = []
  let collecting = false
  for (const line of lines) {
    const match = /^([^:：]+)[:：]\s*(.*)$/.exec(line)
    const label = match === null ? undefined : (match[1] ?? '').trim()
    if (label !== undefined && TIMELINE_SECTION_LABELS.has(label)) {
      if (collecting && !names.includes(label)) break
      collecting = names.includes(label)
      if (collecting && (match?.[2] ?? '').trim() !== '') values.push((match?.[2] ?? '').trim())
      continue
    }
    if (collecting && line !== '') values.push(line)
  }
  return values.join('\n').trim()
}

function unsectionedValue(lines: string[]): string {
  const values: string[] = []
  let insideSection = false
  for (const line of lines) {
    const match = /^([^:：]+)[:：]\s*(.*)$/.exec(line)
    const label = match === null ? undefined : (match[1] ?? '').trim()
    if (label !== undefined && TIMELINE_SECTION_LABELS.has(label)) {
      insideSection = true
      continue
    }
    if (!insideSection && line !== '') values.push(line)
  }
  return values.join('\n').trim()
}

function splitLabels(value: string): string[] {
  return uniqueStrings(value.split(/[,，、;/；]/).map(item => item.replace(/[（(].*?[）)]/g, '').trim()))
}

function markdownEvent(event: MutableMarkdownEvent, index: number): ArkmeRecordingTimelineEvent {
  const field = (...names: string[]): string => {
    return sectionValue(event.lines, names)
  }
  const description = field('发生的事情', '内容描述') || unsectionedValue(event.lines)
  return {
    eventId: `event-${index}`,
    startAt: event.startAt,
    endAt: event.endAt,
    timeRange: event.startAt !== '' && event.endAt !== '' ? `${event.startAt}–${event.endAt}` : '',
    title: event.title || '时间轴记录',
    description,
    scene: field('场景类型', '场景', '环境', '环境说明'),
    emotion: field('我的心情', '心情'),
    todo: field('待办'),
    tags: splitLabels(field('事件标签')),
    participants: splitLabels(field('角色', '说话人')),
    rawText: event.lines.join('\n').trim(),
  }
}

function parseMarkdownTimeline(markdown: string): ArkmeRecordingTimelineEvent[] {
  const events: MutableMarkdownEvent[] = []
  let current: MutableMarkdownEvent | undefined
  for (const originalLine of markdown.split(/\r?\n/)) {
    const plainLine = cleanMarkdownLine(originalLine)
    const header = TIMELINE_HEADER.exec(plainLine)
    if (header !== null) {
      current = {
        startAt: header[1] ?? '',
        endAt: header[2] ?? '',
        title: (header[3] ?? '').replace(/^[-:：\s]+/, '').trim(),
        lines: [],
      }
      events.push(current)
      continue
    }
    if (current === undefined || plainLine === '') continue
    current.lines.push(plainLine)
  }
  if (events.length > 0) return events.map(markdownEvent)
  const meaningful = markdown.split(/\r?\n/)
    .map(cleanMarkdownLine)
    .filter(line => line !== '' && line !== '今日时间轴' && line !== '时间轴'
      && !/^[-_=]{3,}$/.test(line) && !line.startsWith('生成时间：') && !line.startsWith('生成时间:'))
  if (meaningful.length === 0) return []
  return [{
    eventId: 'event-0', startAt: '', endAt: '', timeRange: '', title: meaningful[0] ?? '时间轴记录',
    description: meaningful.slice(1).join('\n'), scene: '', emotion: '', todo: '', tags: [], participants: [],
    rawText: meaningful.join('\n'),
  }]
}

export function parseRecordingTimeline(value: unknown): ArkmeRecordingTimelineEvent[] {
  if (typeof value !== 'string') return normalizeStructuredTimeline(value)
  const text = value.trim()
  if (text === '') return []
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return normalizeStructuredTimeline(JSON.parse(text) as unknown)
    } catch {
      return []
    }
  }
  return parseMarkdownTimeline(text)
}

export function projectRecordingVersions(
  response: unknown,
  kind: 'summary' | 'timeline',
): ArkmeRecordingVersion[] {
  const root = objectValue(response)
  const expectedKind = kind === 'timeline' ? 1 : 2
  const versions: Array<ArkmeRecordingVersion & { sourceIndex: number }> = []
  let sourceIndex = 0
  for (const rawVersion of listValue(root.audio_summary_ls ?? root.items ?? root.versions)) {
    const version = objectValue(rawVersion)
    if (numberValue(version.kind) !== expectedKind) continue
    const rawStatus = numberValue(version.status)
    const content = stringValue(version.answer ?? version.content).trim()
    const snapshotValid = version.timeline_snapshot_valid !== false
    let status: ArkmeRecordingVersionStatus = rawStatus === 1 ? 'processing' : rawStatus === 2 ? 'done' : 'failed'
    if (kind === 'timeline' && rawStatus === 2 && !snapshotValid) status = 'failed'
    const timelineEvents = kind === 'timeline' && status === 'done' ? parseRecordingTimeline(content) : []
    const selectable = status === 'done' && content !== '' && (kind === 'summary' || timelineEvents.length > 0)
    versions.push({
      id: stringValue(version.id ?? version.summary_id).trim() || `version-${sourceIndex}`,
      status,
      selectable,
      generationStage: numberValue(version.generation_stage ?? version.stage),
      generatedAtMillis: displayVersionTimestamp(version.update_at) ?? displayVersionTimestamp(version.create_at) ?? 0,
      modelDisplayName: stringValue(version.model_display_name ?? version.model_name).trim(),
      content,
      timelineEvents,
      error: stringValue(version.error ?? version.error_message).trim(),
      sourceIndex,
    })
    sourceIndex += 1
  }
  return versions
    .sort((left, right) => right.generatedAtMillis - left.generatedAtMillis || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex: _sourceIndex, ...version }) => version)
}
