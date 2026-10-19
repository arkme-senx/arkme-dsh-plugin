import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { TeamIdentity, TeamMessage, TeamReceiptMember } from '../team-app-contract.js'
import { ArkmeReadReceiptMember, ArkmeReadReceiptStatus, readReceiptStyles } from './ArkmeReadReceiptPanel.js'
import { ArkmeReadReceiptControl } from './ArkmeReadReceiptControl.js'
import { TeamReceiptStore, emptyTeamReceipt, teamReceiptCounts, type TeamReceiptState } from './team-read-receipts.js'
import { teamText as tr } from './team-messaging-i18n.js'

export function TeamReceiptBadge({ message, store, onClick }: {
  message: TeamMessage; store: TeamReceiptStore; onClick(anchor: HTMLElement): void
}) {
  const node = useRef<HTMLButtonElement>(null)
  const state = useSyncExternalStore(store.subscribe, () => store.get(message.key), () => emptyTeamReceipt)
  useEffect(() => {
    if (!node.current) return
    let stop: (() => void) | undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) stop ??= store.watch(message)
      else { stop?.(); stop = undefined }
    })
    observer.observe(node.current)
    return () => { observer.disconnect(); stop?.() }
  }, [store, message.key, message.ref])
  const counts = teamReceiptCounts(state.value)
  const visitor = state.value?.visitorRead ?? (message.own ? message.recipientRead : undefined)
  const team = counts ? tr('团队已读 {v0}/{v1}', {v0:counts.read, v1:counts.total}) : tr('团队阅读状态')
  const label = state.error ? tr('阅读状态待更新') : message.side === 'external' ? team
    : `${tr(visitor === true ? '对方已读' : visitor === false ? '对方未读' : '对方状态待同步')} · ${team}`
  if (message.side === 'external') {
    // Only complete, explicit member states can become a count or an all-read tick.
    const indicator = counts && counts.total > 0
      ? counts.read === 0 ? 'unread' : counts.unread === 0 ? 'all-read' : 'partial-read'
      : state.error ? 'error' : 'placeholder'
    return <ArkmeReadReceiptControl buttonRef={node} placement={message.own ? 'before' : 'after'} state={indicator}
      status={state.error ? 'error' : state.loading ? 'loading' : counts ? 'ready' : 'unknown'}
      {...(indicator === 'partial-read' && counts ? { count: counts.read } : {})}
      label={`${tr('查看阅读状态')}：${label}`}
      onClick={() => { if (node.current) onClick(node.current) }} />
  }
  // A complete team count never implies that the external contact has read it.
  const known = counts !== undefined && typeof visitor === 'boolean'
  return <ArkmeReadReceiptControl buttonRef={node} placement={message.own ? 'before' : 'after'}
    state={known ? 'count' : state.error ? 'error' : 'placeholder'}
    status={state.error ? 'error' : state.loading ? 'loading' : known ? 'ready' : 'unknown'}
    {...(known ? { count: counts.read, tone: visitor ? 'info' as const : 'neutral' as const } : {})}
    label={`${tr('查看阅读状态')}：${label}`}
    onClick={() => { if (node.current) onClick(node.current) }} />
}

function Member({ member, renderAvatar }: { member: TeamReceiptMember; renderAvatar(identity: TeamIdentity): ReactNode }) {
  const name = member.isMe ? tr('你') : member.nickname || tr('用户')
  if (typeof member.read === 'boolean') return <ArkmeReadReceiptMember name={name} avatar={renderAvatar(member)} read={member.read} readAt={member.readAt} />
  return <div style={readReceiptStyles.member}>
    <span style={readReceiptStyles.memberIdentity}>{renderAvatar(member)}<span style={readReceiptStyles.memberName}>{name}</span></span>
    <span style={readReceiptStyles.memberStatus}>{tr('状态待同步')}</span>
  </div>
}

export function TeamReceiptDetails({ message, state, visitor, onRetry, onMore, renderAvatar }: {
  message: TeamMessage; state: TeamReceiptState; visitor?: TeamIdentity | undefined
  onRetry(): void; onMore(): void; renderAvatar(identity: TeamIdentity): ReactNode
}) {
  const value = state.value, counts = teamReceiptCounts(value)
  // Keep source order for ties and unknown states; known readers are newest first.
  const members = [...(value?.members ?? [])].sort((a, b) => Number(b.read === true) - Number(a.read === true)
    || (a.read === true && b.read === true ? (b.readAt ?? 0) - (a.readAt ?? 0) : 0))
  const visitorRead = value?.visitorRead ?? (message.own ? message.recipientRead : undefined)
  return <>
    {message.side === 'team' && <>
      <div className="team-receipt-heading">{tr('外部联系人')}</div>
      <Member member={{ nickname: visitor?.nickname || tr('用户'), ...visitor,
        ...(typeof visitorRead === 'boolean' ? {read: visitorRead} : {}) }} renderAvatar={renderAvatar} />
    </>}
    <div className="team-receipt-heading">{tr('团队成员')}<span>{counts ? tr('已读 {v0}/{v1}', {v0:counts.read, v1:counts.total})
      : value?.hasMore ? tr('已加载 {v0} 人', {v0:value.members.length}) : value ? tr('人数暂不可用') : ''}</span></div>
    {state.error && <ArkmeReadReceiptStatus onClick={onRetry}>{tr('更新失败，点击重试')}</ArkmeReadReceiptStatus>}
    {!value && !state.error && <ArkmeReadReceiptStatus>{tr('加载中...')}</ArkmeReadReceiptStatus>}
    {members.map((member, i) => <Member key={member.key ?? `unknown-${i}`} member={member} renderAvatar={renderAvatar} />)}
    {value && !members.length && <ArkmeReadReceiptStatus>{tr('暂无其他成员')}</ArkmeReadReceiptStatus>}
    {value?.hasMore && <ArkmeReadReceiptStatus {...(!state.loading ? {onClick:onMore} : {})}>{tr(state.loading ? '加载中...' : '更多成员')}</ArkmeReadReceiptStatus>}
  </>
}
