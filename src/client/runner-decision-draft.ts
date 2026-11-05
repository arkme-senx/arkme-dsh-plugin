import type { ArkmeGroupBotCandidate, ArkmeTimelineItem } from '../types.js'
import type { ArkmeComposerDraftStore } from './composer-draft-store.js'

/** Use the current group's opaque Bot identity; a display name is not an identity. */
export function prepareRunnerDecisionDraft(store: ArkmeComposerDraftStore, key: string,
  item: ArkmeTimelineItem, text: string, bots: readonly ArkmeGroupBotCandidate[]): number {
  const current = store.get(key)
  if (current.text.trim() || current.attachments.length || current.emojis.length || current.extensionTarget) {
    throw new Error('请先发送或保存当前草稿，再回复决策')
  }
  const matches = bots.filter(bot => bot.installed && bot.directoryKey
    && bot.directoryKey === item.senderBotDirectoryKey)
  if (item.senderKind !== 'bot' || matches.length !== 1) {
    throw new Error('暂时无法确认本群管家，请刷新群成员后重试')
  }
  const bot = matches[0]!
  if (!bot.botRef.trim() || !bot.name.trim()) throw new Error('本群管家身份不完整')
  store.setExtensionTarget(key, item)
  store.setText(key, text)
  store.insertBotMention(key, bot.botRef, bot.name, 0)
  return store.get(key).text.length
}
