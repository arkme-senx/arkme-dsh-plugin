import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { CSSProperties } from 'react'
import type {
  ArkmeRelatedQuickNoteDetail as ArkmeRelatedQuickNoteDetailDto,
  ArkmeRelatedQuickNoteItem,
  ArkmeRelatedQuickNoteList,
} from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { arkmeTheme } from './arkme-theme.js'

export type ArkmeRelatedQuickNotesLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; list: ArkmeRelatedQuickNoteList }

export type ArkmeRelatedQuickNoteDetailState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; item: ArkmeRelatedQuickNoteItem }
  | { kind: 'success'; item: ArkmeRelatedQuickNoteItem; detail: ArkmeRelatedQuickNoteDetailDto }

export type ArkmeRelatedDrawerView = 'source-detail' | 'related-list' | 'related-detail'

export function relatedDrawerBackTarget(view: ArkmeRelatedDrawerView): ArkmeRelatedDrawerView {
  return view === 'related-detail' ? 'related-list' : view === 'related-list' ? 'source-detail' : 'source-detail'
}

const styles: Record<string, CSSProperties> = {
  card: {
    width: '100%', marginTop: 22, padding: '13px 14px', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 12,
    background: arkmeTheme.hover, color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer',
    fontFamily: 'var(--dsw-font-family, inherit)',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  cardTitle: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: '20px', fontWeight: 600 },
  cardCount: { color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  previewList: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 },
  preview: {
    display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px',
  },
  compactError: {
    marginTop: 18, display: 'flex', alignItems: 'center', gap: 8,
    color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px',
  },
  retry: {
    flex: 'none', padding: '3px 8px', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 7, background: 'transparent', color: arkmeTheme.secondary,
    fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 12, cursor: 'pointer',
  },
  state: { padding: '18px 2px', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px' },
  list: { display: 'flex', flexDirection: 'column' },
  listRow: {
    width: '100%', padding: '14px 12px', border: 0,
    borderBottom: `1px solid ${arkmeTheme.borderSoft}`,
    background: 'transparent', color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer',
    fontFamily: 'var(--dsw-font-family, inherit)', boxSizing: 'border-box',
    display: 'flex', alignItems: 'flex-start', gap: 10,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  sender: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 12, lineHeight: '18px', fontWeight: 600, color: arkmeTheme.secondary,
  },
  time: { flex: 'none', fontSize: 11, lineHeight: '18px', color: arkmeTheme.tertiary },
  rowText: {
    display: 'block', marginTop: 5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', fontSize: 13, lineHeight: '20px', color: arkmeTheme.text,
  },
  sourceLabel: { display: 'block', marginTop: 3, fontSize: 11, lineHeight: '16px', color: arkmeTheme.tertiary },
  detail: { minWidth: 0 },
  detailSender: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 },
  detailSenderBody: { flex: 1, minWidth: 0 },
  detailSenderName: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', fontWeight: 600,
  },
  detailTime: { marginTop: 4, color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
}

function notePreview(item: ArkmeRelatedQuickNoteItem): string {
  return item.textPreview.trim() || item.title.trim() || '无文本内容'
}

function dateTimeDisplay(value: number): { label: string; iso: string } | undefined {
  const time = Number.isFinite(value) && value > 0
    ? (value < 1e12 ? value * 1000 : value)
    : 0
  if (time === 0 || time > 8_640_000_000_000_000) return undefined
  const date = new Date(time)
  return {
    label: date.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }),
    iso: date.toISOString(),
  }
}

export function ArkmeRelatedQuickNotesCard({
  state,
  onOpen,
  onRetry,
}: {
  state: ArkmeRelatedQuickNotesLoadState
  onOpen: () => void
  onRetry: () => void
}) {
  if (state.kind === 'idle' || state.kind === 'loading' || state.kind === 'empty') return null
  if (state.kind === 'error') {
    return <div style={styles.compactError} data-arkme-related-quick-notes-error title={state.message}>
      <span>相关快记加载失败</span>
      <button type="button" style={styles.retry} onClick={onRetry}>重试</button>
    </div>
  }
  if (state.list.items.length === 0) return null
  return <button
    type="button"
    style={styles.card}
    aria-label={`查看 ${String(state.list.total)} 条相关快记`}
    data-arkme-related-quick-notes-card
    onClick={onOpen}
  >
    <span style={styles.cardHeader}>
      <span style={styles.cardTitle}>相关快记</span>
      <span style={styles.cardCount}>共 {state.list.total} 条</span>
      <CaretRight size={14} color={arkmeTheme.tertiary} aria-hidden />
    </span>
    <span style={styles.previewList}>
      {state.list.items.slice(0, 2).map(item => <span key={item.relatedRef} style={styles.preview}>{notePreview(item)}</span>)}
    </span>
  </button>
}

