import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeSourceItem, ArkmeSourceList, ArkmeSourceSendResult } from '../types.js'
import type { TeamGroupIdentity } from '../team-group-contract.js'
import { arkmeSourceAllowsUserWrite } from '../topic-policy.js'
import { ArkmeForwardTargetDialog } from './ArkmeForwardTargetDialog.js'
import { forwardTargetStyles as styles } from './forward-target-styles.js'
import { ArkmeDirectorySourceAvatar, ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeTeamChannelAvatar } from './ArkmeTeamAvatar.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { ArkmePinnedCorner } from './ArkmePinnedCorner.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { TeamGroupIdentityPicker } from './TeamGroupControls.js'
import { requireDirectMessageSendAllowed } from './direct-message-admission.js'
import { useUnifiedForwardDirectory } from './unified-forward-directory.js'
import { forwardTargetKey, forwardTargetName, forwardTargetSubtitle, forwardTeamChildren, searchForwardRows, type ForwardTarget, type ForwardTargetRow } from './unified-forward-targets.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { invalidateTeamMessages } from './team-messaging-events.js'
import { tr } from './locale.js'
import { useForwardTeamWorkspace } from './use-forward-team-workspace.js'
import { mergeTeamWorkspaceRows, teamWorkspaceTarget } from './team-workspace-rows.js'
import { openedTeamConversations } from './team-opened-conversations.js'
import { teamDirectoryPreferences, teamEntryHidden, teamEntryPinned } from './team-directory-preferences.js'

export interface UnifiedForwardAttempt {
  readonly commentText: string | undefined
  hasAttempt(key: string): boolean
  send(target: ForwardTarget, comment: string, signal: AbortSignal, representation?: TeamGroupIdentity): Promise<ArkmeSourceSendResult>
}
export function ForwardTargetAvatar({ target, size = 38 }: { target: ForwardTarget; size?: number }) {
  return target.kind === 'source' ? <ArkmeDirectorySourceAvatar source={target.source} size={size}/>
    : target.conversation.side === 'team' && target.conversation.visitor
      ? <ArkmeUserAvatar avatarRef={target.conversation.visitor.imageRef} imageKey={target.conversation.visitor.imageKey} imagePort={teamAvatarImages} size={size} label={target.conversation.visitor.nickname}/>
      : <ArkmeTeamChannelAvatar channel={target.conversation.channel} size={size}/>
}

