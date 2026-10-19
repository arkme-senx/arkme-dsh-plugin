import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamConversation, TeamMessage, TeamTimeline } from '../team-app-contract.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { TeamMessageContent } from './TeamMessageContent.js'
import { formatArkmeMemberRecordTime } from './ArkmeChatMemberActions.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { arkmeTheme } from './arkme-theme.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'

/** Only the external side of this authorized conversation, with resumable bounded paging. */
export function TeamVisitorRecords({ conversation, accountKey, onClose, onLocate }: {
  conversation: TeamConversation; accountKey: string; onClose(): void; onLocate(message: TeamMessage, signal: AbortSignal): Promise<void>
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]), [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true), [error, setError] = useState(''), [locating, setLocating] = useState(false)
  const before = useRef(0), complete = useRef(false), pending = useRef(false), controller = useRef<AbortController>()
  const nextPage = useCallback(async () => {
    if (pending.current || complete.current || controller.current?.signal.aborted) return
    pending.current = true; setLoading(true); setError('')
    try {
      // Skip a few all-team pages so an empty first page doesn't imply no visitor records.
      for (let scan = 0; scan < 5; scan++) {
        const page = await callArkme<TeamTimeline>('team.app.timeline', {
          conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq: before.current,
        }, controller.current?.signal)
        if (controller.current?.signal.aborted) return
        if (page.conversation.side !== 'team') throw new Error(tr('当前无法查看此团队对话'))
        const items = page.messages.filter(m => m.side === 'external' && m.state === 'published' && m.contentStatus === 'available')
        if (page.hasMore && (!page.beforeSeq || before.current > 0 && page.beforeSeq >= before.current)) throw new Error(tr('历史消息分页异常，请重试'))
        setMessages(old => [...new Map([...old, ...items].map(m => [m.key, m])).values()].sort((a, b) => b.seq - a.seq))
        before.current = page.beforeSeq; complete.current = !page.hasMore; setHasMore(page.hasMore)
        if (items.length || !page.hasMore) break
      }
    } catch (caught) {
      if (!controller.current?.signal.aborted) {
        if (/team-(not_accessible|account-changed)|login-/.test(String((caught as { body?: { code?: string } })?.body?.code))) setMessages([])
        setError(caught instanceof Error ? caught.message : tr('读取快记失败'))
      }
    } finally {
      pending.current = false
      if (!controller.current?.signal.aborted) setLoading(false)
    }
  }, [conversation.ref, accountKey])
  useEffect(() => {
    controller.current = new AbortController(); void nextPage()
    return () => controller.current?.abort()
  }, [nextPage])
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sentinel.current || loading || !hasMore || error) return
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void nextPage() })
    observer.observe(sentinel.current); return () => observer.disconnect()
  }, [nextPage, loading, hasMore, error])
  const locate = async (message: TeamMessage) => {
    if (locating) return
    setLocating(true); setError('')
    try { await onLocate(message, controller.current!.signal); if (!controller.current?.signal.aborted) onClose() }
    catch (caught) { if (!controller.current?.signal.aborted) setError(caught instanceof Error ? caught.message : tr('定位原消息失败')) }
    finally { if (!controller.current?.signal.aborted) setLocating(false) }
  }
  const name = conversation.visitor?.nickname || tr('用户')
  return <ArkmeDetailShell title={tr('{v0}的快记', { v0: name })} label={tr('{v0}的快记', { v0: name })}
    subtitle={tr('当前团队对话')} onClose={onClose} onPointerDownOutside={event => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="menu"], [aria-modal="true"], [data-arkme-image-preview-viewport], [role="toolbar"]')) onClose()
    }} bodyStyle={{ padding: '12px 8px 24px' }}>
    {messages.map(message => <article key={message.key} data-team-visitor-record={message.key} style={{ marginBottom: 18 }}>
      <div style={{ textAlign: 'center', color: arkmeTheme.caption, fontSize: 12, marginBottom: 10 }}>{formatArkmeMemberRecordTime(message.createdAt)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <ArkmeUserAvatar avatarRef={message.sender.imageRef} imageKey={message.sender.imageKey} imagePort={teamAvatarImages} size={36} label={name} />
        <div style={{ minWidth: 0, maxWidth: 'calc(100% - 44px)' }}>
          <div style={{ fontSize: 12, color: arkmeTheme.secondary, marginBottom: 4 }}>{name}</div>
          <div style={{ padding: '10px 13px', borderRadius: '5px 14px 14px 14px', background: arkmeTheme.memberRecordOther, color: arkmeTheme.text, fontSize: 14, lineHeight: '22px', overflowWrap: 'anywhere' }}>
            <TeamMessageContent message={message} conversationRef={conversation.ref} />
          </div>
          <button type="button" disabled={locating} onClick={() => { void locate(message) }}
            style={{ border: 0, background: 'transparent', padding: '5px 0', fontSize: 12, color: arkmeTheme.secondary, cursor: 'pointer' }}>{tr('查看原消息')}</button>
        </div>
      </div>
    </article>)}
    {loading && <p role="status">{tr('正在加载快记…')}</p>}
    {locating && <p role="status">{tr('正在定位原消息…')}</p>}
    {error && <p role="alert">{error}<button type="button" onClick={() => { void nextPage() }}>{tr('重试')}</button></p>}
    {!loading && !error && !hasMore && !messages.length && <p>{tr('暂无快记')}</p>}
    {hasMore && <div ref={sentinel}><button type="button" disabled={loading} onClick={() => { void nextPage() }}>{tr('加载更早消息')}</button></div>}
  </ArkmeDetailShell>
}
