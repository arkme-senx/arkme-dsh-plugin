import { arkmeMarkdownPlainText, arkmeMarkdownTextRanges } from '../markdown.js'
import { parseArkmeRecordReeditMentions, type ArkmeRecordReeditMention } from '../record-reedit-contract.js'
import type { ArkmeHumanMentionInput, ArkmeBotMentionInput } from '../types.js'
import { ArkmePluginError, objectValue, stringValue } from './service.js'
import { encodeMentionMetadata, type ResolvedMentions, type MentionMetadataEntries } from './mention-metadata-codec.js'

export type NewMentionResolver = (
  humans: ArkmeHumanMentionInput[], bots: ArkmeBotMentionInput[],
) => Promise<ResolvedMentions>

function originalMentions(payload: Record<string, unknown> | undefined) {
  const metadata = objectValue(payload?.mention_metadata)
  return (['human_mentions', 'bot_mentions'] as const).flatMap(kind => {
    const entries = metadata[kind]
    return Array.isArray(entries) ? entries.map(raw => ({ kind, value: objectValue(raw) })) : []
  })
}

function originalDisplayName(value: Record<string, unknown>, text: string, textFormat: 'plain' | 'markdown'): string {
  const snapshot = stringValue(value.display_name_snapshot)
  if (snapshot !== '') return snapshot
  const span = text.slice(Number(value.start_index), Number(value.start_index) + Number(value.length))
  const visible = textFormat === 'markdown' ? arkmeMarkdownPlainText(span) : span
  return visible.startsWith('@') ? visible.slice(1) : ''
}

export function recordReeditMentionProjection(payload: Record<string, unknown> | undefined, text: string, textFormat: 'plain' | 'markdown'): ArkmeRecordReeditMention[] {
  return originalMentions(payload).map(({ value }, originalIndex) => ({
    originalIndex, displayName: originalDisplayName(value, text, textFormat),
    startIndex: Number(value.start_index), length: Number(value.length),
  }))
}

export function prepareRecordReeditMentions(
  payload: Record<string, unknown> | undefined, originalText: string, text: string,
  inputs: ArkmeRecordReeditMention[], allowHumanMentions: boolean, textFormat: 'plain' | 'markdown',
) {
  const mentions = parseArkmeRecordReeditMentions(inputs).sort((a, b) => a.startIndex - b.startIndex)
  const originals = originalMentions(payload)
  const humans: ArkmeHumanMentionInput[] = []
  const bots: ArkmeBotMentionInput[] = []
  const existing: MentionMetadataEntries = { humans: [], bots: [] }
  const used = new Set<number>()
  const visible = (span: string) => textFormat === 'markdown' ? arkmeMarkdownPlainText(span) : span
  const textRanges = textFormat === 'markdown' ? arkmeMarkdownTextRanges(text) : undefined
  let end = 0
  for (const mention of mentions) {
    if (mention.startIndex < end || mention.startIndex + mention.length > text.length
      || visible(text.slice(mention.startIndex, mention.startIndex + mention.length)) !== `@${mention.displayName}`
      || (textRanges && !textRanges.some(range => mention.startIndex >= range.start && mention.startIndex + mention.length <= range.end))) {
      throw new ArkmePluginError('record-reedit-mention-invalid', '@ 文本或位置已变化，请重新选择', false, 409)
    }
    end = mention.startIndex + mention.length
    if (mention.originalIndex !== undefined) {
      const original = originals[mention.originalIndex]
      if (!original || used.has(mention.originalIndex) || mention.displayName !== originalDisplayName(original.value, originalText, textFormat)
        || visible(originalText.slice(Number(original.value.start_index), Number(original.value.start_index) + Number(original.value.length))) !== `@${mention.displayName}`) {
        throw new ArkmePluginError('record-reedit-mention-invalid', '原 @ 内容已变化，请重新打开编辑', false, 409)
      }
      const { start_index: start, length, display_name_snapshot: snapshot } = original.value
      if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0
        || typeof length !== 'number' || !Number.isSafeInteger(length) || length < 2 || start + length > originalText.length
        || (snapshot !== undefined && typeof snapshot !== 'string')) {
        throw new ArkmePluginError('record-reedit-mention-invalid', '原 @ 数据无效，请移除该引用后重新选择', false, 409)
      }
      const span = { start_index: mention.startIndex, length: mention.length,
        ...(snapshot === undefined ? {} : { display_name_snapshot: snapshot }) }
      if (original.kind === 'human_mentions') {
        const userId = original.value.user_id
        if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId < 0) {
          throw new ArkmePluginError('record-reedit-mention-invalid', '原 @ 身份无效，请移除该引用后重新选择', false, 409)
        }
        existing.humans.push({ ...span, user_id: userId })
      } else {
        const botUid = original.value.bot_uid
        if (typeof botUid !== 'string' || botUid.trim() === '' || botUid !== botUid.trim()) {
          throw new ArkmePluginError('record-reedit-mention-invalid', '原 @ 身份无效，请移除该引用后重新选择', false, 409)
        }
        existing.bots.push({ ...span, bot_uid: botUid })
      }
      used.add(mention.originalIndex)
    } else if (mention.botRef !== undefined) {
      bots.push({ botRef: mention.botRef, startIndex: mention.startIndex, length: mention.length })
    } else {
      if (!allowHumanMentions) throw new ArkmePluginError('mention-chat-required', '真人 @ 只能添加到群聊', false)
      humans.push(mention.all === true ? { all: true, startIndex: mention.startIndex, length: mention.length }
        : { mentionRef: mention.mentionRef!, startIndex: mention.startIndex, length: mention.length })
    }
  }
  return { existing, humans, bots }
}

export async function recordReeditMentionMetadata(
  text: string, prepared: ReturnType<typeof prepareRecordReeditMentions>, resolve?: NewMentionResolver,
): Promise<Record<string, unknown> | undefined> {
  const { existing, humans, bots } = prepared
  let added: ResolvedMentions = { humans: [], bots: [] }
  if (humans.length || bots.length) {
    if (!resolve) throw new ArkmePluginError('record-reedit-mention-unavailable', '@ 校验暂不可用，请稍后重试', true)
    added = await resolve(humans, bots)
  }
  const mentions = {
    humans: [...existing.humans, ...added.humans].sort((a, b) => a.start_index - b.start_index),
    bots: [...existing.bots, ...added.bots].sort((a, b) => a.start_index - b.start_index),
  }
  return mentions.humans.length || mentions.bots.length ? encodeMentionMetadata(text, mentions) : undefined
}