/** Shared directory, navigation, selection and feedback for both source owners. */
export function UnifiedForwardDialog({ accountKey, attempt, previewTitle, previewSubtitle, onClose, onComplete, groupIdentity = false, fixed = false }: {
  accountKey: string; attempt: UnifiedForwardAttempt; previewTitle: string; previewSubtitle: string;
  onClose(): void; onComplete(targets: readonly ForwardTarget[]): void; groupIdentity?: boolean; fixed?: boolean;
}) {
  const directory = useUnifiedForwardDirectory(accountKey)
  const [folder, setFolder] = useState<{ kind: 'self' } | { kind: 'team'; key: string }>(), [topics, setTopics] = useState<ArkmeSourceItem[]>([])
  const [topicLoading, setTopicLoading] = useState(false), [topicCursor, setTopicCursor] = useState<string>()
  const [selected, setSelected] = useState(new Map<string, ForwardTarget>()), [keyword, setKeyword] = useState(''), [comment, setComment] = useState(attempt.commentText ?? '')
  const [error, setError] = useState(''), [sending, setSending] = useState(false), [results, setResults] = useState(new Map<string, string>())
  const [identities, setIdentities] = useState<Record<string, TeamGroupIdentity | undefined>>({})
  const alive = useRef(false), busy = useRef(false), controller = useRef(new AbortController()), topicRequest = useRef<AbortController>()
  const current = () => { const auth = arkmeAuthStore.getSnapshot().auth; return alive.current && !controller.current.signal.aborted && auth?.status === 'authenticated' && `${auth.environment}:${auth.userId}` === accountKey }
  useEffect(() => {
    alive.current = true; if (controller.current.signal.aborted) controller.current = new AbortController()
    const stop = arkmeAuthStore.subscribe(() => { if (!current()) { controller.current.abort(); onClose() } })
    void directory.refresh().catch(() => { if (current()) setError(tr('目标列表刷新失败，请重试')) })
    return () => { alive.current = false; controller.current.abort(); topicRequest.current?.abort(); stop() }
  }, [accountKey, attempt])
  const loadTopics = async (cursor?: string) => {
    topicRequest.current?.abort(); const request = new AbortController(); topicRequest.current = request
    setTopicLoading(true); setError('')
    try {
      const page = await callArkme<ArkmeSourceList>('sources.list', { directory: 'send_to_self', limit: 50, ...(cursor ? { cursor } : {}) }, request.signal)
      if (!current() || request.signal.aborted) return
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error(tr('目标列表分页暂不可用，请刷新后重试'))
      setTopics(previous => [...new Map([...(cursor ? previous : []), ...page.items.filter(arkmeSourceAllowsUserWrite)].map(source => [forwardTargetKey({ kind: 'source', source }), source])).values()])
      setTopicCursor(page.hasMore ? page.nextCursor : undefined)
    } catch (reason) { if (current() && !request.signal.aborted) setError(reason instanceof Error ? reason.message : tr('加载失败')) }
    finally { if (current() && !request.signal.aborted) setTopicLoading(false) }
  }
  const groups = directory.rows.flatMap(row => row.kind === 'folder' ? [row.group] : [])
  const workspace = useForwardTeamWorkspace(accountKey, groups, folder?.kind === 'team' ? folder.key : undefined, directory.workspaceSupported)
  const group = groups.find(group => folder?.kind === 'team' && group.key === folder.key)
  const childrenFor = (group: typeof groups[number]): ForwardTargetRow[] => {
    const view = workspace.views[group.key]
    if (!view) return forwardTeamChildren(group, directory.preferences)
    return mergeTeamWorkspaceRows({ channel: group.channel, rows: view.rows, pinRows: view.pinRows,
      conversations: directory.conversations, opened: openedTeamConversations.read(accountKey), hasPage: !!view.page, preferences: directory.preferences,
      canPresent: target => teamDirectoryPreferences.canPresentTarget(accountKey, target) })
      .filter(row => !teamEntryHidden(directory.preferences, teamWorkspaceTarget(row, group.channel))
        && (row.kind === 'customer' || arkmeSourceAllowsUserWrite(row.source)))
      .map(row => ({ kind: 'target', target: row.kind === 'customer' ? { kind: 'team', conversation: row.conversation } : { kind: 'source', source: row.source, workspace: group.channel },
        pinned: teamEntryPinned(directory.preferences, teamWorkspaceTarget(row, group.channel)), activeAtMillis: row.activityAt }))
  }
  const activeWorkspace = group && directory.workspaceSupported ? workspace.views[group.key] : undefined
  const workspaceLoading = !!group && directory.workspaceSupported && (!activeWorkspace || activeWorkspace.loading)
  const workspaceError = activeWorkspace?.error ?? ''
  const rawRows: ForwardTargetRow[] = folder?.kind === 'self' ? topics.map(source => ({ kind: 'target', target: { kind: 'source', source }, pinned: source.isPinned === true, activeAtMillis: source.activeAtMillis }))
    : group ? childrenFor(group) : directory.rows
  const rows = searchForwardRows(rawRows, keyword, directory.preferences, childrenFor)
  const liveTargets = directory.rows.flatMap(row => row.kind === 'target' ? [row.target] : childrenFor(row.group).flatMap(child => child.kind === 'target' ? [child.target] : []))
    .concat(topics.map(source => ({ kind: 'source' as const, source })))
  const latest = new Map(liveTargets.map(target => [forwardTargetKey(target), target]))
  const latestTargets = useRef(latest)
  latestTargets.current = latest
  const availableKeys = JSON.stringify([...latest.keys()])
  useEffect(() => {
    setSelected(previous => {
      const next = new Map([...previous].filter(([key]) => latestTargets.current.has(key) || attempt.hasAttempt(key)))
      return next.size === previous.size ? previous : next
    })
  }, [availableKeys, attempt])
  const toggle = async (target: ForwardTarget) => {
    if (!current() || busy.current) return
    const key = forwardTargetKey(target)
    if (selected.has(key)) { setSelected(previous => { const next = new Map(previous); next.delete(key); return next }); return }
    if (selected.size >= 5) { setError(tr('最多选择 5 个转发对象')); return }
    try { if (target.kind === 'source' && target.source.directMessageAdmissionApplicable === true && !attempt.hasAttempt(key)) await requireDirectMessageSendAllowed(target.source, controller.current.signal)
      if (target.kind === 'team' && (target.conversation.blocked || !target.conversation.channel.enabled) && !attempt.hasAttempt(key)) throw new Error(tr('该团队对话暂时不能发送'))
      if (current() && !busy.current && latestTargets.current.has(key)) setSelected(previous => previous.size >= 5 ? previous : new Map(previous).set(key, latestTargets.current.get(key)!))
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : tr('发送失败')) }
  }
  const send = async () => {
    if (!current() || busy.current || !selected.size) return
    busy.current = true; setSending(true); setError(''); let complete = true
    try {
      for (const [key, previous] of selected) {
        if (!current()) return
        try {
          const target = latest.get(key)
          if (!target && !attempt.hasAttempt(key)) throw new Error(tr('该转发对象已不可用，请重新选择'))
          const chosen = target ?? previous
          if (chosen.kind === 'source' && !attempt.hasAttempt(key)) await requireDirectMessageSendAllowed(chosen.source, controller.current.signal)
          if (chosen.kind === 'team' && (chosen.conversation.blocked || !chosen.conversation.channel.enabled) && !attempt.hasAttempt(key)) throw new Error(tr('该团队对话暂时不能发送'))
          const receipt = await attempt.send(chosen, comment, controller.current.signal, identities[key])
          if (!current()) return
          if (chosen.kind === 'team') invalidateTeamMessages(accountKey)
          setResults(value => new Map(value).set(key, receipt.warningText || tr('已转发')))
          if (receipt.warningText) complete = false
        } catch (reason) { complete = false; if (current()) { const message = reason instanceof Error ? reason.message : tr('转发结果尚未确认，请使用原请求重试'); setError(message); setResults(value => new Map(value).set(key, message)) } }
      }
      if (complete && current()) onComplete([...selected.values()])
    } finally { busy.current = false; if (current()) setSending(false) }
  }
  const avatars: ReactNode = selected.size ? <>{[...selected.values()].map(target => <ForwardTargetAvatar key={forwardTargetKey(target)} target={latest.get(forwardTargetKey(target)) ?? target} size={26}/>)}</> : undefined
  const renderedRows = rows.map(row => row.kind === 'folder' ? <li key={`folder:${row.group.key}`}><button type="button" style={styles.forwardTargetRow} disabled={sending} aria-label={tr('展开团队 {v0}', { v0: row.group.channel.name })} onClick={() => { setFolder({ kind: 'team', key: row.group.key }); setKeyword('') }}>
        {row.pinned && <ArkmePinnedCorner/>}<span style={styles.forwardTargetCheck} aria-hidden>›</span><ArkmeTeamChannelAvatar channel={row.group.channel} size={38}/><span style={styles.forwardTargetText}><span style={styles.forwardTargetName}>{row.group.channel.name}</span><span style={styles.forwardTargetMeta}>{tr('选择具体团队会话')}</span></span><span aria-hidden>›</span>
      </button></li> : <li key={forwardTargetKey(row.target)}><div style={{ display: 'flex', alignItems: 'center' }}><button data-arkme-feedback="neutral" type="button" style={{ ...styles.forwardTargetRow, ...(selected.has(forwardTargetKey(row.target)) ? styles.forwardTargetRowSelected : {}) }} disabled={sending} aria-pressed={selected.has(forwardTargetKey(row.target))} onClick={() => { void toggle(row.target) }}>
        {row.pinned && <ArkmePinnedCorner/>}<span style={{ ...styles.forwardTargetCheck, ...(selected.has(forwardTargetKey(row.target)) ? styles.forwardTargetCheckSelected : {}) }} aria-hidden>✓</span><ForwardTargetAvatar target={row.target}/><span style={styles.forwardTargetText}><span style={styles.forwardTargetName}><ArkmeRichText text={forwardTargetName(row.target)} presentation="preview"/></span><span style={styles.forwardTargetMeta}><ArkmeRichText text={results.get(forwardTargetKey(row.target)) || forwardTargetSubtitle(row.target)} presentation="preview"/></span></span>
      </button>{!folder && row.target.kind === 'source' && row.target.source.kind === 'send_to_self' && <button type="button" disabled={sending} aria-label={tr('选择本人主题')} onClick={() => { setFolder({ kind: 'self' }); setKeyword(''); void loadTopics() }}>›</button>}</div></li>)
  if (!folder && !keyword.trim() && !rawRows.some(row => row.kind === 'target' && row.target.kind === 'source' && row.target.source.kind === 'send_to_self')) renderedRows.unshift(<li key="self"><div aria-disabled="true" aria-label={tr('发给自己暂不可用')} style={{ ...styles.forwardTargetRow, cursor: 'default' }}><span style={styles.forwardTargetCheck} aria-hidden/><ArkmeDirectorySourceAvatar source={{ kind: 'send_to_self' }} size={38}/><span style={styles.forwardTargetText}><span style={styles.forwardTargetName}>{tr('发给自己')}</span><span style={styles.forwardTargetMeta}>{tr('默认分类')}</span></span></div></li>)
  const dialog = <ArkmeForwardTargetDialog fixed={fixed} keyword={keyword} busy={sending} onClose={onClose} onKeywordChange={setKeyword}
    previewTitle={previewTitle} previewSubtitle={previewSubtitle} selectedAvatars={avatars} comment={attempt.commentText ?? comment} commentFrozen={attempt.commentText !== undefined}
    onCommentChange={setComment} error={error} onSubmit={() => { void send() }}
    identityControls={[...selected].flatMap(([key, target]) => target.kind === 'source' && target.source.kind === 'group_chat' && (groupIdentity || target.source.accessKind === 'team_delegation') ? [<div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>{target.source.displayName}</span><TeamGroupIdentityPicker accountKey={accountKey} sourceRef={target.source.sourceRef} value={identities[key]} disabled={sending || attempt.hasAttempt(key)} onSelect={value => setIdentities(previous => ({ ...previous, [key]: value }))}/></div>] : [])}>
    {folder && <button type="button" disabled={sending} onClick={() => { topicRequest.current?.abort(); setFolder(undefined); setKeyword('') }}>{tr('返回转发对象')}</button>}
    <ul style={styles.forwardTargetList} aria-label={tr('转发对象列表')}>

      {renderedRows}
      {!rows.length && <li role="status" style={styles.forwardTargetStatus}>{tr(topicLoading || directory.loading || workspaceLoading ? '正在加载转发对象...' : '暂无可转发对象')}</li>}
      {folder?.kind === 'self' && topicCursor && <li><button type="button" disabled={sending || topicLoading} onClick={() => { void loadTopics(topicCursor) }}>{tr('更多')}</button></li>}
      {group && directory.workspaceSupported
        ? activeWorkspace?.page?.hasMore && activeWorkspace.page.complete && !activeWorkspace.page.resetRequired && <li><button type="button" disabled={sending || workspaceLoading} onClick={() => { void workspace.load(group.key, true) }}>{tr('更多团队会话')}</button></li>
        : folder?.kind !== 'self' && directory.hasMore && <li><button type="button" disabled={sending || directory.loading} onClick={() => { void directory.refresh(true).catch(() => setError(tr('目标列表刷新失败，请重试'))) }}>{tr('更多团队会话')}</button></li>}

    </ul>
    {[...selected].map(([key, target]) => results.has(key) ? <div role="status" key={key} style={styles.forwardTargetStatus}>{forwardTargetName(target)}：{results.get(key)}</div> : null)}
    {(workspaceError || directory.error || error && !selected.size) && <div role="alert" style={styles.forwardTargetStatus}>{workspaceError || directory.error || error}<button type="button" disabled={sending} onClick={() => { if (folder?.kind === 'self') void loadTopics(); else if (group && directory.workspaceSupported) void workspace.load(group.key); else void directory.refresh(false, true).catch(() => setError(tr('目标列表刷新失败，请重试'))) }}>{tr('重试')}</button></div>}
  </ArkmeForwardTargetDialog>
  return fixed && typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog
}
