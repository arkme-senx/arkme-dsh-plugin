import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import type { TeamChannel } from '../team-app-contract.js'
import { ArkmeOverlayScrollArea } from './ArkmeOverlayScrollArea.js'
import { ArkmeTeamChannelAvatar } from './ArkmeTeamAvatar.js'
import { ArkmeTopicTagBadge } from './ArkmeTopicTagBadge.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { TeamConversationRow } from './TeamMessagingPanel.js'
import { conversationDirectoryStyles as styles, conversationTimeLabel } from './conversation-directory-presentation.js'
import { groupTeamConversations, readTeamDirectory, refreshTeamDirectory, subscribeTeamDirectory, type TeamConversationGroup } from './team-conversation-directory.js'
import { openTeamMessages } from './team-messaging-events.js'
import { openTeamOutbound } from './team-outbound.js'
import { UserPlus } from '@phosphor-icons/react/dist/icons/UserPlus'
import { arkmeUi, type ArkmeUiState } from './ui-controller.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { teamText as tr } from './team-messaging-i18n.js'
import { useArkmeLocale } from './locale.js'
import { ArkmePinnedCorner } from './ArkmePinnedCorner.js'
import { useTeamConversationEntryActions } from './TeamConversationEntryActions.js'
import { teamDirectoryPreferences, teamFolderEntryKey, teamEntryHidden, teamEntryPinned, useTeamDirectoryPreferences } from './team-directory-preferences.js'

export function TeamConversationGroupRow({ group, accountKey, selected = false, onClick }: {
  group: TeamConversationGroup; accountKey?: string; selected?: boolean; onClick(): void
}) {
  const actions = useTeamConversationEntryActions(accountKey, { kind: 'folder', group })
  const { latest, channel, unread } = group
  const preview = latest.preview?.status === 'available'
    ? latest.preview.text || (latest.preview.templateKind === 3 ? tr('[语音]') : latest.preview.hasMedia ? tr('[附件]') : '')
    : latest.preview ? tr('内容暂不可用') : ''
  return <><button type="button" role="treeitem" aria-selected={selected} data-team-folder={channel.jotmoId}
    className="team-conversation-row" data-arkme-feedback="neutral" onContextMenu={actions.onContextMenu} onClick={() => actions.open(onClick)}
    style={{ ...styles.chatRow, ...(selected ? { background: arkmeTheme.active } : {}) }}>
    {actions.pinned && <ArkmePinnedCorner />}
    <span style={styles.sourceAvatarWrap}>
      <ArkmeTeamChannelAvatar size={styles.sourceAvatarWrap.width} channel={channel} />
      {unread > 0 && <span style={styles.mentionUnread}>{unread > 99 ? '99+' : `${unread}${group.unreadExact ? '' : '+'}`}</span>}
    </span>
    <span data-arkme-conversation-content style={styles.chatContent}>
      <span style={styles.chatTop}>
        <span style={styles.entryName}>{channel.name}</span><ArkmeTopicTagBadge label={tr('团队')} selected={selected} truncate />
        <span style={{ ...styles.chatTime, marginLeft: 'auto' }}>{conversationTimeLabel(latest.updatedAt)}</span>
      </span>
      <span style={styles.chatBottom}><span style={styles.preview}><ArkmeRichText
        text={`${latest.visitor?.nickname ?? tr('用户')}：${preview}`} presentation="preview" emojiSize={20} /></span></span>
    </span>
  </button>{actions.overlays}</>
}

