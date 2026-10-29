import { invalidateTeamMessages } from './team-messaging-events.js'
import { useTeamHistoryPage } from './team-history-client.js'
import { useEffect, useRef, useState } from 'react'
import type { TeamConversation, TeamIdentity, TeamMessage } from '../team-app-contract.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { TeamMessageContent } from './TeamMessageContent.js'
import { formatArkmeMemberRecordTime } from './ArkmeChatMemberActions.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** One authorized sender in this conversation, with resumable bounded paging. */
export function TeamVisitorRecords({ conversation, accountKey, person, mode = 'owner', onClose, onLocate }: {
  mode?: 'owner' | 'mentioned'
  person?: TeamIdentity | undefined
  conversation: TeamConversation; accountKey: string; onClose(): void; onLocate(message: TeamMessage, signal: AbortSignal): Promise<void>
}) {
  const target = person ?? conversation.visitor
  const personRef = target?.personRef
  // Signed refs rotate on refresh; only a different account/conversation/person resets paging.
  const scopeKey=JSON.stringify([accountKey,conversation.key,conversation.side,target?.personKey ?? personRef ?? 'external',mode])
  const history=useTeamHistoryPage(conversation.ref,accountKey,'query',{...(personRef?{personRef,personMode:mode}:{}),limit:50},!!personRef,scopeKey,scopeKey,'full')
  const messages=history.page?.messages ?? [],loading=history.loading,hasMore=history.page?.hasMore ?? false,error=personRef?history.error:tr('发送者身份暂不可用，请重新打开')
  const [locating,setLocating]=useState(false),[locateError,setLocateError]=useState('')
  const controller=useRef(new AbortController())
  useEffect(()=>{controller.current=new AbortController();setLocating(false);setLocateError('');return()=>controller.current.abort()},[scopeKey])
  const locate = async (message: TeamMessage) => {
    if (locating) return
    setLocating(true); setLocateError('')
    const signal = controller.current.signal
    try { await onLocate(message, signal); if (!signal.aborted) onClose() }
    catch (caught) { if (!signal.aborted) { setLocateError(caught instanceof Error ? caught.message : tr('定位原消息失败')); invalidateTeamMessages(accountKey) } }
    finally { if (!signal.aborted) setLocating(false) }
  }
  const name = person?.nickname || conversation.visitor?.nickname || tr('用户')
  const title = mode === 'mentioned' ? tr('@{v0}的快记',{v0:name}) : tr('{v0}的快记',{v0:name})
  return <ArkmeDetailShell title={title} label={title}
    subtitle={tr('当前团队对话')} onClose={onClose} onPointerDownOutside={event => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="menu"], [aria-modal="true"], [data-arkme-image-preview-viewport], [role="toolbar"]')) onClose()
    }} bodyStyle={{ padding: '12px 8px 24px' }}>
    {history.windowed&&<button onClick={history.refresh}>{tr('返回最新快记')}</button>}
    {messages.map(message => <article key={message.key} data-team-visitor-record={message.key} style={{ marginBottom: 18 }}>
      <div style={{ textAlign: 'center', color: arkmeTheme.caption, fontSize: 12, marginBottom: 10 }}>{formatArkmeMemberRecordTime(message.createdAt)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <ArkmeUserAvatar avatarRef={message.sender.imageRef} imageKey={message.sender.imageKey} imagePort={teamAvatarImages} size={36} label={name} />
        <div style={{ minWidth: 0, maxWidth: 'calc(100% - 44px)' }}>
          <div style={{ fontSize: 12, color: arkmeTheme.secondary, marginBottom: 4 }}>{name}</div>
          <div style={{ padding: '10px 13px', borderRadius: '5px 14px 14px 14px', background: arkmeTheme.memberRecordOther, color: arkmeTheme.text, fontSize: 14, lineHeight: '22px', overflowWrap: 'anywhere' }}>
            <TeamMessageContent message={message} conversationRef={conversation.ref} conversationKey={conversation.key} />
          </div>
          <button type="button" disabled={locating} onClick={() => { void locate(message) }}
            style={{ border: 0, background: 'transparent', padding: '5px 0', fontSize: 12, color: arkmeTheme.secondary, cursor: 'pointer' }}>{tr('查看原消息')}</button>
        </div>
      </div>
    </article>)}
    {loading && <p role="status">{tr('正在加载快记…')}</p>}
    {locating && <p role="status">{tr('正在定位原消息…')}</p>}
    {(error||locateError) && <p role="alert">{error||locateError}<button type="button" onClick={() => { setLocateError(''); history.refresh() }}>{tr('重试')}</button></p>}
    {!loading && !error && !hasMore && !messages.length && <p>{tr('暂无快记')}</p>}
    {hasMore && <div><button type="button" disabled={loading} onClick={() => { void history.more() }}>{tr('加载更早消息')}</button></div>}
  </ArkmeDetailShell>
}
