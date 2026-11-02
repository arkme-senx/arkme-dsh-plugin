import { useConversationActionFeedback } from './use-conversation-action-feedback.js'
import { useTeamEntryRemovalActions } from './TeamEntryRemovalFeedback.js'
import { ArkmeConversationRemovalFeedback, conversationRemovalRowStyle } from './ArkmeConversationRemovalFeedback.js'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { TeamConversationPreview } from './TeamConversationPreview.js'
import { teamDirectoryPreferences, teamEntryHidden, teamEntryKey, teamEntryPinned, useTeamDirectoryPreferences, type TeamEntryTarget } from './team-directory-preferences.js'

/** One menu and one preference owner for root folders, direct entries and the nested team directory. */
export function useTeamConversationEntryActions(accountKey: string | undefined, target: TeamEntryTarget) {
  const removal = useTeamEntryRemovalActions()
  const phase = removal?.phase(target)
  const preferences = useTeamDirectoryPreferences(accountKey ?? '')
  const [point, setPoint] = useState<{ x: number; y: number }>(), [preview, setPreview] = useState(false)
  const key = teamEntryKey(target), pinned = teamEntryPinned(preferences, target), hidden = teamEntryHidden(preferences, target)
  const scope = useMemo(() => ({}), [accountKey, key])
  const feedback = useConversationActionFeedback(scope)
  useEffect(() => { setPoint(undefined); setPreview(false) }, [accountKey, key])
  const name = target.kind === 'folder' ? target.group.channel.name : target.conversation.side === 'team' ? target.conversation.visitor?.nickname ?? '用户' : target.conversation.channel.name
  const mutate = async (action: () => void | Promise<void>, success?: string) => { setPoint(undefined); try { await action(); if (success) feedback.notify(success) } catch (caught) { feedback.notify(caught instanceof Error ? caught.message : '操作失败，请重试') } }
  const restore = (navigation = false) => { if (accountKey) return teamDirectoryPreferences.restoreTarget(accountKey, target, navigation) }
  return {
    pinned: removal?.pinned(target) ?? pinned,
    phase,
    rowStyle: conversationRemovalRowStyle(phase),
    feedback: <ArkmeConversationRemovalFeedback phase={phase} message="已移除，可在团队中重新打开" />,
    open: (navigate: () => void) => phase ? Promise.resolve() : mutate(async () => { const saved = restore(true); navigate(); await saved }),
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation()
      if (!accountKey || phase) return
      feedback.notify(undefined)
      const rect = event.currentTarget.getBoundingClientRect()
      setPoint(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + 20, y: rect.top + 20 })
    },
    overlays: <>
      {point && accountKey && <ArkmeActionMenu label={`${name}的会话操作`} point={point} onClose={() => setPoint(undefined)} actions={[
        { id: 'preview', label: '预览', onSelect: () => { setPoint(undefined); setPreview(true) } },
        { id: 'pin', label: pinned ? '取消置顶' : '置顶对话', onSelect: () => mutate(() => teamDirectoryPreferences.pin(accountKey, target, !pinned), pinned ? '已取消置顶' : '已置顶对话') },
        { id: 'separator', type: 'separator' },
        { id: 'remove', label: hidden ? '恢复到列表' : '移除', danger: !hidden, onSelect: () => mutate(() => hidden ? restore() : removal ? removal.remove(target) : teamDirectoryPreferences.remove(accountKey, target)) },
      ]} />}
      {feedback.feedback}
      {preview && accountKey && <TeamConversationPreview key={`${accountKey}:${key}`} accountKey={accountKey} target={target} onClose={() => setPreview(false)} />}
    </>,
  }
}
