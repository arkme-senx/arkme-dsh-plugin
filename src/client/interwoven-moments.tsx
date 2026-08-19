import { useEffect, useState, type CSSProperties } from 'react'
import type { ArkmeInterwovenDetail, ArkmeInterwovenMention, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { loadArkmeImageDataUrl } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'

/** Shared vertical anchor: detail begins below the conversation tab/header. */
export const ARKME_CONVERSATION_HEADER_HEIGHT = 56

export type ArkmeConversationRow =
  | { kind: 'message'; id: string; occurredAtMillis: number; item: ArkmeTimelineItem }
  | { kind: 'moment'; id: string; occurredAtMillis: number; item: ArkmeInterwovenMention }

/** Pure deterministic merge; each authority keeps its own identity and duplicate policy. */
export function mergeConversationRows(
  messages: readonly ArkmeTimelineItem[],
  moments: readonly ArkmeInterwovenMention[],
): ArkmeConversationRow[] {
  const messageById = new Map(messages.map(item => [item.itemUid, item]))
  const momentById = new Map(moments.map(item => [item.momentId, item]))
  const rows: ArkmeConversationRow[] = [
    ...[...messageById.values()].map(item => ({
      kind: 'message' as const, id: `message:${item.itemUid}`,
      occurredAtMillis: item.sendAtMillis, item,
    })),
    ...[...momentById.values()].map(item => ({
      kind: 'moment' as const, id: `moment:${item.momentId}`,
      occurredAtMillis: item.occurredAtMillis, item,
    })),
  ]
  return rows.sort((left, right) => left.occurredAtMillis - right.occurredAtMillis
    || left.id.localeCompare(right.id))
}

export function interwovenTimeLabel(value: number, now = Date.now()): string {
  const date = new Date(value)
  const current = new Date(now)
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
  const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (targetStart === dayStart) return time
  if (targetStart === dayStart - 24 * 60 * 60 * 1000) return `昨天 ${time}`
  const day = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
  return `${day} ${time}`
}

export function interwovenDetailTimeLabel(value: number): string {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}月${day}日 ${hour}:${minute}`
}

export interface InterwovenContentPart {
  text: string
  mention: boolean
}

/** Keeps mention styling presentational; business identity still comes only from the owner DTO. */
export function interwovenContentParts(text: string): InterwovenContentPart[] {
  const parts = text.split(/(@[^\s@，,。；;：:！!?？、]+)/gu).filter(Boolean)
  return parts.map(part => ({ text: part, mention: part.startsWith('@') }))
}

/** Returns a target only when the already-authorized directory has one exact group match. */
export function resolveInterwovenGroupTarget(
  sources: readonly ArkmeSourceItem[],
  groupName: string,
): ArkmeSourceItem | undefined {
  const matches = sources.filter(source => source.kind === 'group_chat' && source.displayName === groupName)
  return matches.length === 1 ? matches[0] : undefined
}

const styles: Record<string, CSSProperties> = {
  momentRow: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  momentTime: { color: 'var(--dsw-alias-label-tertiary, #9097a1)', fontSize: 12, lineHeight: '18px' },
  card: {
    maxWidth: 'min(680px, 100%)', minWidth: 0, border: 0, padding: '4px 8px', margin: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #737982)',
    fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 13, lineHeight: '20px', cursor: 'pointer',
  },
  avatar: {
    width: 18, height: 18, minWidth: 18, overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: 'var(--dsw-alias-bg-subtle, #f0f2f5)',
  },
  avatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  cardText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' },
  chevron: { width: 15, height: 15, flex: 'none', color: 'var(--dsw-alias-label-tertiary, #9097a1)' },
  aside: {
    position: 'absolute', zIndex: 8, top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, width: 'min(405px, 100%)',
    height: 'auto', minHeight: 0,
    display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
    borderLeft: '1px solid var(--dsw-alias-border-l2, #e2e5e9)',
    borderBottom: '1px solid var(--dsw-alias-border-l2, #e2e5e9)',
    background: 'var(--dsw-alias-bg-base, #fff)', boxShadow: '-8px 8px 24px rgba(20, 25, 32, .08)',
  },
  asideHeader: {
    minHeight: 56, padding: '12px 14px 12px 18px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 12, boxSizing: 'border-box',
    borderBottom: '1px solid var(--dsw-alias-border-l2, #e2e5e9)',
  },
  asideTitle: { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  close: {
    width: 30, height: 30, border: 0, borderRadius: 8, background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 20, cursor: 'pointer',
  },
  asideBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 },
  detailSender: { display: 'flex', alignItems: 'center', gap: 10 },
  detailSenderText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  detailSenderName: {
    color: 'var(--dsw-alias-label-primary, #17191c)', fontSize: 14, lineHeight: '20px', fontWeight: 500,
  },
  detailTime: { color: 'var(--dsw-alias-label-tertiary, #9097a1)', fontSize: 12, lineHeight: '18px' },
  detailText: {
    margin: '16px 0 0', color: 'var(--dsw-alias-label-primary, #17191c)',
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 15, lineHeight: '24px',
  },
  mention: { color: 'var(--dsw-alias-state-business-primary, #3964fe)' },
  groupTag: {
    maxWidth: '100%', marginTop: 16, padding: '5px 8px', border: '1px solid var(--dsw-alias-border-l2, #e2e5e9)',
    borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 5, boxSizing: 'border-box',
    background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 12,
    lineHeight: '18px', cursor: 'pointer', fontFamily: 'var(--dsw-font-family, inherit)',
  },
  groupTagText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  groupTagIcon: { width: 14, height: 14, flex: 'none' },
  groupTagChevron: { fontSize: 15, lineHeight: '14px' },
  state: { color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 13, lineHeight: '20px' },
  retry: {
    marginTop: 12, padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l2, #e2e5e9)',
    borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary, #17191c)', cursor: 'pointer',
  },
}

function OpaqueAvatar({ avatarRef, size = 18 }: { avatarRef?: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (avatarRef === undefined) return () => { active = false }
    void loadArkmeImageDataUrl(avatarRef)
      .then(value => { if (active) setSrc(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [avatarRef])
  return <span style={{ ...styles.avatar, width: size, height: size, minWidth: size }} aria-hidden>
    {src === '' ? <ArkmeMark size={size} /> : <img src={src} alt="" draggable={false} style={styles.avatarImage} />}
  </span>
}

export function ArkmeInterwovenMentionCard({
  moment,
  onOpen,
}: {
  moment: ArkmeInterwovenMention
  onOpen: (moment: ArkmeInterwovenMention) => void
}) {
  const summary = moment.summary.trim() || '群聊提及'
  const accessible = `${moment.groupName}，${moment.senderName}：${summary}`
  return <li style={styles.momentRow} data-arkme-interwoven-card={moment.momentId}>
    <time style={styles.momentTime} dateTime={new Date(moment.occurredAtMillis).toISOString()}>
      {interwovenTimeLabel(moment.occurredAtMillis)}
    </time>
    <button
      type="button"
      style={styles.card}
      aria-label={`打开快记详情：${accessible}`}
      title={accessible}
      onFocus={event => { event.currentTarget.style.boxShadow = '0 0 0 2px var(--dsw-alias-state-business-primary, #3964fe)' }}
      onBlur={event => { event.currentTarget.style.boxShadow = 'none' }}
      onClick={() => { onOpen(moment) }}
    >
      <OpaqueAvatar {...(moment.senderAvatarRef === undefined ? {} : { avatarRef: moment.senderAvatarRef })} />
      <span style={styles.cardText}>{accessible}</span>
      <svg viewBox="0 0 16 16" style={styles.chevron} aria-hidden>
        <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  </li>
}

export type ArkmeInterwovenDetailViewState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: ArkmeInterwovenDetail }
  | { kind: 'error'; message: string }

export function ArkmeInterwovenDetailAside({
  state,
  onClose,
  onRetry,
  onOpenGroup,
}: {
  state: ArkmeInterwovenDetailViewState
  onClose: () => void
  onRetry: () => void
  onOpenGroup?: () => void
}) {
  const detailContent = state.kind === 'success'
    ? state.detail.textContent.trim() || (state.detail.degraded ? '' : state.detail.title.trim())
    : ''
  return <aside style={styles.aside} aria-label="快记详情" data-arkme-interwoven-detail>
    <header style={styles.asideHeader}>
      <h3 style={styles.asideTitle}>快记详情</h3>
      <button type="button" style={styles.close} aria-label="关闭快记详情" onClick={onClose}>×</button>
    </header>
    <div style={styles.asideBody} aria-live="polite">
      {state.kind === 'loading' ? <div style={styles.state} role="status">正在加载快记详情…</div>
        : state.kind === 'error' ? <div style={styles.state} role="alert">
          <div>{state.message}</div>
          <button type="button" style={styles.retry} onClick={onRetry}>重试</button>
        </div> : <>
          <div style={styles.detailSender}>
            <OpaqueAvatar {...(state.detail.senderAvatarRef === undefined ? {} : { avatarRef: state.detail.senderAvatarRef })} size={40} />
            <div style={styles.detailSenderText}>
              <span style={styles.detailSenderName}>{state.detail.senderName}</span>
              <time style={styles.detailTime} dateTime={new Date(state.detail.occurredAtMillis).toISOString()}>
                {interwovenDetailTimeLabel(state.detail.occurredAtMillis)}
              </time>
            </div>
          </div>
          {detailContent === '' && state.detail.degraded
            ? <div style={{ ...styles.state, marginTop: 16 }}>这条快记正文暂时不可用，请稍后重试。</div>
            : <p style={styles.detailText} data-arkme-interwoven-degraded={state.detail.degraded || undefined}>
              {(detailContent === '' ? [{ text: '暂无文本内容', mention: false }] : interwovenContentParts(detailContent))
                .map((part, index) => <span key={`${index}:${part.text}`} style={part.mention ? styles.mention : undefined}>{part.text}</span>)}
            </p>}
          <button
            type="button"
            style={{ ...styles.groupTag, ...(onOpenGroup === undefined ? { cursor: 'not-allowed', opacity: .65 } : {}) }}
            disabled={onOpenGroup === undefined}
            aria-label={`打开群聊：${state.detail.groupName}`}
            title={onOpenGroup === undefined ? '当前会话列表中无法唯一定位该群聊' : `打开群聊：${state.detail.groupName}`}
            data-arkme-interwoven-group-target={state.detail.groupName}
            onClick={onOpenGroup}
          >
            <svg viewBox="0 0 16 16" style={styles.groupTagIcon} aria-hidden>
              <path d="M3 2.5h8.5a2 2 0 0 1 2 2V11a2 2 0 0 1-2 2H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5 5.5h5M5 8h3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span style={styles.groupTagText}>{state.detail.groupName}</span>
            <span style={styles.groupTagChevron} aria-hidden>›</span>
          </button>
        </>}
    </div>
  </aside>
}
