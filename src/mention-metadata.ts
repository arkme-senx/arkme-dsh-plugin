import { objectValue } from './services/service.js'

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function integerLikeValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

export function arkmeMentionMetadataFromRecord(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const payloadMetadata = objectValue(payload.mention_metadata ?? payload.mentionMetadata)
  if (Object.keys(payloadMetadata).length > 0) return payloadMetadata
  const recordMetadata = objectValue(record.mention_metadata ?? record.mentionMetadata)
  if (Object.keys(recordMetadata).length > 0) return recordMetadata
  const contentPayload = objectValue(payload.content_payload ?? payload.contentPayload)
  return objectValue(contentPayload.mention_metadata ?? contentPayload.mentionMetadata)
}

export function arkmeMentionMetadataMentionsViewer(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  viewerUserId: number,
): boolean {
  if (viewerUserId <= 0) return false
  const metadata = arkmeMentionMetadataFromRecord(record, payload)
  for (const rawMention of listValue(metadata.human_mentions ?? metadata.humanMentions)) {
    const mention = objectValue(rawMention)
    const mentionedUserId = integerLikeValue(mention.user_id ?? mention.userId)
    if (mentionedUserId === 0 || mentionedUserId === viewerUserId) return true
  }
  return false
}
