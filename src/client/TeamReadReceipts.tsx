import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TeamIdentity, TeamMessage, TeamReceiptMember } from '../team-app-contract.js'
import { ArkmeReadReceiptStatus, readReceiptStyles } from './ArkmeReadReceiptPanel.js'
import { TeamReceiptStore, emptyTeamReceipt, teamReceiptCounts, type TeamReceiptState } from './team-read-receipts.js'
import { teamText as tr } from './team-messaging-i18n.js'
import { arkmeTheme } from './arkme-theme.js'

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
  return <button type="button" ref={node} className="team-receipt-badge" aria-label={`${tr('查看阅读状态')}：${label}`}
    onClick={event => onClick(event.currentTarget)}>{label}</button>
}

function Member({ member, renderAvatar }: { member: TeamReceiptMember; renderAvatar(identity: TeamIdentity): ReactNode }) {
  return <div style={readReceiptStyles.member}>
    <span style={readReceiptStyles.memberIdentity}>{renderAvatar(member)}<span style={readReceiptStyles.memberName}>{member.isMe ? tr('你') : member.nickname || tr('用户')}</span></span>
    <span style={{ ...readReceiptStyles.memberStatus, color: member.read === false ? arkmeTheme.info : arkmeTheme.secondary }}>
      {tr(member.read === true ? '已读' : member.read === false ? '未读' : '状态待同步')}
    </span>
  </div>
}

export function TeamReceiptDetails({ message, state, visitor, onRetry, onMore, renderAvatar }: {
  message: TeamMessage; state: TeamReceiptState; visitor?: TeamIdentity | undefined
  onRetry(): void; onMore(): void; renderAvatar(identity: TeamIdentity): ReactNode
}) {
  const [filter, setFilter] = useState<'all' | 'read' | 'unread'>('all')
  const value = state.value, counts = teamReceiptCounts(value)
  const members = value?.members.filter(m => filter === 'all' || (filter === 'read' ? m.read === true : m.read === false)) ?? []
  return <>
    {message.side === 'team' && <>
      <div className="team-receipt-heading">{tr('外部联系人')}</div>
      <Member member={{ nickname: visitor?.nickname || tr('用户'), ...visitor,
        ...(typeof value?.visitorRead === 'boolean' ? {read: value.visitorRead} : {}) }} renderAvatar={renderAvatar} />
    </>}
    <div className="team-receipt-heading">{tr('团队成员')}<span>{counts ? tr('已读 {v0}/{v1}', {v0:counts.read, v1:counts.total})
      : value?.hasMore ? tr('已加载 {v0} 人', {v0:value.members.length}) : value ? tr('人数暂不可用') : ''}</span></div>
    <div role="group" aria-label={tr('阅读状态筛选')} className="team-receipt-filters">
      {(['all', 'read', 'unread'] as const).map(key => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
        {tr(key === 'all' ? '全部' : key === 'read' ? '已读' : '未读')}{counts ? ` ${key === 'all' ? counts.total : counts[key]}` : ''}
      </button>)}
    </div>
    {state.error && <ArkmeReadReceiptStatus onClick={onRetry}>{tr('更新失败，点击重试')}</ArkmeReadReceiptStatus>}
    {!value && !state.error && <ArkmeReadReceiptStatus>{tr('加载中...')}</ArkmeReadReceiptStatus>}
    {members.map((member, i) => <Member key={member.key ?? `unknown-${i}`} member={member} renderAvatar={renderAvatar} />)}
    {value && !members.length && <ArkmeReadReceiptStatus>{tr(filter === 'unread' ? '暂无未读成员' : filter === 'read' ? '暂无已读成员' : '暂无其他成员')}</ArkmeReadReceiptStatus>}
    {value?.hasMore && <ArkmeReadReceiptStatus {...(!state.loading ? {onClick:onMore} : {})}>{tr(state.loading ? '加载中...' : '更多成员')}</ArkmeReadReceiptStatus>}
  </>
}
