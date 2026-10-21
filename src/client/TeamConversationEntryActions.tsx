import { useEffect, useState, type MouseEvent } from 'react'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { TeamConversationPreview } from './TeamConversationPreview.js'
import { teamDirectoryPreferences, teamEntryHidden, teamEntryKey, teamEntryPinned, useTeamDirectoryPreferences, type TeamEntryTarget } from './team-directory-preferences.js'

/** One menu and one preference owner for root folders, direct entries and the nested team directory. */
export function useTeamConversationEntryActions(accountKey: string | undefined, target: TeamEntryTarget) {
  const preferences = useTeamDirectoryPreferences(accountKey ?? '')
  const [point, setPoint] = useState<{ x: number; y: number }>(), [preview, setPreview] = useState(false), [error, setError] = useState('')
  const key = teamEntryKey(target), pinned = teamEntryPinned(preferences, target), hidden = teamEntryHidden(preferences, target)
  useEffect(() => { setPoint(undefined); setPreview(false); setError('') }, [accountKey, key])
  const name = target.kind === 'folder' ? target.group.channel.name : target.conversation.side === 'team' ? target.conversation.visitor?.nickname ?? '用户' : target.conversation.channel.name
  const mutate = (action: () => void) => { try { action(); setPoint(undefined); setError('') } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败，请重试') } }
  const restore = () => { if (accountKey) teamDirectoryPreferences.restore(accountKey, key) }
  return {
    pinned,
    open: (navigate: () => void) => mutate(() => { restore(); navigate() }),
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (!accountKey) return
      event.preventDefault(); event.stopPropagation(); setError('')
      const rect = event.currentTarget.getBoundingClientRect()
      setPoint(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + 20, y: rect.top + 20 })
    },
    overlays: <>
      {point && accountKey && <ArkmeActionMenu label={`${name}的会话操作`} point={point} onClose={() => setPoint(undefined)} actions={[
        { id: 'preview', label: '预览', onSelect: () => { setPoint(undefined); setPreview(true) } },
        { id: 'pin', label: pinned ? '取消置顶' : '置顶对话', onSelect: () => mutate(() => teamDirectoryPreferences.pin(accountKey, target, !pinned)) },
        { id: 'separator', type: 'separator' },
        { id: 'remove', label: hidden ? '恢复到列表' : '移除', danger: !hidden, onSelect: () => mutate(() => hidden ? restore() : teamDirectoryPreferences.remove(accountKey, target)) },
      ]} />}
      {error && <p role="alert" style={{ fontSize: 12 }}>{error}</p>}
      {preview && accountKey && <TeamConversationPreview key={`${accountKey}:${key}`} accountKey={accountKey} target={target} onClose={() => setPreview(false)} />}
    </>,
  }
}