export function ArkmeRelatedQuickNotesList({
  state,
  onSelect,
  onRetry,
}: {
  state: ArkmeRelatedQuickNotesLoadState
  onSelect: (item: ArkmeRelatedQuickNoteItem) => void
  onRetry: () => void
}) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return <div style={styles.state} role="status">正在加载相关快记…</div>
  }
  if (state.kind === 'empty') return <div style={styles.state}>暂无相关快记</div>
  if (state.kind === 'error') {
    return <div style={styles.state} role="alert">
      <div>{state.message || '相关快记加载失败'}</div>
      <button type="button" style={{ ...styles.retry, marginTop: 10 }} onClick={onRetry}>重试</button>
    </div>
  }
  if (state.list.items.length === 0) return <div style={styles.state}>暂无相关快记</div>
  return <div style={styles.list} data-arkme-related-quick-notes-list>
    {state.list.items.map(item => {
      const preview = notePreview(item)
      const time = dateTimeDisplay(item.sendAtMillis)
      return <button
        key={item.relatedRef}
        type="button"
        style={styles.listRow}
        aria-label={`打开相关快记：${preview}`}
        onClick={() => { onSelect(item) }}
      >
        <ArkmeUserAvatar
          {...(item.senderAvatarRef === undefined ? {} : { avatarRef: item.senderAvatarRef })}
          size={30}
          label="相关快记作者头像"
        />
        <span style={styles.rowBody}>
          <span style={styles.rowMeta}>
            <span style={styles.sender}>{item.senderName}</span>
            {time !== undefined && <time style={styles.time} dateTime={time.iso}>{time.label}</time>}
          </span>
          <span style={styles.rowText}>{preview}</span>
          {item.sourceLabel !== undefined && item.sourceLabel.trim() !== ''
            && <span style={styles.sourceLabel}>{item.sourceLabel}</span>}
        </span>
        <CaretRight size={14} color={arkmeTheme.tertiary} aria-hidden />
      </button>
    })}
  </div>
}

export function ArkmeRelatedQuickNoteDetail({
  state,
  onRetry,
  sourceRef,
  shareWebsite,
  onMessageCopyLinkOpen,
}: {
  state: ArkmeRelatedQuickNoteDetailState
  onRetry: (item: ArkmeRelatedQuickNoteItem) => void
  sourceRef?: string
  shareWebsite?: string
  onMessageCopyLinkOpen?: (sid: string) => void
}) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return <div style={styles.state} role="status">正在加载快记详情…</div>
  }
  if (state.kind === 'error') {
    return <div style={styles.state} role="alert">
      <div>{state.message || '快记详情加载失败'}</div>
      <button type="button" style={{ ...styles.retry, marginTop: 10 }} onClick={() => { onRetry(state.item) }}>重试</button>
    </div>
  }
  const time = dateTimeDisplay(state.detail.sendAtMillis)
  return <div style={styles.detail} data-arkme-related-quick-note-detail="true">
    <div style={styles.detailSender}>
      <ArkmeUserAvatar
        {...(state.detail.avatarRef === undefined ? {} : { avatarRef: state.detail.avatarRef })}
        size={40}
        label="相关快记作者头像"
      />
      <div style={styles.detailSenderBody}>
        <div style={styles.detailSenderName}>{state.detail.senderName}</div>
        {time !== undefined && <time style={styles.detailTime} dateTime={time.iso}>{time.label}</time>}
      </div>
    </div>
    <ArkmeMessageContent
      presentation="detail"
      item={{ ...state.detail, itemUid: state.detail.relatedRef }}
      {...(sourceRef === undefined ? {} : { sourceRef })}
      {...(shareWebsite === undefined ? {} : { shareWebsite })}
      {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
    />
  </div>
}
