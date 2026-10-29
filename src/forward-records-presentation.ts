import { projectTeamForward } from './team-forward-presentation.js'
import type { ArkmeForwardRecordsPreview, ArkmeForwardRecordPreviewItem, ArkmeForwardTranscriptSegment } from './types.js'
import type { MediaService } from './services/media-service.js'
import type { ProfileService } from './services/profile-service.js'
import { objectValue, stringValue } from './services/service.js'
import { arkmeRecordTextFormat } from './markdown.js'
import { remapLongArticleAssets } from './long-article-content.js'
import { projectForwardRecordingSegment } from './recording-forward-presentation.js'

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export async function projectForwardRecordsWithAvatars(
  contentPayload: Record<string, unknown>, viewerUserId: number, fallbackCreatedAtMillis: number,
  media: Pick<MediaService, 'forwardContentBlocks'>, profile: Pick<ProfileService, 'sealProfileImageRef'>,
): Promise<ArkmeForwardRecordsPreview | undefined> {
  const senders = new Map<number, ArkmeForwardRecordPreviewItem[]>()
  const preview = projectForwardRecordsPreview(contentPayload, viewerUserId, fallbackCreatedAtMillis, media,
    (item, userId) => {
      const items = senders.get(userId) ?? []
      items.push(item)
      senders.set(userId, items)
    })
  for (const [userId, items] of senders) {
    const avatarRef = await profile.sealProfileImageRef(viewerUserId, userId)
    for (const item of items) item.avatarRef = avatarRef
  }
  return preview
}

