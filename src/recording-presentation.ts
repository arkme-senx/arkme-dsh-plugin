import type {
  ArkmeRecordingTimelineEvent,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingVersion,
  ArkmeRecordingVersionStatus,
} from './types.js'

export interface ArkmeRecordingPrivateTranscriptItem extends ArkmeRecordingTranscriptItem {
  audioFileName: string
  audioMimeType: string
  formalSpeakerId: string
  rawSpeakerNumber: number
  speakerIdentity: string
  childStartMillis: number
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

function positiveNumberValue(value: unknown): number | undefined {
  const parsed = optionalNumberValue(value)
  if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(value => stringValue(value).trim()).filter(value => value !== ''))]
}

function displayTimestamp(value: unknown): number {
  const numeric = numberValue(value)
  if (numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const parsed = Date.parse(stringValue(value))
  return Number.isFinite(parsed) ? parsed : 0
}

export function projectRecordingTranscripts(
  response: unknown,
  speakerResponse: unknown,
  profilesByUserId: ReadonlyMap<number, { displayName: string; avatarRef?: string }> = new Map(),
): ArkmeRecordingPrivateTranscriptItem[] {
  const data = objectValue(response)
  const sessions = new Map<string, Record<string, unknown>>()
  const sessionSpeakerColorIndexes = new Map<string, number>()
  const speakerColorIndexes = new Map<string, number>()
  let nextSpeakerColorIndex = 0
  for (const rawSession of listValue(data.session_ls ?? data.sessions)) {
    const session = objectValue(rawSession)
    const id = stringValue(session.id ?? session.session_id).trim()
    if (id === '') continue
    sessions.set(id, session)
    for (const rawSessionSpeaker of listValue(session.spk_ls ?? session.speakers)) {
      const sessionSpeaker = objectValue(rawSessionSpeaker)
      const rawNumber = numberValue(sessionSpeaker.num ?? sessionSpeaker.speaker_num)
      const formalSpeakerId = stringValue(sessionSpeaker.spk_id ?? sessionSpeaker.speaker_id).trim()
      const innerDisplay = stringValue(sessionSpeaker.inner_display).trim()
      const identity = formalSpeakerId !== ''
        ? `speaker:${formalSpeakerId}`
        : innerDisplay !== ''
          ? `inner:${innerDisplay}`
          : `session:${id}:${rawNumber}`
      let colorIndex = speakerColorIndexes.get(identity)
      if (colorIndex === undefined) {
        const explicitColorIndex = optionalNumberValue(
          sessionSpeaker.speaker_color_index
            ?? sessionSpeaker.speakerColorIndex
            ?? sessionSpeaker.color_index
            ?? sessionSpeaker.colorIndex,
        )
        colorIndex = explicitColorIndex !== undefined && explicitColorIndex >= 0
          ? explicitColorIndex
          : nextSpeakerColorIndex
        speakerColorIndexes.set(identity, colorIndex)
        nextSpeakerColorIndex += 1
      }
      sessionSpeakerColorIndexes.set(`${id}:${rawNumber}`, colorIndex)
    }
  }

  const speakers = new Map<string, Record<string, unknown>>()
  const speakerRows = Array.isArray(speakerResponse)
    ? speakerResponse
    : listValue(objectValue(speakerResponse).speaker_ls ?? objectValue(speakerResponse).speakers)
  for (const rawSpeaker of speakerRows) {
    const speaker = objectValue(rawSpeaker)
    // get-speaker-ls uses speaker_id in the desktop client's current contract;
    // older responses used id or spk_id.
    const id = stringValue(speaker.id ?? speaker.speaker_id ?? speaker.spk_id).trim()
    if (id !== '') speakers.set(id, speaker)
  }

  const projected: Array<ArkmeRecordingPrivateTranscriptItem & { sourceIndex: number }> = []
  let sourceIndex = 0
  for (const rawChild of listValue(data.child_ls ?? data.children)) {
    const child = objectValue(rawChild)
    const childId = stringValue(child.id ?? child.child_id).trim()
    const sessionId = stringValue(child.session_id).trim()
    const session = sessions.get(sessionId) ?? {}
    const audioFileName = stringValue(child.file_name ?? child.audio_file_name ?? child.source_file_name).trim()
    const audioMimeType = stringValue(child.mime_type ?? child.audio_mime_type).trim()
    const sessionSpeakers = listValue(session.spk_ls ?? session.speakers).map(objectValue)
    const childOffset = numberValue(child.start_at)
    const childStart = childOffset >= 100_000_000_000
      ? childOffset
      : numberValue(session.start_at) + childOffset
    const rows = listValue(child.asr)
    for (let index = 0; index < rows.length; index += 1) {
      const row = objectValue(rows[index])
      const isBackground = numberValue(row.b ?? row.background) === 1 || row.background === true
      const text = stringValue(row.t ?? row.text).trim().replace(isBackground ? /^\(背景音\)\s*/ : /$^/, '')
      if (text === '') continue
      const rawSpeakerNumber = numberValue(row.n ?? row.speaker_num)
      const sessionSpeaker = sessionSpeakers.find(candidate => numberValue(candidate.num) === rawSpeakerNumber) ?? {}
      const formalSpeakerId = stringValue(
        row.effective_spk_id ?? sessionSpeaker.spk_id ?? sessionSpeaker.speaker_id,
      ).trim()
      const innerDisplay = stringValue(sessionSpeaker.inner_display).trim()
      const speakerIdentity = formalSpeakerId !== ''
        ? `speaker:${formalSpeakerId}`
        : innerDisplay !== ''
          ? `inner:${innerDisplay}`
          : `session:${sessionId}:${String(rawSpeakerNumber)}`
      const formalSpeaker = speakers.get(formalSpeakerId) ?? {}
      const speakerUserId = positiveNumberValue(
        formalSpeaker.ref_usr_id ?? formalSpeaker.ref_user_id ?? formalSpeaker.user_id,
      )
      const profile = speakerUserId === undefined ? undefined : profilesByUserId.get(speakerUserId)
      const isSelf = speakerUserId !== undefined && speakerUserId === numberValue(session.belong_usr)
      const persistentSpeakerNumber = optionalNumberValue(
        sessionSpeaker.speaker_display_number ?? sessionSpeaker.speakerDisplayNumber,
      )
      const speakerNumber = persistentSpeakerNumber !== undefined && persistentSpeakerNumber > 0
        ? persistentSpeakerNumber
        : rawSpeakerNumber
      const speakerColorIndex = sessionSpeakerColorIndexes.get(`${sessionId}:${rawSpeakerNumber}`)
        ?? Math.max(0, rawSpeakerNumber)
      const listedSpeakerName = stringValue(
        formalSpeaker.nick_name ?? formalSpeaker.nickname ?? formalSpeaker.display_name ?? formalSpeaker.name,
      ).trim()
      // A manually named speaker must not be overwritten by the person's public nickname.
      const speakerLabel = listedSpeakerName || profile?.displayName.trim()
        || (speakerNumber >= 0 ? `说话人 ${speakerNumber}` : '未知说话人')
      const startOffset = numberValue(row.s ?? row.start_at)
      const endOffset = Math.max(startOffset, numberValue(row.e ?? row.end_at))
      projected.push({
        itemId: `${childId || sessionId}:${index}`,
        sessionId,
        childId,
        asrItemIndex: index,
        transcriptSource: 'system',
        audioFileName,
        audioMimeType,
        formalSpeakerId,
        rawSpeakerNumber,
        speakerIdentity,
        childStartMillis: childStart,
        startAtMillis: childStart + startOffset,
        endAtMillis: childStart + endOffset,
        speakerNumber,
        speakerColorIndex,
        speakerLabel,
        ...(profile?.avatarRef === undefined ? {} : { speakerAvatarRef: profile.avatarRef }),
        isSelf,
        isBackground,
        text,
        sourceIndex,
      })
      sourceIndex += 1
    }
  }
  return projected
    .sort((left, right) => left.startAtMillis - right.startAtMillis
      || left.endAtMillis - right.endAtMillis
      || left.sessionId.localeCompare(right.sessionId)
      || left.childId.localeCompare(right.childId)
      || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex: _sourceIndex, ...item }) => item)
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
      generatedAtMillis: displayTimestamp(version.update_at) || displayTimestamp(version.create_at),
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
