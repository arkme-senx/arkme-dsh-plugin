import { type CSSProperties, type ReactNode, type Ref, useId } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeDirectorySourceAvatar } from './ArkmeAvatar.js'
import { ArkmePinnedCorner } from './ArkmePinnedCorner.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeSelectActionIcon } from './message-selection-presentation.js'

export const arkmeForwardStyles: Record<string, CSSProperties> = {
  forwardTargetBackdrop: {
    position: 'absolute', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center',
    padding: 48, boxSizing: 'border-box', background: 'rgba(19,22,26,.30)',
  },
  forwardTargetDialog: {
    width: 'min(520px, 100%)', height: 'min(660px, 100%)', minHeight: 'min(520px, 100%)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 16, background: arkmeTheme.base,
    boxShadow: '0 22px 64px rgba(20,23,31,.24)',
  },
  forwardTargetHeader: {
    height: 54, flex: 'none', display: 'grid', gridTemplateColumns: '54px 1fr 54px', alignItems: 'center', padding: 0,
    boxSizing: 'border-box',
  },
  forwardTargetTitle: { minWidth: 0, margin: 0, textAlign: 'center', color: arkmeTheme.text, fontSize: 16, lineHeight: '22px', fontWeight: 600 },
  forwardTargetClose: { width: 44, height: 44, border: 0, borderRadius: 10, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', fontSize: 30, lineHeight: '30px' },
  forwardTargetSearchWrap: {
    position: 'relative', margin: '4px 18px 12px', height: 38, flex: 'none',
  },
  forwardTargetSearchIcon: {
    position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 17, height: 17,
    color: arkmeTheme.caption, pointerEvents: 'none',
  },
  forwardTargetSearch: {
    width: '100%', height: '100%', border: 0, borderRadius: 10,
    padding: '0 12px 0 40px', boxSizing: 'border-box', background: arkmeTheme.layer2, color: arkmeTheme.text, outline: 'none',
    fontSize: 13,
  },
  forwardTargetBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
  forwardTargetList: { margin: 0, padding: '4px 18px 18px', listStyle: 'none' },
  forwardTargetRow: {
    position: 'relative',
    width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: '20px 36px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, padding: '9px 8px',
    boxSizing: 'border-box', border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.text,
    cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  forwardTargetRowSelected: {},
  forwardTargetCheck: {
    width: 20, height: 20, display: 'grid', placeItems: 'center', borderRadius: 999, border: `1px solid ${arkmeTheme.tertiary}`,
    color: 'transparent', boxSizing: 'border-box', fontSize: 15, lineHeight: 1,
    opacity: .4,
  },
  forwardTargetCheckSelected: { borderColor: arkmeTheme.text, background: arkmeTheme.text, color: arkmeTheme.base, opacity: 1 },
  forwardTargetText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  forwardTargetName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '22px', fontWeight: 500 },
  forwardTargetMeta: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  forwardTargetTime: { color: arkmeTheme.caption, fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
  forwardTargetStatus: { padding: '16px 18px 28px', color: arkmeTheme.secondary, textAlign: 'center', fontSize: 12, lineHeight: '18px' },
  forwardTargetFooter: {
    flex: 'none', padding: '10px 16px 14px', borderTop: `1px solid ${arkmeTheme.border}`, boxSizing: 'border-box',
    background: arkmeTheme.base,
  },
  forwardTargetRecipients: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, padding: '0 2px', color: arkmeTheme.text, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  forwardTargetAvatarStack: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' },
  forwardTargetFooterDivider: { height: 1, margin: '8px 2px 0', background: arkmeTheme.border },
  forwardTargetPreview: {
    position: 'relative', minHeight: 34, display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) 28px', alignItems: 'center', gap: 8,
    padding: '0 2px 2px', marginTop: 6, boxSizing: 'border-box',
  },
  forwardTargetPreviewIcon: { width: 26, height: 32, color: arkmeTheme.secondary, display: 'grid', placeItems: 'center' },
  forwardTargetPreviewText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  forwardTargetPreviewTitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.text, fontSize: 12, lineHeight: '16px', fontWeight: 400 },
  forwardTargetPreviewSubtitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px' },
  forwardTargetPreviewClose: {
    width: 28, height: 28, borderRadius: 14, border: 0, background: 'transparent',
    color: arkmeTheme.tertiary, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
  },
  forwardTargetComposer: {
    position: 'relative', minHeight: 54, marginTop: 6, boxSizing: 'border-box', borderRadius: 12, background: arkmeTheme.layer2,
  },
  forwardTargetCommentInput: {
    width: '100%', minWidth: 0, minHeight: 54, maxHeight: 102, resize: 'none', border: 0, outline: 'none',
    padding: '17px 66px 17px 16px', boxSizing: 'border-box', background: 'transparent', color: arkmeTheme.text,
    fontSize: 14, lineHeight: '20px', fontFamily: 'inherit',
  },
  forwardTargetSend: {
    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
    width: 40, height: 40, border: 0, borderRadius: 999, display: 'grid', placeItems: 'center',
    background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', padding: 0,
  },
  forwardTargetSendDisabled: { opacity: .45, cursor: 'default' },
  forwardTargetSendError: { margin: '8px 2px 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '16px' },
}
const styles = arkmeForwardStyles

function ArkmeForwardLinearIcon({ size = 18 }: { size?: number }) {
  return <ArkmeSelectActionIcon kind="forward" size={size} />
}

function ArkmeForwardCloseBorderIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
    <path d="M6 6L10 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 6L6 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function ArkmeForwardSubmitIcon() {
  return <ArkmeSelectActionIcon kind="forward" size={22} />
}

