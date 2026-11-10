import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { TeamConversation, TeamTimeline } from '../team-app-contract.js'
import { TeamMessageContent,teamAttachmentNavigationEntries } from './TeamMessageContent.js'
import {ArkmeAttachmentNavigationProvider} from './attachment-preview-navigation.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ArkmeTeamChannelAvatar } from './ArkmeTeamAvatar.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { groupTeamConversations, readTeamDirectory, refreshTeamDirectory, subscribeTeamDirectory } from './team-conversation-directory.js'
import { openTeamMessages, revokeTeamConversationRead, subscribeTeamMessageChanges } from './team-messaging-events.js'
import { mergeTeamMessages,withoutTeamConversationMaterial } from '../team-message-projection.js'
import {invalidateTeamMessageRead,isTeamAccessDenied,teamChangeAffectsConversationPreview,teamChangeAffectsSource,teamChangeInConversation} from './team-source-read.js'
import { teamDirectoryPreferences, type TeamEntryTarget } from './team-directory-preferences.js'
import { arkmeConversationAnchorOffset, arkmeConversationViewport } from './conversation-viewport.js'
import { arkmeConversationRestoredScrollTop, type ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'
import { TeamVisitorMembership } from './TeamVisitorMembership.js'

const button = { border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', padding: '6px 8px', fontSize: 13 }
/** Read-only history: deliberately does not mount the conversation pane, composer or read-ack effect. */
export function TeamConversationPreview({ accountKey, target, onClose }: { accountKey: string; target: Exclude<TeamEntryTarget,{kind:'group'}>; onClose(): void }) {
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const directory = useSyncExternalStore(subscribeTeamDirectory, () => readTeamDirectory(accountKey), () => readTeamDirectory(accountKey))
  const retainFolderIdentity = (value: TeamConversation): TeamConversation => {
    const retained = withoutTeamConversationMaterial(value)
    return directory.hasLoaded && retained.visitor ? { ...retained, visitor: { ...retained.visitor, memberType: 'unknown' } } : retained
  }
  const group = target.kind === 'folder' ? groupTeamConversations(directory.items,true,directory.workspaceFolders).find(group => group.key === target.group.key) ?? {...target.group, ...(target.group.latest?{latest:retainFolderIdentity(target.group.latest)}:{}), conversations:target.group.conversations.map(retainFolderIdentity)} : undefined
  const [chosen, setChosen] = useState<TeamConversation | undefined>(target.kind === 'conversation' ? target.conversation : undefined)
  const conversation = target.kind === 'conversation' ? target.conversation : chosen
  const [loadedConversation, setLoadedConversation] = useState<TeamConversation>()
  // A preview opens from a directory snapshot; the authorized timeline can carry newer identity data.
  const current = loadedConversation?.key === conversation?.key && loadedConversation?.side === conversation?.side ? loadedConversation : conversation
  const title = current ? current.side === 'team' ? current.visitor?.nickname ?? '用户' : current.channel.name : group?.channel.name ?? '团队消息'
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  // The selected folder row/back button can unmount during drill-in; keep Escape/Tab inside the modal.
  useLayoutEffect(() => { dialog.current?.focus({ preventScroll: true }) }, [conversation?.key])
  return createPortal(<div data-arkme-team-preview-backdrop style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.3)' }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title}的聊天预览`}
      style={{ width: 460, maxWidth: '100%', height: 520, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}
      onKeyDown={event => {
        if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== dialog.current) return
        event.stopPropagation()
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onClose() }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],audio[controls],video[controls],[tabindex="0"]')
          const first = controls?.[0], last = controls?.[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        {group && chosen && <button style={button} aria-label="返回团队预览" onClick={() => { setChosen(undefined); setLoadedConversation(undefined) }}><ArrowLeft size={16} /></button>}
        {current?.side === 'team' ? <ArkmeUserAvatar size={28} label={current.visitor?.nickname ?? '用户'} avatarRef={current.visitor?.imageRef} imageKey={current.visitor?.imageKey} imagePort={teamAvatarImages} />
          : <ArkmeTeamChannelAvatar channel={current?.channel ?? group!.channel} size={28} />}
        <strong style={{ fontSize: 16, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{title}</strong>
        {current && <TeamVisitorMembership conversation={current} />}
        <span style={{ flex: 'none', borderRadius: 99, background: arkmeTheme.subtle, color: arkmeTheme.secondary, padding: '3px 8px', fontSize: 11 }}>预览中</span>
        <ArkmeCloseButton style={{ ...button, marginLeft: 'auto', color: arkmeTheme.secondary }} aria-label="关闭聊天预览" onClick={onClose} />
      </header>
      {conversation ? <TeamPreviewMessages key={`${accountKey}:${conversation.key}`} accountKey={accountKey} conversation={conversation} onConversation={setLoadedConversation} />
        : <div aria-label="团队对话预览列表" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px' }}>
          {group&&group.conversations.length===0&&group.groupCount>0&&<p style={{fontSize:13,color:arkmeTheme.secondary}}>{group.preview||tr('团队群聊')}</p>}
          {group?.conversations.map(c => <button key={c.key} style={{ ...button, width: '100%', textAlign: 'left', padding: '12px 0', borderBottom: `1px solid ${arkmeTheme.borderSoft}`, color: arkmeTheme.text }} onClick={() => setChosen(c)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.visitor?.nickname ?? '用户'}</span><TeamVisitorMembership conversation={c} />{c.unread > 0 && <span style={{ marginLeft: 'auto', flexShrink: 0, color: arkmeTheme.accent }}>{c.unread} 条未读</span>}</span>
            <span style={{ display: 'block', marginTop: 5, fontSize: 12, color: arkmeTheme.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.preview?.status === 'available' ? c.preview.text || (c.preview.hasMedia ? '[附件]' : '[消息]') : '内容暂不可用'}</span>
          </button>)}
          {directory.error && <p role="alert">{directory.error}</p>}
          {(directory.hasMore || directory.error) && <button style={button} disabled={directory.loading} onClick={() => { void refreshTeamDirectory(accountKey, !directory.error) }}>{directory.loading ? '正在加载…' : directory.error ? '重试' : '加载更多对话'}</button>}
        </div>}
      <footer style={{ padding: '8px 16px', borderTop: `1px solid ${arkmeTheme.borderSoft}`, textAlign: 'right' }}>
        <button style={button} onClick={() => { void teamDirectoryPreferences.restoreTarget(accountKey, current ? { kind: 'conversation', conversation: current } : target, true).catch(() => {}); onClose(); openTeamMessages(current ? { kind: 'conversation', conversation: current } : { kind: 'team', teamRef: group!.channel.teamRef, channel: group!.channel }) }}>{conversation ? '打开对话' : '打开团队消息'}</button>
      </footer>
    </div>
  </div>, document.body)
}

function TeamPreviewMessages({ accountKey, conversation, onConversation }: { accountKey: string; conversation: TeamConversation; onConversation: Dispatch<SetStateAction<TeamConversation | undefined>> }) {
  const [page, setPage] = useState<TeamTimeline>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [request, setRequest] = useState({ before: 0, attempt: 0 })
  const generation = useRef(0), loaded = useRef<TeamTimeline>()
  const revalidateFrom = useRef(Infinity)
  const body = useRef<HTMLDivElement>(null), viewport = useRef<ArkmeConversationViewportSnapshot>()
  function showPage(next: TeamTimeline | undefined) {
    viewport.current = loaded.current && body.current ? arkmeConversationViewport(body.current) : undefined
    loaded.current = next
    setPage(next)
  }
  useLayoutEffect(() => subscribeTeamMessageChanges((account, receiptOnly,change) => {
    if (account !== accountKey || receiptOnly || !teamChangeInConversation(change, conversation.key)) return
    if (change?.kind === 'team.access.revoked') {
      ++generation.current
      revalidateFrom.current = Infinity
      showPage(undefined)
      setLoading(false)
      setError(tr('你已无权访问该团队消息，请刷新列表'))
      onConversation(previous => {
        const latest = previous ?? conversation
        return withoutTeamConversationMaterial(latest.visitor ? {...latest, visitor:{...latest.visitor,memberType:'unknown'}} : latest)
      })
      return
    }
    const revalidate = teamChangeAffectsSource(change,{conversationKey:conversation.key})
    if (!revalidate && change?.kind !== 'team.message.published') return
    ++generation.current
    const old = loaded.current
    if (revalidate && old) {
      const messages = old.messages.map(row => {
        const next = invalidateTeamMessageRead(row,change,conversation.key)
        if (row !== next) revalidateFrom.current = Math.min(revalidateFrom.current, row.seq)
        return next
      })
      showPage({...old, conversation:teamChangeAffectsConversationPreview(change,old.conversation) ? withoutTeamConversationMaterial(old.conversation) : old.conversation, messages})
    }
    setRequest(value => ({before:0, attempt:value.attempt+1}))
  }), [accountKey, conversation, onConversation])
  useEffect(() => {
    const controller = new AbortController(), token = ++generation.current
    setLoading(true); setError('')
    const readPage = async (beforeSeq: number) => {
      const value = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq, limit: 30 }, controller.signal)
      controller.signal.throwIfAborted()
      if (value.hasMore && (!value.beforeSeq || beforeSeq > 0 && value.beforeSeq >= beforeSeq)) throw new Error('消息分页异常，请重试')
      return value
    }
    const readWindow = async () => {
      const old = loaded.current
      const head = await readPage(request.before)
      const incoming = [...head.messages]
      let last = head
      // Bridge a gap after a burst of publications, or read through a changed
      // historical occurrence. Previously loaded, unaffected older pages stay put.
      const through = Math.min(old?.messages.at(-1)?.seq ?? 0, revalidateFrom.current)
      while (!request.before && through > 0 && last.hasMore && last.beforeSeq > through) {
        if (token !== generation.current) return
        last = await readPage(last.beforeSeq)
        incoming.push(...last.messages)
      }
      if (token !== generation.current) return
      const keepOlder = !!old && last.hasMore && (old.messages[0]?.seq ?? Infinity) < last.beforeSeq
      const cursor = !request.before && keepOlder ? old : last
      const keys = new Set(incoming.map(row => row.key))
      const messages = mergeTeamMessages(old?.messages ?? [], incoming).filter(row =>
        request.before > 0 || keys.has(row.key) || keepOlder && row.seq < last.beforeSeq)
      if (!request.before) revalidateFrom.current = Infinity
      showPage({...head, hasMore:cursor.hasMore, beforeSeq:cursor.beforeSeq, messages})
      onConversation(head.conversation)
    }
    void readWindow().catch(caught => {
        if (controller.signal.aborted || token !== generation.current) return
        if (isTeamAccessDenied(caught)) revokeTeamConversationRead(accountKey, conversation.key)
        setError(caught instanceof Error ? caught.message : '加载失败，请重试')
        onConversation(previous => {
          const latest = previous?.key === conversation.key && previous.side === conversation.side ? previous : conversation
          return latest.visitor ? { ...latest, visitor: { ...latest.visitor, memberType: 'unknown' } } : latest
        })
      })
      .finally(() => { if (!controller.signal.aborted && token === generation.current) setLoading(false) })
    return () => controller.abort()
  }, [accountKey, conversation.ref, request, onConversation])
  useLayoutEffect(() => {
    const node = body.current
    if (!node || !page) return
    const offset = arkmeConversationAnchorOffset(node,viewport.current?.anchorId)
    node.scrollTop = arkmeConversationRestoredScrollTop(viewport.current,{currentScrollTop:node.scrollTop,scrollHeight:node.scrollHeight,...(offset === undefined ? {} : {anchorOffset:offset})})
  }, [page])
  return <div ref={body} aria-label="预览消息列表" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 16px 16px' }}>
    {error && <p role="alert">{error}<button style={button} onClick={() => setRequest(value => ({ before: page ? value.before : 0, attempt: value.attempt + 1 }))}>{tr('重试')}</button></p>}
    {page?.hasMore && !error && <button style={button} disabled={loading} onClick={() => setRequest(value => ({ before: page.beforeSeq, attempt: value.attempt + 1 }))}>{loading ? '正在加载…' : '加载更早消息'}</button>}
    {loading && !page && <p role="status">正在加载消息…</p>}
    {!loading && !error && !page?.messages.length && <p>暂无消息</p>}
    <ArkmeAttachmentNavigationProvider scopeKey={JSON.stringify([accountKey,conversation.side,conversation.key])} entries={teamAttachmentNavigationEntries(page?.messages??[],conversation,accountKey)}>
    {page?.messages.map(message => <article key={message.key} data-arkme-conversation-row={message.key} style={{ display: 'flex', flexDirection: message.own ? 'row-reverse' : 'row', gap: 8, marginTop: 14 }}>
      <ArkmeUserAvatar size={30} label={message.sender.nickname} avatarRef={message.sender.imageRef} imageKey={message.sender.imageKey} imagePort={teamAvatarImages} />
      <div style={{ maxWidth: 'calc(100% - 38px)', minWidth: 0 }}>
        <div style={{ fontSize: 11, color: arkmeTheme.secondary, marginBottom: 4 }}>{message.sender.nickname} · {new Date(message.createdAt).toLocaleString()}</div>
        <div style={{ padding: '8px 10px', borderRadius: 10, background: message.own ? arkmeTheme.messageOwn : arkmeTheme.messageOther }}>
          {message.state === 'published' && message.contentStatus === 'available' ? <TeamMessageContent readOnly attachmentNavigationKey={message.key} message={message} conversationRef={conversation.ref} conversationKey={conversation.key} /> : <span style={{ color: arkmeTheme.secondary }}>消息已删除或暂不可用</span>}
        </div>
      </div>
    </article>)}
    </ArkmeAttachmentNavigationProvider>
  </div>
}
