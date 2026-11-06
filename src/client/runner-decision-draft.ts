import type { ArkmeTimelineItem } from '../types.js'
import type { ArkmeComposerDraftStore } from './composer-draft-store.js'
import { parseRunnerCard } from './ArkmeRunnerCard.js'

export function isRunnerTaskReply(item: ArkmeTimelineItem): boolean {
  return !!item.messageActionRef && !item.forwardRecords && !item.sharedRecording
    && parseRunnerCard(item.textContent, item.senderKind) !== undefined
}

/** The quoted message is the routing identity; Chat validates its author and group. */
export function prepareRunnerDecisionDraft(store: ArkmeComposerDraftStore, key: string,
  item: ArkmeTimelineItem, text: string): number {
  const current = store.get(key)
  if (current.text.trim() || current.attachments.length || current.emojis.length || current.extensionTarget) {
    throw new Error('请先发送或保存当前草稿，再补充这项工作')
  }
  if (!isRunnerTaskReply(item)) throw new Error('原任务消息不可用，请刷新群聊后重试')
  store.setExtensionTarget(key, item)
  store.setText(key, text)
  return store.get(key).text.length
}
