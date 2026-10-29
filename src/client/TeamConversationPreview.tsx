import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { TeamConversation, TeamTimeline } from '../team-app-contract.js'
import { TeamMessageContent } from './TeamMessageContent.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ArkmeTeamChannelAvatar } from './ArkmeTeamAvatar.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { groupTeamConversations, readTeamDirectory, refreshTeamDirectory, subscribeTeamDirectory } from './team-conversation-directory.js'
import { openTeamMessages, subscribeTeamMessageChanges } from './team-messaging-events.js'
import { withoutTeamConversationMaterial } from '../team-message-projection.js'
import type { TeamEntryTarget } from './team-directory-preferences.js'
import { TeamVisitorMembership } from './TeamVisitorMembership.js'

const button = { border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', padding: '6px 8px', fontSize: 13 }
/** Read-only history: deliberately does not mount the conversation pane, composer or read-ack effect. */
export function TeamConversationPreview({ accountKey, target, onClose }: { accountKey: string; target: TeamEntryTarget; onClose(): void }) {
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const directory = useSyncExternalStore(subscribeTeamDirectory, () => readTeamDirectory(accountKey), () => readTeamDirectory(accountKey))
  const group = target.kind === 'folder' ? groupTeamConversations(directory.items).find(group => group.key === target.group.key) ?? {...target.group, latest:withoutTeamConversationMaterial(target.group.latest), conversations:target.group.conversations.map(withoutTeamConversationMaterial)} : undefined
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
        <button style={{ ...button, marginLeft: 'auto', color: arkmeTheme.secondary }} aria-label="关闭聊天预览" onClick={onClose}><X size={18} /></button>
      </header>
      {conversation ? <TeamPreviewMessages key={`${accountKey}:${conversation.key}`} accountKey={accountKey} conversation={conversation} onConversation={setLoadedConversation} />
        : <div aria-label="团队对话预览列表" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px' }}>
          {group?.conversations.map(c => <button key={c.key} style={{ ...button, width: '100%', textAlign: 'left', padding: '12px 0', borderBottom: `1px solid ${arkmeTheme.borderSoft}`, color: arkmeTheme.text }} onClick={() => setChosen(c)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.visitor?.nickname ?? '用户'}</span><TeamVisitorMembership conversation={c} />{c.unread > 0 && <span style={{ marginLeft: 'auto', flexShrink: 0, color: arkmeTheme.accent }}>{c.unread} 条未读</span>}</span>
            <span style={{ display: 'block', marginTop: 5, fontSize: 12, color: arkmeTheme.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.preview?.status === 'available' ? c.preview.text || (c.preview.hasMedia ? '[附件]' : '[消息]') : '内容暂不可用'}</span>
          </button>)}
          {directory.error && <p role="alert">{directory.error}</p>}
          {(directory.hasMore || directory.error) && <button style={button} disabled={directory.loading} onClick={() => { void refreshTeamDirectory(accountKey, !directory.error) }}>{directory.loading ? '正在加载…' : directory.error ? '重试' : '加载更多对话'}</button>}
        </div>}
      <footer style={{ padding: '8px 16px', borderTop: `1px solid ${arkmeTheme.borderSoft}`, textAlign: 'right' }}>
        <button style={button} onClick={() => { onClose(); openTeamMessages(conversation ? { kind: 'conversation', conversation } : { kind: 'team', teamRef: group!.channel.teamRef, channel: group!.channel }) }}>{conversation ? '打开对话' : '打开团队消息'}</button>
      </footer>
    </div>
  </div>, document.body)
}

function TeamPreviewMessages({ accountKey, conversation, onConversation }: { accountKey: string; conversation: TeamConversation; onConversation(value: TeamConversation): void }) {
  const [page, setPage] = useState<TeamTimeline>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [request, setRequest] = useState({ before: 0, attempt: 0 })
  const generation = useRef(0)
  useEffect(() => subscribeTeamMessageChanges((account, receiptOnly) => {
    if (account !== accountKey || receiptOnly) return
    ++generation.current
    setPage(undefined)
    setRequest(value => ({before:0, attempt:value.attempt+1}))
  }), [accountKey])
  const body = useRef<HTMLDivElement>(null), geometry = useRef<{ height: number; top: number }>()
  useEffect(() => {
    const controller = new AbortController(), token = ++generation.current
    setLoading(true); setError('')
    void callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq: request.before, limit: 30 }, controller.signal)
      .then(value => {
        controller.signal.throwIfAborted()
        if (token !== generation.current) return
        if (value.hasMore && (!value.beforeSeq || request.before > 0 && value.beforeSeq >= request.before)) throw new Error('消息分页异常，请重试')
        if (body.current) geometry.current = { height: body.current.scrollHeight, top: body.current.scrollTop }
        setPage(old => ({ ...value, messages: [...new Map([...(request.before ? old?.messages ?? [] : []), ...value.messages].map(message => [message.key, message])).values()].sort((a, b) => a.seq - b.seq) }))
        onConversation(value.conversation)
      }).catch(caught => { if (!controller.signal.aborted && token === generation.current) setError(caught instanceof Error ? caught.message : '加载失败，请重试') })
      .finally(() => { if (!controller.signal.aborted && token === generation.current) setLoading(false) })
    return () => controller.abort()
  }, [accountKey, conversation.ref, request, onConversation])
  useLayoutEffect(() => {
    if (body.current && page) body.current.scrollTop = request.before && geometry.current ? geometry.current.top + body.current.scrollHeight - geometry.current.height : body.current.scrollHeight
  }, [page])
  return <div ref={body} aria-label="预览消息列表" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 16px 16px' }}>
    {error && <p role="alert">{error}<button style={button} onClick={() => setRequest(value => ({ ...value, attempt: value.attempt + 1 }))}>{tr('重试')}</button></p>}
    {page?.hasMore && !error && <button style={button} disabled={loading} onClick={() => setRequest(value => ({ before: page.beforeSeq, attempt: value.attempt + 1 }))}>{loading ? '正在加载…' : '加载更早消息'}</button>}
    {loading && !page && <p role="status">正在加载消息…</p>}
    {!loading && !error && !page?.messages.length && <p>暂无消息</p>}
    {page?.messages.map(message => <article key={message.key} style={{ display: 'flex', flexDirection: message.own ? 'row-reverse' : 'row', gap: 8, marginTop: 14 }}>
      <ArkmeUserAvatar size={30} label={message.sender.nickname} avatarRef={message.sender.imageRef} imageKey={message.sender.imageKey} imagePort={teamAvatarImages} />
      <div style={{ maxWidth: 'calc(100% - 38px)', minWidth: 0 }}>
        <div style={{ fontSize: 11, color: arkmeTheme.secondary, marginBottom: 4 }}>{message.sender.nickname} · {new Date(message.createdAt).toLocaleString()}</div>
        <div style={{ padding: '8px 10px', borderRadius: 10, background: message.own ? arkmeTheme.messageOwn : arkmeTheme.messageOther }}>
          {message.state === 'published' && message.contentStatus === 'available' ? <TeamMessageContent message={message} conversationRef={conversation.ref} conversationKey={conversation.key} /> : <span style={{ color: arkmeTheme.secondary }}>消息已删除或暂不可用</span>}
        </div>
      </div>
    </article>)}
  </div>
}