/** Project the stored snapshot only; reading a forward never reopens its original sources. */
export function projectForwardRecordsPreview(
  contentPayload: Record<string, unknown>,
  viewerUserId: number,
  fallbackCreatedAtMillis: number,
  media: Pick<MediaService, 'forwardContentBlocks'>,
  onSender?: (item: ArkmeForwardRecordPreviewItem, userId: number) => void,
): ArkmeForwardRecordsPreview | undefined {
  const nested = objectValue(contentPayload.forward_records ?? contentPayload.forwardRecords)
  const payload = Object.keys(nested).length > 0 ? nested : contentPayload
  if (payload.source_type === 'team_message') {
    return projectTeamForward({ forward_records: payload },
      (files, longArticle) => media.forwardContentBlocks(files, viewerUserId, { longArticle }))
  }
  if (stringValue(payload.render_kind ?? payload.renderKind).trim() !== 'forward_records') return undefined

  const projectedItems: ArkmeForwardRecordPreviewItem[] = []
  let truncated = false
  let remainingSegments = 2_000
  const epochMillis = (value: unknown): number => {
    const time = numberValue(value)
    return Number.isFinite(time) && time > 0 && time < 8.64e15
      ? Math.trunc(time < 1e12 ? time * 1000 : time) : 0
  }
  const appendItems = (values: unknown[], depth: number): void => {
    if (values.length > 100) truncated = true
    const sorted = values.slice(0, 100).map((value, index) => ({ value, index, order: numberValue(objectValue(value).item_order) }))
      .sort((left, right) => (left.order || left.index) - (right.order || right.index))
    for (const entry of sorted) {
      if (projectedItems.length >= 100) { truncated = true; return }
      const item = objectValue(entry.value)
      const nestedForward = objectValue(item.forward_records ?? item.forwardRecords)
      if (depth < 4
        && stringValue(nestedForward.render_kind ?? nestedForward.renderKind).trim() === 'forward_records') {
        appendItems(listValue(nestedForward.items), depth + 1)
        continue
      }
      if (depth >= 4 && Object.keys(nestedForward).length > 0) truncated = true
      const sourceTypeValue = stringValue(item.source_type ?? item.sourceType ?? payload.source_type ?? payload.sourceType)
      const rawType = sourceTypeValue === 'quick_records'
        ? stringValue(item.source_chat_session_uid ?? item.sourceChatSessionUid).trim() ? 'chat_record' : 'record'
        : sourceTypeValue
      const sourceSender = item.source_sender_user_id ?? item.sourceSenderUserId
      const isDeepSeekReply = rawType === 'agent'
        && numberValue(sourceSender) === 0 && stringValue(item.source_avatar_kind ?? item.sourceAvatarKind) === 'deepseek'
      // Chat omits the zero AI speaker ID; content ownership must not turn that reply into a human speaker.
      const senderUserId = isDeepSeekReply ? 0 : numberValue(sourceSender ?? item.owner_id ?? item.ownerId)
      const senderName = isDeepSeekReply ? 'DeepSeek Harness' : stringValue(
        item.owner_name ?? item.ownerName ?? item.source_display_name ?? item.sourceDisplayName,
      ).trim() || 'Arkme用户'
      // Agent forward snapshots use render_format; ordinary Record text_format has a separate contract.
      const textFormat = rawType === 'agent'
        && stringValue(item.render_format ?? item.renderFormat) === 'markdown' ? 'markdown' : arkmeRecordTextFormat(item)
      const rawText = stringValue(item.text ?? item.text_preview ?? item.textPreview)
      let textContent = textFormat === 'markdown' ? rawText : rawText.trim()
      const displayKind = numberValue(item.display_kind ?? item.displayKind)
      const title = stringValue(item.title).trim()
      const sourceType: ArkmeForwardRecordPreviewItem['sourceType'] =
        rawType === 'record' || rawType === 'chat_record' || rawType === 'long_recording_segments'
          || rawType === 'agent' || rawType === 'ai_letter' ? rawType : 'unknown'
      const files = listValue(item.files)
      const longArticle = displayKind === 1
      const contentBlocks = media.forwardContentBlocks(files, viewerUserId, { longArticle })
      if (longArticle && textFormat === 'markdown') {
        const aliases = new Map(files.map((value, index) => [`arkme-asset:${stringValue(objectValue(value).file_asset_uid)}`, `arkme-asset:media-${index}`]))
        textContent = remapLongArticleAssets(textContent, aliases)
      }
      const call = objectValue(item.call_record_snapshot ?? item.callRecordSnapshot)
      const recordingSegments = listValue(item.long_recording_segments ?? item.longRecordingSegments)
      const rawSegments = recordingSegments.length > 0 ? recordingSegments : listValue(call.transcript_segments ?? call.transcriptSegments)
      const segmentValues = rawSegments.slice(0, Math.min(500, remainingSegments))
      remainingSegments -= segmentValues.length
      const segments: ArkmeForwardTranscriptSegment[] = segmentValues.map(value => {
        if (recordingSegments.length > 0) return projectForwardRecordingSegment(value, senderName)
        const segment = objectValue(value)
        const offset = (value: unknown) => Math.max(0, Math.trunc(numberValue(value)))
        const startMillis = offset(segment.start_millis ?? segment.startMillis ?? segment.start_ms ?? segment.startMs)
        const endMillis = Math.max(startMillis, offset(segment.end_millis ?? segment.endMillis ?? segment.end_ms ?? segment.endMs))
        const speakerNumber = offset(segment.speaker_number ?? segment.speakerNumber)
        const speakerName = stringValue(segment.speaker_label ?? segment.speakerLabel ?? segment.speaker_name ?? segment.speakerName).trim()
          || (speakerNumber > 0 ? `说话人 ${String(speakerNumber)}` : senderName)
        const audioUrl = stringValue(segment.audio_url ?? segment.audioUrl).trim()
        const segmentMedia = audioUrl === '' ? [] : media.forwardContentBlocks([{
          type: 2, name: '通话片段', mime_type: 'audio/wav', download_url: audioUrl,
          duration_sec: (endMillis - startMillis) / 1000,
        }], viewerUserId)
        return {
          speakerName, textContent: stringValue(segment.text ?? segment.text_content ?? segment.textContent), startMillis, endMillis,
          ...(segmentMedia.length === 0 ? {} : { contentBlocks: segmentMedia }),
          ...(audioUrl !== '' && segmentMedia.length === 0 ? { mediaUnavailable: true as const } : {}),
        }
      })
      const imageCount = Math.max(0, Math.trunc(numberValue(item.image_count ?? item.imageCount)))
      const voiceCount = Math.max(0, Math.trunc(numberValue(item.voice_count ?? item.voiceCount)))
      const fileCount = Math.max(0, Math.trunc(numberValue(item.file_count ?? item.fileCount)))
      const fileName = listValue(item.file_names ?? item.fileNames)
        .map(value => stringValue(value).trim()).find(value => value !== '')
      const contentLabel = imageCount > 0
        ? imageCount > 1 ? `[${String(imageCount)}张图片]` : '[图片]'
        : voiceCount > 0 ? '[语音]'
          : fileCount > 0 ? fileName === undefined ? '[文件]' : `[文件] ${fileName}`
            : stringValue(item.availability).trim() !== '' ? '原快记暂不可查看' : undefined
      const sourceTeam=objectValue(item.source_representation),originTeam=objectValue(item.origin_representation)
      projectedItems.push({
        senderName,
        ...(stringValue(sourceTeam.name)&&stringValue(sourceTeam.jotmo_id)?{sourceTeam:{name:stringValue(sourceTeam.name),jotmoId:stringValue(sourceTeam.jotmo_id)}}:{}),
        ...(stringValue(originTeam.name)&&stringValue(originTeam.jotmo_id)?{originTeam:{name:stringValue(originTeam.name),jotmoId:stringValue(originTeam.jotmo_id)}}:{}),
        ...(isDeepSeekReply ? { avatarKind: 'deepseek' as const } : {}),
        // Only a resolved other account gets an actionable identity; the
        // viewer's own id and unresolved senders stay off the wire.
        ...(senderUserId > 0 && senderUserId !== viewerUserId ? { senderUserId } : {}),
        sendAtMillis: recordingSegments.length > 0 ? numberValue(item.send_at ?? item.sendAt) : epochMillis(item.send_at ?? item.sendAt),
        title,
        textContent,
        textFormat,
        displayKind,
        sourceType,
        templateKind: numberValue(item.template_kind ?? item.templateKind),
        ...(contentBlocks.length === 0 ? {} : { contentBlocks }),
        ...(files.length > contentBlocks.length ? { mediaUnavailable: true } : {}),
        ...(segments.length === 0 ? {} : { segments }),
        ...(segmentValues.length < rawSegments.length || (!longArticle && files.length > 32) ? { truncated: true } : {}),
        ...(contentLabel === undefined ? {} : { contentLabel }),
      })
      if (senderUserId > 0) onSender?.(projectedItems[projectedItems.length - 1]!, senderUserId)
    }
  }
  appendItems(listValue(payload.items), 0)

  const summaryLines = listValue(payload.summary_lines ?? payload.summaryLines)
    .map(value => stringValue(value).trim()).filter(value => value !== '')
  const createdAtMillis = epochMillis(payload.created_at ?? payload.createdAt) || epochMillis(fallbackCreatedAtMillis)
  return {
    title: stringValue(payload.title).trim() || '转发快记',
    createdAtMillis,
    summaryLines,
    items: projectedItems,
    ...(truncated ? { truncated: true } : {}),
  }
}
