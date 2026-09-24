import { ArkmeReadReceiptPanel, ArkmeReadReceiptMember, readReceiptStyles as styles } from './ArkmeReadReceiptPanel.js'
export { arkmeMessageReadReceiptPanelLayout } from './ArkmeReadReceiptPanel.js'
import { tr, useArkmeLocale } from './locale.js'
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react'
import type {
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptSummary,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import { useConversationMembers } from './use-conversation-members.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMentionReadProvider } from './mention-read-status.js'
import { ArkmeReadReceiptIcon } from './ArkmeReadReceiptIcon.js'
import {
  arkmeMessageReadReceipts,
  type ArkmeMessageReadReceiptTarget,
} from './message-read-receipt-store.js'

function summaryLabel(summary: ArkmeMessageReadReceiptSummary): string {
  return tr("已读 {v0} / 未读 {v1}", { v0: summary.readCount, v1: summary.unreadCount })
}

function ReceiptCircle(props: { checked?: boolean; count?: number }) {
  const count = props.count === undefined ? undefined : Math.min(999, Math.max(0, props.count))
  return <span style={styles.indicator} data-arkme-read-receipt-indicator={props.checked === true ? 'all-read' : 'partial-read'}>
    <ArkmeReadReceiptIcon checked={props.checked === true} style={styles.indicatorIcon} />
    {count !== undefined && <span style={{ ...styles.indicatorCount, fontSize: count > 99 ? 4.5 : 7 }}>{count}</span>}
  </span>
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : tr("加载失败")
}

type MemberReceiptPanelProps = {
  anchor: HTMLButtonElement | null
  target: ArkmeMessageReadReceiptTarget
  source: ArkmeSourceItem
  onClose: () => void
}

function ArkmeMessageReadReceiptDetailPanel(props: MemberReceiptPanelProps) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : undefined
  const generation = useSyncExternalStore(arkmeMessageReadReceipts.subscribe, arkmeMessageReadReceipts.getAccountGeneration)
  if (account === undefined) return null
  const identity = JSON.stringify([account, generation, props.target.sourceRef, props.target.itemUid, props.target.sequence])
  return <MemberReceiptPanelContent key={identity} {...props} account={account} />
}

function MemberReceiptPanelContent(props: MemberReceiptPanelProps & { account: string | undefined }) {
  useArkmeLocale()
  const members = useConversationMembers(props.account, props.source)
  const membersByRef = useMemo(() => new Map(members.items.map(member => [member.memberRef, member])), [members.items])
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error'
    detail?: ArkmeMessageReadReceiptDetail
    message?: string
  }>({ status: 'loading' })
  const requestRevision = useRef(0)

  const load = useCallback((force = false) => {
    const revision = ++requestRevision.current
    setState(current => ({ ...current, status: 'loading' }))
    void arkmeMessageReadReceipts.detail(props.target, force)
      .then(detail => {
        if (revision === requestRevision.current) setState({ status: 'ready', detail })
      })
      .catch(error => {
        if (revision === requestRevision.current) setState(current => ({ ...((error as { body?: { retryable?: boolean } }).body?.retryable === false ? {} : current), status: 'error', message: errorText(error) }))
      })
  }, [props.target])

  useEffect(() => {
    const release = arkmeMessageReadReceipts.observeDetail(props.target, () => { load() })
    load()
    return () => { requestRevision.current += 1; release() }
  }, [load, props.target])
  return <ArkmeReadReceiptPanel anchor={props.anchor} label={tr('群消息已读详情')} onClose={props.onClose}>
        {state.status === 'loading' && state.detail === undefined && <div role="status" style={styles.panelState}>{tr("加载中...")}</div>}
        {state.status === 'error' && <button
          type="button" role="alert" title={state.message} style={{ ...styles.panelState, ...styles.panelRetry }}
          onClick={() => { load(true) }}
        >{tr("加载失败")}</button>}
        {state.detail !== undefined && state.detail.items.length === 0 && <div style={styles.panelState}>{tr("暂无更多人员信息")}</div>}
        {state.detail?.items.map(receipt => {
          const knownMember = membersByRef.get(receipt.memberRef)
          const member = {
            ...receipt,
            displayName: knownMember?.displayName ?? receipt.displayName,
            avatarRef: knownMember === undefined ? receipt.avatarRef : knownMember.avatarRef,
          }
          return <ArkmeReadReceiptMember key={member.memberRef} name={member.displayName}
            read={member.readStatus === 'read'} readAt={member.readAtMillis}
            avatar={<ArkmeUserAvatar lazy {...(member.avatarRef === undefined ? {} : { avatarRef: member.avatarRef })}
              size={20} label={tr('{v0} 的头像', { v0: member.displayName })} />} />
        })}
  </ArkmeReadReceiptPanel>
}

