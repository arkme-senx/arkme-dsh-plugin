import type { TeamConversation, TeamMessage, TeamTimeline } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { prepareAskDshNotes } from './ask-dsh-notes.js'
import { teamMessagePresentation } from './TeamMessageContent.js'

export const canAskDshTeamMessage = (message: TeamMessage): boolean => message.state === 'published'
  && message.contentStatus === 'available' && !!message.content && message.seq > 0

/** Reauthorize selected versions only. Never pass Team references to Chat APIs. */
export async function prepareTeamAskDsh(conversation: TeamConversation, messages: readonly TeamMessage[],
  accountKey: string, signal: AbortSignal, progress: (text: string) => void): Promise<File[]> {
  if (!messages.length || messages.length > 100 || messages.some(message => !canAskDshTeamMessage(message))) throw new Error('请选择 1 至 100 条可读取的消息')
  const verified: TeamMessage[] = new Array(messages.length)
  let next = 0
  const controller = new AbortController(), readSignal = AbortSignal.any([signal, controller.signal])
  try { await Promise.all(Array.from({ length: Math.min(4, messages.length) }, async () => {
    while (next < messages.length) {
      readSignal.throwIfAborted()
      const index = next++, selected = messages[index]!
      const page = await callArkme<TeamTimeline>('team.app.timeline', {
        conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq: selected.seq + 1, limit: 1,
      }, readSignal)
      const fresh = page.messages.find(message => message.key === selected.key)
      if (page.conversation.key !== conversation.key || !fresh || !canAskDshTeamMessage(fresh)
        || fresh.version !== selected.version || JSON.stringify(fresh.content) !== JSON.stringify(selected.content)) {
        throw new Error('所选消息已变化或不可访问，请刷新后重新选择')
      }
      // Keep the viewer's contact remark; source bytes and authority come from the fresh read.
      verified[index] = { ...fresh, sender: { ...fresh.sender, nickname: selected.sender.nickname } }
    }
  })) } finally { controller.abort() }
  signal.throwIfAborted()
  const media = new Map(verified.flatMap(message => message.media.map(file => [file.ref, file] as const)))
  const source = conversation.side === 'team'
    ? `${conversation.channel.name} · ${conversation.visitor?.nickname ?? '外部用户'}` : conversation.channel.name
  const items = verified.map(message => ({ ...teamMessagePresentation(message), exportSourceName: source,
    contentBlocks: teamMessagePresentation(message).contentBlocks!.map(block => ({ ...block, originalRef: block.mediaRef })),
  }))
  return prepareAskDshNotes(items, {
    detail: async () => { throw new Error('团队消息附件不完整，请刷新后重试') },
    original: async (block, readSignal) => {
      const file = media.get(block.originalRef ?? '')
      if (!file) throw new Error('团队附件不可用')
      const url = new URL(file.url, window.location.origin)
      if (url.origin !== window.location.origin || !url.pathname.endsWith('/team/media') || url.searchParams.get('ref') !== file.ref) throw new Error('团队附件读取地址无效')
      const response = await fetch(url, { signal: readSignal, redirect: 'error' })
      if (!response.ok || response.headers.get('content-type')?.includes('application/json')) throw new Error('附件已失效或无权访问，请刷新消息')
      const blob = await response.blob()
      if (file.size > 0 && blob.size !== file.size) throw new Error('原附件不完整，请重试')
      return blob
    },
  }, signal, progress)
}