/** The same second-column workspace is used by root cards, contacts and member links. */
export function TeamConversationDirectory({ accountKey, folder, selectedKey, onBack }: {
  accountKey: string; folder: NonNullable<ArkmeUiState['teamDirectory']>; selectedKey?: string; onBack(): void
}) {
  useArkmeLocale()
  const directory = useSyncExternalStore(subscribeTeamDirectory, () => readTeamDirectory(accountKey), () => readTeamDirectory(accountKey))
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const preferences = useTeamDirectoryPreferences(accountKey)
  const [showRemoved, setShowRemoved] = useState(false)
  const channel = folder.channel
  useEffect(() => { setShowRemoved(false) }, [accountKey, channel?.jotmoId, folder.teamRef])
  useEffect(() => {
    setError('')
    if (!folder.teamRef || channel) return
    const controller = new AbortController(), teamRef = folder.teamRef
    void callArkme<TeamChannel>('team.app.channel', { teamRef, expectedAccountKey: accountKey }, controller.signal)
      .then(async value => {
        controller.signal.throwIfAborted()
        await teamDirectoryPreferences.restore(accountKey, teamFolderEntryKey(value.jotmoId))
        controller.signal.throwIfAborted()
        arkmeUi.resolveTeamDirectory(teamRef, value)
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : tr('暂时无法打开团队，请重试')) })
    return () => controller.abort()
  }, [accountKey, folder.teamRef, channel, attempt])
  const groups = groupTeamConversations(directory.items, directory.hasLoaded && !directory.hasMore && !directory.error)
  const items = channel ? groups.find(group => group.key === channel.jotmoId)?.conversations ?? [] : []
  const visibleItems = items.filter(c => !teamEntryHidden(preferences, { kind: 'conversation', conversation: c }))
    .sort((a, b) => Number(teamEntryPinned(preferences, { kind: 'conversation', conversation: b })) - Number(teamEntryPinned(preferences, { kind: 'conversation', conversation: a })))
  const removedItems = items.filter(c => teamEntryHidden(preferences, { kind: 'conversation', conversation: c }))
  const visibleGroups = groups.filter(group => !teamEntryHidden(preferences, { kind: 'folder', group }))
    .sort((a, b) => Number(teamEntryPinned(preferences, { kind: 'folder', group: b })) - Number(teamEntryPinned(preferences, { kind: 'folder', group: a })))
  const resolving = !!folder.teamRef && !channel
  const scroll = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLDivElement>(null)
  const scope = `${accountKey}:${channel?.jotmoId ?? folder.teamRef ?? 'teams'}`
  const restoredScope = useRef('')
  useLayoutEffect(() => {
    if (resolving || !directory.hasLoaded || restoredScope.current === scope || !scroll.current) return
    scroll.current.scrollTop = arkmeUi.readTeamDirectoryScroll(scope)
    restoredScope.current = scope
  }, [scope, resolving, directory.hasLoaded])
  useEffect(() => {
    if (resolving || directory.loading || directory.error || !directory.hasMore) return
    // A selected team's first conversation may be beyond the global first page.
    if (channel && items.length === 0) { void refreshTeamDirectory(accountKey, true); return }
    if (!sentinel.current || !scroll.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void refreshTeamDirectory(accountKey, true)
    }, { root: scroll.current, rootMargin: '160px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [accountKey, channel, resolving, items.length, directory.loading, directory.error, directory.hasMore])
  const initialLoading = resolving || !directory.hasLoaded
  return <section aria-label={tr('团队会话列表')} style={{ width:'100%',height:'100%',minHeight:0,display:'flex',flexDirection:'column',color:arkmeTheme.text,background:arkmeTheme.base }}>
    <header data-arkme-window-drag-region="conversation" style={{ minHeight:64,flex:'none',display:'flex',alignItems:'center',gap:8,padding:'0 16px',boxSizing:'border-box' }}>
      <button type="button" data-arkme-feedback="neutral" aria-label={tr('返回 Arkme 会话列表')} onClick={onBack}
        style={{width:30,height:30,display:'grid',placeItems:'center',padding:0,border:0,borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'}}><ArrowLeft size={20} /></button>
      <h2 style={{fontSize:15,lineHeight:'24px',fontWeight:500,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{channel?.name ?? tr('团队对话')}</h2>
      <button type="button" data-arkme-feedback="neutral" aria-label={tr('联系用户')} title={tr('联系用户')} disabled={resolving}
        style={{marginLeft:'auto',flexShrink:0,width:32,height:32,display:'grid',placeItems:'center',padding:0,border:0,borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'}}
        onClick={() => openTeamOutbound({ accountKey, teamJotmoId: channel?.jotmoId })}><UserPlus size={20} /></button>
    </header>
    <ArkmeOverlayScrollArea ref={scroll} aria-label={tr('团队会话列表')} style={{padding:'0 6px 8px'}}
      onScroll={event => { if (restoredScope.current === scope) arkmeUi.rememberTeamDirectoryScroll(scope,event.currentTarget.scrollTop) }}>
      {error && <div role="alert" className="team-opening-error"><p>{tr(error)}</p><button onClick={() => setAttempt(value=>value+1)}>{tr('重试')}</button></div>}
      {!error && <>
        <div role="tree" aria-label={channel?.name ?? tr('团队对话')}>
          {channel ? visibleItems.map(c => <TeamConversationRow key={c.key} accountKey={accountKey} conversation={c} showTeamName={false} selected={selectedKey===c.key} role="treeitem"
            onClick={() => openTeamMessages({kind:'conversation',conversation:c})} />)
            : !resolving && visibleGroups.map(group => <TeamConversationGroupRow key={group.key} accountKey={accountKey} group={group}
              onClick={() => openTeamMessages({kind:'team',teamRef:group.channel.teamRef,channel:group.channel})} />)}
        </div>
        {channel && removedItems.length > 0 && <div>
          <button type="button" onClick={() => setShowRemoved(value => !value)} style={{ border: 0, padding: '8px 12px', background: 'transparent', color: arkmeTheme.secondary, fontSize: 12, cursor: 'pointer' }}>{showRemoved ? '收起已移除对话' : `查看已移除对话 (${removedItems.length})`}</button>
          {showRemoved && removedItems.map(c => <TeamConversationRow key={c.key} accountKey={accountKey} conversation={c} showTeamName={false} onClick={() => openTeamMessages({ kind: 'conversation', conversation: c })} />)}
        </div>}
        {initialLoading ? <p className="team-empty" role="status">{tr('正在加载团队对话…')}</p>
          : !directory.error && (channel ? items.length : groups.length) === 0 && !directory.hasMore && <p className="team-empty">{tr('还没有团队对话')}</p>}
        {directory.error && <div className="team-opening-error" role="alert"><p>{tr(directory.error)}</p><button disabled={directory.loading} onClick={() => {void refreshTeamDirectory(accountKey)}}>{tr('重试')}</button></div>}
        {directory.hasMore && <div ref={sentinel} style={{minHeight:28,textAlign:'center',fontSize:12,color:arkmeTheme.secondary}}>{directory.loading ? tr('正在加载更多…') : ''}</div>}
      </>}
    </ArkmeOverlayScrollArea>
  </section>
}
