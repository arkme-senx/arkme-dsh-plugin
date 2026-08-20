import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export interface SelectedPreviewAttachment {
  index: number
  ref: ImageAttachmentRef
}

function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const block = value as { type?: unknown; attachment?: unknown }
  if (block.type !== 'image' || block.attachment === null || typeof block.attachment !== 'object') return undefined
  const ref = block.attachment as Partial<ImageAttachmentRef>
  if (typeof ref.attachmentId !== 'string' || ref.attachmentId.trim() === ''
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(ref.mediaType))
    || !Number.isSafeInteger(ref.bytes) || Number(ref.bytes) <= 0
    || !Number.isSafeInteger(ref.width) || Number(ref.width) <= 0
    || !Number.isSafeInteger(ref.height) || Number(ref.height) <= 0) return undefined
  return ref as ImageAttachmentRef
}

export function selectLatestUserPreviewAttachments(
  agent: Agent,
  attachmentIndices?: readonly number[],
): SelectedPreviewAttachment[] {
  const event = [...agent.session.events].reverse().find(candidate => candidate.type === 'user/message'
    && candidate.data.source.kind === 'user')
  if (event?.type !== 'user/message') throw new Error('the current Agent session has no direct user message')
  const refs = event.data.content.map(imageAttachment).filter((ref): ref is ImageAttachmentRef => ref !== undefined)
  if (refs.length === 0) throw new Error('the latest direct user message has no image attachments')
  const indices = attachmentIndices === undefined ? refs.map((_ref, index) => index + 1) : [...attachmentIndices]
  if (indices.length === 0 || indices.some(index => !Number.isSafeInteger(index) || index < 1 || index > refs.length)
    || new Set(indices).size !== indices.length) {
    throw new Error('attachment_indices must contain unique 1-based image positions from the latest direct user message')
  }
  return indices.map(index => ({ index, ref: refs[index - 1]! }))
}