export function ArkmeSearchIcon() {
  return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M8.75 15.5C12.4779 15.5 15.5 12.4779 15.5 8.75C15.5 5.02208 12.4779 2 8.75 2C5.02208 2 2 5.02208 2 8.75C2 12.4779 5.02208 15.5 8.75 15.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M13.75 13.75L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
}

export function arkmeForwardTargetTimeLabel(value: number, now: number = Date.now()): string {
  const millis = value > 0 && value < 100_000_000_000 ? value * 1000 : value
  if (!Number.isFinite(millis) || millis <= 0) return ''
  const date = new Date(millis)
  if (date.toDateString() === new Date(now).toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}


/** Presentation shared by native DSH, AI conversations and Arkme message forwarding. */
export function ArkmeForwardTargetRow({ target, selected, disabled, meta, statusText, onToggle }: {
  target: ArkmeSourceItem; selected: boolean; disabled?: boolean; meta: string; statusText?: string; onToggle(): void
}) {
  return <button type="button" style={{ ...styles.forwardTargetRow, ...(selected ? styles.forwardTargetRowSelected : {}) }}
    aria-pressed={selected} disabled={disabled} onClick={onToggle}>
    {target.isPinned === true && <ArkmePinnedCorner />}
    <span style={{ ...styles.forwardTargetCheck, ...(selected ? styles.forwardTargetCheckSelected : {}) }} aria-hidden>✓</span>
    <ArkmeDirectorySourceAvatar source={target} size={38} />
    <span style={styles.forwardTargetText}>
      <span style={styles.forwardTargetName}><ArkmeRichText text={target.displayName} presentation="preview" /></span>
      <span style={styles.forwardTargetMeta}><ArkmeRichText text={statusText ?? (target.latestPreview?.trim() || meta)} presentation="preview" /></span>
    </span>
    <span style={styles.forwardTargetTime}>{arkmeForwardTargetTimeLabel(target.activeAtMillis)}</span>
  </button>
}

export function ArkmeForwardDialog({ children, dialogRef, viewport = false, keyword, onKeywordChange, sending,
  selectedTargets, previewIcon, previewTitle, previewSubtitle, comment, onCommentChange, commentDisabled = false,
  error, onClose, onSend,
}: {
  children: ReactNode; dialogRef?: Ref<HTMLElement>; viewport?: boolean;
  keyword: string; onKeywordChange(value: string): void; sending: boolean;
  selectedTargets: ArkmeSourceItem[]; previewIcon?: ReactNode; previewTitle: ReactNode; previewSubtitle: ReactNode;
  comment: string; onCommentChange(value: string): void; commentDisabled?: boolean;
  error: string; onClose(): void; onSend(): void;
}) {
  const titleId = useId()
  return <div data-arkme-notification-blocking-overlay="true" style={{ ...styles.forwardTargetBackdrop, ...(viewport ? { position: 'fixed', zIndex: 1750 } : {}) }}
    onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section ref={dialogRef} style={styles.forwardTargetDialog} role="dialog" aria-modal="true" aria-label="选择转发对象" aria-labelledby={titleId}>
      <header style={styles.forwardTargetHeader}><span aria-hidden /><h3 id={titleId} style={styles.forwardTargetTitle}>转发给</h3>
        <button type="button" style={styles.forwardTargetClose} disabled={sending} aria-label="关闭转发对象选择" onClick={onClose}>×</button>
      </header>
      <div style={styles.forwardTargetSearchWrap}><span style={styles.forwardTargetSearchIcon}><ArkmeSearchIcon /></span>
        <input style={styles.forwardTargetSearch} value={keyword} placeholder="搜索" aria-label="搜索转发对象" disabled={sending} onChange={event => onKeywordChange(event.currentTarget.value)} />
      </div>
      <div style={styles.forwardTargetBody}>{children}</div>
      {selectedTargets.length > 0 && <footer style={styles.forwardTargetFooter}>
        <div style={styles.forwardTargetRecipients}><span>发送给：</span><span style={styles.forwardTargetAvatarStack}>
          {selectedTargets.slice(0, 6).map(target => <ArkmeDirectorySourceAvatar key={target.sourceRef} source={target} size={26} />)}
        </span></div>
        <div style={styles.forwardTargetFooterDivider} />
        <div data-arkme-forward-source="true" style={styles.forwardTargetPreview}>
          <span style={styles.forwardTargetPreviewIcon}>{previewIcon ?? <ArkmeForwardLinearIcon size={18} />}</span>
          <span style={styles.forwardTargetPreviewText}><span style={styles.forwardTargetPreviewTitle}>{previewTitle}</span><span style={styles.forwardTargetPreviewSubtitle}>{previewSubtitle}</span></span>
          <button type="button" style={styles.forwardTargetPreviewClose} disabled={sending} aria-label="关闭转发对象选择" onClick={onClose}><ArkmeForwardCloseBorderIcon /></button>
        </div>
        {error && <div role="alert" style={styles.forwardTargetSendError}>{error}</div>}
        <div style={styles.forwardTargetComposer}>
          <textarea style={styles.forwardTargetCommentInput} value={comment} placeholder="说点什么..." aria-label="转发附言" disabled={sending || commentDisabled}
            onChange={event => onCommentChange(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending) onSend() } }} />
          <button type="button" style={{ ...styles.forwardTargetSend, ...(sending ? styles.forwardTargetSendDisabled : {}) }} disabled={sending}
            aria-label={sending ? '转发中' : '发送转发'} onClick={onSend}><ArkmeForwardSubmitIcon /></button>
        </div>
      </footer>}
    </section>
  </div>
}