export function ArkmeMessageReadReceipt(props: {
  source: ArkmeSourceItem
  item: ArkmeTimelineItem
}) {
  useArkmeLocale()
  const hostRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const target = useMemo<ArkmeMessageReadReceiptTarget | undefined>(() => {
    if (!props.item.isMe || props.item.sequence === undefined || props.item.sequence <= 0
      || (props.source.kind !== 'private_chat' && props.source.kind !== 'group_chat')) return undefined
    return {
      sourceRef: props.source.sourceRef,
      sourceKey: props.source.sourceKey ?? props.source.sourceRef,
      conversationKind: props.source.kind,
      itemUid: props.item.itemUid,
      sequence: props.item.sequence,
    }
  }, [props.item.isMe, props.item.itemUid, props.item.sequence, props.source.kind, props.source.sourceKey, props.source.sourceRef])
  useSyncExternalStore(
    arkmeMessageReadReceipts.subscribe,
    arkmeMessageReadReceipts.getSnapshot,
    arkmeMessageReadReceipts.getSnapshot,
  )

  useEffect(() => {
    if (target === undefined) return
    const registration = arkmeMessageReadReceipts.register(target)
    const element = hostRef.current
    if (element === null || typeof IntersectionObserver === 'undefined') {
      registration.setVisible(true)
      return () => {
        registration.dispose()
      }
    }
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.target === element && entry.isIntersecting)
      registration.setVisible(visible)
    }, { rootMargin: '120px 0px' })
    observer.observe(element)
    return () => {
      observer.disconnect()
      registration.dispose()
    }
  }, [target])

  if (target === undefined) return null
  const entry = arkmeMessageReadReceipts.get(target)
  const summary = entry?.summary
  const hasTruth = summary !== undefined && summary.totalMemberCount > 0
  const canOpen = hasTruth && target.conversationKind === 'group_chat'
  const isFailure = entry?.status === 'error' && summary === undefined
  const isProvisional = entry?.status === 'provisional'
  let indicator: JSX.Element
  let label: string
  if (isFailure) {
    indicator = <span style={styles.failureDot} data-arkme-read-receipt-indicator="error" />
    label = '已读状态同步失败，点击重试'
  } else if (isProvisional || (hasTruth && summary.readCount <= 0 && summary.unreadCount > 0)) {
    indicator = <span style={styles.unreadDot} data-arkme-read-receipt-indicator="unread" />
    label = '未读'
  } else if (hasTruth && summary.unreadCount <= 0 && summary.readCount > 0) {
    indicator = <ReceiptCircle checked />
    label = target.conversationKind === 'group_chat' ? summaryLabel(summary) : '已读'
  } else if (hasTruth && summary.readCount > 0) {
    indicator = <ReceiptCircle count={summary.readCount} />
    label = summaryLabel(summary)
  } else {
    indicator = <span style={styles.placeholder} data-arkme-read-receipt-indicator="placeholder" />
    label = '已读状态同步中'
  }

  const content = canOpen || isFailure
    ? <button
        ref={buttonRef}
        type="button"
        style={{ ...styles.status, ...styles.interactive }}
        aria-label={canOpen ? tr("{v0}，查看成员已读详情", { v0: label }) : label}
        onKeyDown={event => {
          if (detailOpen && event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.stopPropagation()
            setDetailOpen(false)
          }
        }}
        onClick={() => {
          if (isFailure) {
            arkmeMessageReadReceipts.retry(target)
            return
          }
          setDetailOpen(current => !current)
        }}
      >{indicator}</button>
    : <span style={styles.status} aria-label={label}>{indicator}</span>

  return <span ref={hostRef} style={styles.root} data-arkme-read-receipt={entry?.status ?? 'unknown'}>
    {content}
    {detailOpen && canOpen && <ArkmeMessageReadReceiptDetailPanel
      anchor={buttonRef.current}
      target={target}
      source={props.source}
      onClose={() => { setDetailOpen(false) }}
    />}
  </span>
}

export function ArkmeMessageReadReceiptLine(props: {
  source: ArkmeSourceItem
  item: ArkmeTimelineItem
  wide?: boolean
  children: ReactNode
}) {
  useArkmeLocale()
  const elementRef = useRef<HTMLDivElement>(null)
  return <ArkmeMentionReadProvider source={props.source} item={props.item} elementRef={elementRef}><div
    ref={elementRef}
    data-arkme-message-content-line={props.item.itemUid}
    style={{
      maxWidth: '100%', minWidth: 0, display: 'flex', alignItems: 'flex-end',
      // A self-message body may occupy the full available width for long content.
      // Keep its bubble/receipt pair pinned to the right edge in that case.
      justifyContent: props.item.isMe ? 'flex-end' : 'flex-start',
      ...(props.wide === true ? { width: '100%' } : {}),
    }}
  >
    {props.item.isMe && <ArkmeMessageReadReceipt source={props.source} item={props.item} />}
    {props.children}
  </div></ArkmeMentionReadProvider>
}
