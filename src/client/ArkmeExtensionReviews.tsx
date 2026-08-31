import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeExtensionRatingSummary,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewPage,
} from '../extensions/types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'

const primaryAction = 'var(--dsw-alias-label-primary, #242629)'
const emptyRating: ArkmeExtensionRatingSummary = { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }

const styles: Record<string, CSSProperties> = {
  section: { marginTop: 20, padding: '20px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 650, color: 'var(--dsw-alias-label-primary, #242629)' },
  headingCount: { marginLeft: 7, color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontWeight: 500 },
  commentButton: { height: 30, padding: '0 13px', border: 0, borderRadius: 8, background: primaryAction, color: '#fff', font: 'inherit', fontSize: 11, fontWeight: 650, cursor: 'pointer' },
  summary: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  average: { fontSize: 22, lineHeight: '28px', fontWeight: 700, color: 'var(--dsw-alias-label-primary, #242629)' },
  stars: { display: 'inline-flex', gap: 2, color: '#f3aa18', letterSpacing: 0, fontSize: 14 },
  count: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 10 },
  list: { marginTop: 18 },
  review: { position: 'relative', padding: '14px 0', borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  openThreadButton: { position: 'absolute', zIndex: 0, inset: 0, width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  reviewContent: { position: 'relative', zIndex: 1, pointerEvents: 'none' },
  reviewLayout: { display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', columnGap: 11, alignItems: 'start' },
  reviewMain: { position: 'relative', minWidth: 0, paddingRight: 32 },
  authorRow: { display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0, flexWrap: 'wrap' },
  author: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary, #242629)', fontSize: 12, fontWeight: 650 },
  time: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 10 },
  ratingRow: { height: 20, display: 'flex', alignItems: 'center', marginTop: 2 },
  content: { margin: '7px 0 0', color: 'var(--dsw-alias-label-primary, #242629)', fontSize: 12, lineHeight: '19px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  itemActions: { position: 'absolute', zIndex: 2, top: -5, right: 0, pointerEvents: 'auto' },
  replyButton: {
    display: 'inline-grid', placeItems: 'center', width: 28, height: 28, padding: 0,
    border: 0, borderRadius: 7, background: 'var(--dsw-alias-fill-secondary, #f4f5f6)',
    color: 'var(--dsw-alias-label-secondary, #717780)', cursor: 'pointer',
    transition: 'opacity 120ms ease, transform 120ms ease',
  },
  state: { padding: '18px 0 10px', color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 11, textAlign: 'center' },
  error: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(194,65,59,.08)', color: 'var(--dsw-alias-state-error-primary, #c2413b)', fontSize: 11 },
  loadMore: { width: '100%', height: 30, marginTop: 6, border: 0, borderRadius: 8, background: 'var(--dsw-alias-fill-secondary, #f4f5f6)', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 10, cursor: 'pointer' },
  inlineComposer: {
    display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', gap: 9, marginTop: 10, padding: '9px 10px',
    border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 11,
    background: 'var(--dsw-specific-sidebar-fill, #fff)', boxSizing: 'border-box',
  },
  inlineComposerMain: { minWidth: 0 },
  inlineComposerTitle: { color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 10, lineHeight: '16px' },
  inlineRatingPicker: { display: 'flex', gap: 1, marginBottom: 4 },
  inlineStarButton: { width: 24, height: 24, padding: 0, border: 0, background: 'transparent', fontSize: 19, lineHeight: '24px', cursor: 'pointer' },
  inlineTextarea: {
    width: '100%', minHeight: 42, maxHeight: 160, padding: 0, resize: 'vertical', overflowY: 'auto', boxSizing: 'border-box', border: 0, outline: 0,
    background: 'transparent', color: 'var(--dsw-alias-label-primary, #242629)', font: 'inherit', fontSize: 12, lineHeight: '18px',
  },
  inlineComposerFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 5 },
  inlineSubmit: { height: 28, padding: '0 13px', border: 0, borderRadius: 8, background: primaryAction, color: '#fff', font: 'inherit', fontSize: 11, fontWeight: 650, cursor: 'pointer' },
  inlineCancel: { height: 28, padding: '0 12px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 11, cursor: 'pointer' },
  inlineReplySlot: { margin: '4px 0 0 45px' },
  replyList: { margin: '8px 0 0 45px', paddingLeft: 12, borderLeft: '2px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  overlay: { position: 'fixed', zIndex: 120, inset: 0, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(17,24,39,.28)' },
  composer: { width: 'min(480px, calc(100vw - 48px))', padding: 18, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 14, background: 'var(--dsw-specific-sidebar-fill, #fff)', boxShadow: '0 18px 50px rgba(20,24,31,.22)' },
  threadDialog: { width: 'min(520px, calc(100vw - 48px))', maxHeight: 'min(680px, calc(100vh - 48px))', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 14, overflow: 'hidden', background: 'var(--dsw-specific-sidebar-fill, #fff)', boxShadow: '0 18px 50px rgba(20,24,31,.22)' },
  threadHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  threadBody: { minHeight: 0, overflowY: 'auto', padding: '0 18px 18px' },
  threadOriginal: { padding: '15px 0', borderBottom: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  threadSectionLabel: { margin: '14px 0 2px', color: 'var(--dsw-alias-label-primary, #242629)', fontSize: 11, lineHeight: '18px', fontWeight: 650 },
  threadReply: { padding: '11px 0', borderBottom: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  closeButton: { width: 28, height: 28, padding: 0, border: 0, borderRadius: 7, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 18, lineHeight: '28px', cursor: 'pointer' },
  composerTitle: { margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 650, color: 'var(--dsw-alias-label-primary, #242629)' },
  composerHint: { marginTop: 4, color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 10, lineHeight: '16px' },
  originalQuote: { marginTop: 12, padding: '9px 11px', borderLeft: `3px solid ${primaryAction}`, borderRadius: '0 8px 8px 0', background: 'var(--dsw-alias-fill-secondary, #f4f5f6)' },
  originalLabel: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 9, lineHeight: '14px', fontWeight: 600 },
  originalText: { maxHeight: 54, margin: '3px 0 0', overflow: 'auto', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11, lineHeight: '17px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  ratingPicker: { display: 'flex', gap: 3, marginTop: 12 },
  starButton: { width: 28, height: 28, padding: 0, border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer' },
  textarea: { width: '100%', minHeight: 112, marginTop: 12, padding: 10, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 9, outline: 0, background: 'var(--dsw-specific-sidebar-fill, #fff)', color: 'var(--dsw-alias-label-primary, #242629)', font: 'inherit', fontSize: 12, lineHeight: '18px' },
  composerFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  charCount: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 9 },
  actions: { display: 'flex', gap: 8 },
  cancel: { height: 32, padding: '0 13px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 11, cursor: 'pointer' },
  submit: { height: 32, padding: '0 15px', border: 0, borderRadius: 8, background: primaryAction, color: '#fff', font: 'inherit', fontSize: 11, fontWeight: 650, cursor: 'pointer' },
}

export interface ArkmeExtensionReviewTreeNode {
  item: ArkmeExtensionReviewItem
  children: ArkmeExtensionReviewTreeNode[]
}

export function extensionReviewComposerMode(
  canCreateTopLevelReview: boolean,
  hasReplyComposer: boolean,
): 'top-level' | 'reply' | 'hidden' {
  if (hasReplyComposer) return 'reply'
  return canCreateTopLevelReview ? 'top-level' : 'hidden'
}

export function extensionReviewComposerTargets(
  reviewRef: string,
  state: ArkmeExtensionReviewComposerState | undefined,
): boolean {
  return state?.parent?.reviewRef === reviewRef
}

export function extensionReviewTree(items: readonly ArkmeExtensionReviewItem[]): ArkmeExtensionReviewTreeNode[] {
  const nodes = new Map(items.map(item => [item.reviewRef, { item, children: [] as ArkmeExtensionReviewTreeNode[] }]))
  const roots: ArkmeExtensionReviewTreeNode[] = []
  for (const item of items) {
    const node = nodes.get(item.reviewRef)!
    const parent = item.parentReviewRef === undefined ? undefined : nodes.get(item.parentReviewRef)
    if (parent === undefined || parent === node) roots.push(node)
    else parent.children.push(node)
  }
  return roots
}

export function applyCreatedExtensionReview(
  current: ArkmeExtensionReviewPage | undefined,
  result: ArkmeExtensionReviewCreateResult,
): ArkmeExtensionReviewPage {
  if (current === undefined) {
    return {
      items: [result.review], total: 1, limit: 20, offset: 0, hasMore: false,
      ratingSummary: result.ratingSummary,
    }
  }
  const existingIndex = current.items.findIndex(item => item.reviewRef === result.review.reviewRef)
  const items = existingIndex >= 0
    ? current.items.map((item, index) => index === existingIndex ? result.review : item)
    : result.review.parentReviewRef === undefined
      ? [result.review, ...current.items]
      : [...current.items, result.review]
  return {
    ...current,
    items,
    total: current.total + (existingIndex < 0
      && result.review.parentReviewRef === undefined
      && result.idempotentReplay !== true ? 1 : 0),
    ratingSummary: result.ratingSummary,
  }
}

export function extensionReviewReplyCount(node: ArkmeExtensionReviewTreeNode): number {
  return node.children.reduce((total, child) => total + 1 + extensionReviewReplyCount(child), 0)
}

export function extensionRatingLabel(summary: ArkmeExtensionRatingSummary): string {
  return summary.count === 0 ? '暂无评分' : `${summary.average.toFixed(1)} · ${String(summary.count)} 个评分`
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return <span style={{ ...styles.stars, fontSize: size }} aria-label={`${value.toFixed(1)} 星`}>
    {[0, 1, 2, 3, 4].map(index => {
      const fill = Math.max(0, Math.min(1, value - index))
      return <span key={index} style={{ position: 'relative', width: '1em', display: 'inline-block', color: '#d7d9dd' }}>
        ★
        {fill > 0 && <span style={{ position: 'absolute', inset: 0, width: `${String(fill * 100)}%`, overflow: 'hidden', color: '#f3aa18' }}>★</span>}
      </span>
    })}
  </span>
}

export function extensionReviewTimeLabel(createdAtMillis: number, nowMillis = Date.now()): string {
  if (!Number.isFinite(createdAtMillis) || createdAtMillis <= 0) return ''
  const elapsed = Math.max(0, nowMillis - createdAtMillis)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return '刚刚'
  if (elapsed < hour) return `${String(Math.floor(elapsed / minute))} 分钟前`
  if (elapsed < day) return `${String(Math.floor(elapsed / hour))} 小时前`
  if (elapsed < 30 * day) return `${String(Math.floor(elapsed / day))} 天前`
  if (elapsed < 365 * day) return `${String(Math.floor(elapsed / (30 * day)))} 个月前`
  return `${String(Math.floor(elapsed / (365 * day)))} 年前`
}

function ReplyIcon() {
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path d="M9 8L4 12L9 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 12H13.5C17.09 12 20 14.91 20 18.5V19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function browserSupportsHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(hover: hover)').matches
}

function ReviewPresentation({ item, onReply, clickThrough = false }: {
  item: ArkmeExtensionReviewItem
  onReply(item: ArkmeExtensionReviewItem): void
  clickThrough?: boolean
}) {
  const [hoverCapable] = useState(browserSupportsHover)
  const [actionsVisible, setActionsVisible] = useState(false)
  const showReplyAction = !hoverCapable || actionsVisible
  return <div
    style={{ ...styles.reviewLayout, ...(clickThrough ? styles.reviewContent : {}) }}
    onPointerEnter={() => setActionsVisible(true)}
    onPointerLeave={() => setActionsVisible(false)}
    onFocusCapture={() => setActionsVisible(true)}
    onBlurCapture={() => setActionsVisible(false)}
  >
    <ArkmeUserAvatar
      {...(item.authorAvatarRef === undefined ? {} : { avatarRef: item.authorAvatarRef })}
      {...(item.authorAvatarFallback === undefined ? {} : { fallback: item.authorAvatarFallback })}
      size={34}
      label={`${item.authorName}头像`}
    />
    <div data-arkme-review-main="true" style={styles.reviewMain}>
      <div style={styles.authorRow}>
        <span style={styles.author}>{item.authorName}</span>
        <time style={styles.time}>{extensionReviewTimeLabel(item.createdAtMillis)}</time>
      </div>
      {item.rating > 0 && <div style={styles.ratingRow}><Stars value={item.rating} size={12} /></div>}
      <p style={styles.content}>{item.textContent}</p>
      <div style={styles.itemActions} data-extension-review-actions="hover">
        <ReplyButton item={item} visible={showReplyAction} onReply={onReply} />
      </div>
    </div>
  </div>
}

function ReplyButton({ item, visible, onReply }: {
  item: ArkmeExtensionReviewItem
  visible: boolean
  onReply(item: ArkmeExtensionReviewItem): void
}) {
  return <button
    type="button"
    style={{
      ...styles.replyButton,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(-2px)',
      pointerEvents: visible ? 'auto' : 'none',
    }}
    aria-label={`回复${item.authorName}`}
    title="回复"
    data-extension-review-reply-action="true"
    onClick={event => { event.stopPropagation(); onReply(item) }}
  >
    <ReplyIcon />
  </button>
}

interface ArkmeExtensionInlineReplyEditor {
  state: ArkmeExtensionReviewComposerState
  submitting: boolean
  currentUserAvatarRef?: string | undefined
  onChange(next: ArkmeExtensionReviewComposerState): void
  onCancel(): void
  onSubmit(): void
}

function ReviewReplyComposerSlot({ item, editor }: {
  item: ArkmeExtensionReviewItem
  editor?: ArkmeExtensionInlineReplyEditor | undefined
}) {
  if (editor === undefined || !extensionReviewComposerTargets(item.reviewRef, editor.state)) return null
  return <div style={styles.inlineReplySlot} data-extension-reply-composer-for={item.reviewRef}>
    <ArkmeExtensionInlineReviewComposer
      state={editor.state}
      submitting={editor.submitting}
      {...(editor.currentUserAvatarRef === undefined ? {} : { currentUserAvatarRef: editor.currentUserAvatarRef })}
      onChange={editor.onChange}
      onCancel={editor.onCancel}
      onSubmit={editor.onSubmit}
    />
  </div>
}

function ReviewNode({ node, onReply, replyEditor }: {
  node: ArkmeExtensionReviewTreeNode
  onReply(item: ArkmeExtensionReviewItem): void
  replyEditor?: ArkmeExtensionInlineReplyEditor | undefined
}) {
  const item = node.item
  return <article style={styles.review}>
    <ReviewPresentation item={item} onReply={onReply} />
    <ReviewReplyComposerSlot item={item} editor={replyEditor} />
    {node.children.length > 0 && <div style={styles.replyList} aria-label={`${item.authorName}的全部回复`}>
      {node.children.map(child => <ThreadReply key={child.item.reviewRef} node={child} depth={0} onReply={onReply} replyEditor={replyEditor} />)}
    </div>}
  </article>
}

function ThreadReply({ node, depth, onReply, replyEditor }: {
  node: ArkmeExtensionReviewTreeNode
  depth: number
  onReply(item: ArkmeExtensionReviewItem): void
  replyEditor?: ArkmeExtensionInlineReplyEditor | undefined
}) {
  const item = node.item
  return <div style={{ ...styles.threadReply, marginLeft: Math.min(depth * 18, 54) }}>
    <ReviewPresentation item={item} onReply={onReply} />
    <ReviewReplyComposerSlot item={item} editor={replyEditor} />
    {node.children.map(child => <ThreadReply key={child.item.reviewRef} node={child} depth={depth + 1} onReply={onReply} replyEditor={replyEditor} />)}
  </div>
}

export function ArkmeExtensionReplyListDialog({ root, onClose, onReply }: {
  root: ArkmeExtensionReviewTreeNode
  onClose(): void
  onReply(item: ArkmeExtensionReviewItem): void
}) {
  const item = root.item
  const replyCount = extensionReviewReplyCount(root)
  const dialog = <div style={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="arkme-extension-replies-title" style={styles.threadDialog}>
      <header style={styles.threadHeader}>
        <h3 id="arkme-extension-replies-title" style={styles.composerTitle}>评论回复</h3>
        <button type="button" style={styles.closeButton} aria-label="关闭回复列表" onClick={onClose}>×</button>
      </header>
      <div style={styles.threadBody}>
        <div style={styles.threadOriginal}>
          <div style={styles.originalLabel}>原评论</div>
          <div style={{ marginTop: 7 }}>
            <ReviewPresentation item={item} onReply={onReply} />
          </div>
        </div>
        <div style={styles.threadSectionLabel}>全部回复 {replyCount}</div>
        {root.children.length === 0
          ? <div style={styles.state}>还没有回复。</div>
          : root.children.map(child => <ThreadReply key={child.item.reviewRef} node={child} depth={0} onReply={onReply} />)}
      </div>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export interface ArkmeExtensionReviewComposerState {
  parent?: ArkmeExtensionReviewItem
  textContent: string
  rating: number
  clientMutationId: string
  error: string
}

export function extensionReviewComposerCanSubmit(input: {
  textContent: string
  rating: number
  replying: boolean
}): boolean {
  return input.textContent.trim() !== '' && (input.replying || input.rating >= 1 && input.rating <= 5)
}

export function extensionReviewCreateParams(extensionId: string, state: ArkmeExtensionReviewComposerState): Record<string, unknown> {
  return {
    extensionId,
    textContent: state.textContent,
    ...(state.parent === undefined ? { rating: state.rating } : { parentReviewRef: state.parent.reviewRef }),
    clientMutationId: state.clientMutationId,
  }
}

function newMutationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('当前浏览器不支持安全评论请求标识')
  return globalThis.crypto.randomUUID()
}

export function ArkmeExtensionReviewComposerDialog({ state, submitting, onChange, onClose, onSubmit }: {
  state: ArkmeExtensionReviewComposerState
  submitting: boolean
  onChange(next: ArkmeExtensionReviewComposerState): void
  onClose(): void
  onSubmit(): void
}) {
  const replying = state.parent !== undefined
  const valid = extensionReviewComposerCanSubmit({ textContent: state.textContent, rating: state.rating, replying })
  const dialog = <div style={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="arkme-extension-review-composer-title" style={styles.composer}>
      <h3 id="arkme-extension-review-composer-title" style={styles.composerTitle}>{replying ? `回复 ${state.parent!.authorName}` : '发表评价'}</h3>
      <div style={styles.composerHint}>{replying ? '回复不会改变扩展评分。' : '评论正文会同时保存为首页中的普通快记。'}</div>
      {replying && <div style={styles.originalQuote} aria-label="回复原文">
        <div style={styles.originalLabel}>回复原文 · {state.parent!.authorName}</div>
        <p style={styles.originalText}>{state.parent!.textContent}</p>
      </div>}
      {!replying && <div style={styles.ratingPicker} aria-label="选择评分">
        {[1, 2, 3, 4, 5].map(star => <button
          key={star} type="button" style={{ ...styles.starButton, color: star <= state.rating ? '#f3aa18' : '#d7d9dd' }}
          aria-label={`${String(star)} 星`} aria-pressed={star <= state.rating}
          onClick={() => { onChange({ ...state, rating: star, error: '' }) }}
        >★</button>)}
      </div>}
      <textarea
        autoFocus maxLength={2000} value={state.textContent} placeholder={replying ? '输入回复内容' : '分享你的使用体验'}
        style={styles.textarea} onChange={event => { onChange({ ...state, textContent: event.target.value, error: '' }) }}
      />
      {state.error !== '' && <div style={styles.error} role="alert">{state.error}</div>}
      <div style={styles.composerFooter}>
        <span style={styles.charCount}>{[...state.textContent].length}/2000</span>
        <div style={styles.actions}>
          <button type="button" style={styles.cancel} disabled={submitting} onClick={onClose}>取消</button>
          <button type="button" style={{ ...styles.submit, ...(!valid || submitting ? { opacity: .5, cursor: 'not-allowed' } : {}) }} disabled={!valid || submitting} onClick={onSubmit}>
            {submitting ? '提交中…' : replying ? '回复' : '发表评论'}
          </button>
        </div>
      </div>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export function ArkmeExtensionInlineReviewComposer({ state, submitting, currentUserAvatarRef, onChange, onSubmit, onCancel }: {
  state: ArkmeExtensionReviewComposerState
  submitting: boolean
  currentUserAvatarRef?: string | undefined
  onChange(next: ArkmeExtensionReviewComposerState): void
  onSubmit(): void
  onCancel?: (() => void) | undefined
}) {
  const replying = state.parent !== undefined
  const valid = extensionReviewComposerCanSubmit({ textContent: state.textContent, rating: state.rating, replying })
  return <div style={styles.inlineComposer} data-extension-review-composer="inline">
    <ArkmeUserAvatar
      {...(currentUserAvatarRef === undefined ? {} : { avatarRef: currentUserAvatarRef })}
      size={30}
      label="我的头像"
    />
    <div style={styles.inlineComposerMain}>
      {replying && <div style={styles.inlineComposerTitle}>回复 {state.parent!.authorName}</div>}
      {!replying && <div style={styles.inlineRatingPicker} aria-label="选择评分">
        {[1, 2, 3, 4, 5].map(star => <button
          key={star} type="button" style={{ ...styles.inlineStarButton, color: star <= state.rating ? '#f3aa18' : '#d7d9dd' }}
          aria-label={`${String(star)} 星`} aria-pressed={star <= state.rating}
          onClick={() => { onChange({ ...state, rating: star, error: '' }) }}
        >★</button>)}
      </div>}
      <textarea
        {...(replying ? { autoFocus: true } : {})}
        maxLength={2000} value={state.textContent}
        placeholder={replying ? '输入回复内容…' : '分享你的使用体验'}
        style={styles.inlineTextarea}
        onChange={event => { onChange({ ...state, textContent: event.target.value, error: '' }) }}
      />
      {state.error !== '' && <div style={styles.error} role="alert">{state.error}</div>}
      <div style={styles.inlineComposerFooter}>
        <span style={styles.charCount}>{[...state.textContent].length}/2000</span>
        <div style={styles.actions}>
          {onCancel !== undefined && <button type="button" style={styles.inlineCancel} disabled={submitting} onClick={onCancel}>取消</button>}
          <button
            type="button" style={{ ...styles.inlineSubmit, ...(!valid || submitting ? { opacity: .42, cursor: 'not-allowed' } : {}) }}
            disabled={!valid || submitting} onClick={onSubmit}
          >{submitting ? '提交中…' : replying ? '回复' : '发布'}</button>
        </div>
      </div>
    </div>
  </div>
}

export function ArkmeExtensionReviews({
  extensionId,
  currentUserAvatarRef,
  canCreateTopLevelReview = true,
  initialRatingSummary = emptyRating,
  initialPage,
}: {
  extensionId: string
  currentUserAvatarRef?: string | undefined
  canCreateTopLevelReview?: boolean
  initialRatingSummary?: ArkmeExtensionRatingSummary
  initialPage?: ArkmeExtensionReviewPage
}) {
  const [page, setPage] = useState<ArkmeExtensionReviewPage | undefined>(initialPage)
  const [loading, setLoading] = useState(initialPage === undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [topLevelComposer, setTopLevelComposer] = useState<ArkmeExtensionReviewComposerState>({
    textContent: '', rating: 0, clientMutationId: '', error: '',
  })
  const [replyComposer, setReplyComposer] = useState<ArkmeExtensionReviewComposerState>()
  const [submitting, setSubmitting] = useState(false)
  const extensionRevisionRef = useRef(0)
  const listControllerRef = useRef<AbortController>()
  const locallyCreatedReviewsRef = useRef(new Map<string, ArkmeExtensionReviewCreateResult>())
  const tree = useMemo(() => extensionReviewTree(page?.items ?? []), [page?.items])
  const summary = page?.ratingSummary ?? initialRatingSummary
  const composerMode = extensionReviewComposerMode(canCreateTopLevelReview, replyComposer !== undefined)

  const load = async (offset = 0) => {
    const revision = extensionRevisionRef.current
    const controller = new AbortController()
    listControllerRef.current?.abort()
    listControllerRef.current = controller
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const next = await callArkme<ArkmeExtensionReviewPage>(
        'extensions.reviews.list', { extensionId, limit: 20, offset }, controller.signal,
      )
      if (controller.signal.aborted || revision !== extensionRevisionRef.current) return
      const withLocalCreates = [...locallyCreatedReviewsRef.current.values()]
        .reduce((current, result) => applyCreatedExtensionReview(current, result), next)
      setPage(current => offset === 0 || current === undefined ? withLocalCreates : {
        ...withLocalCreates,
        items: [...current.items, ...withLocalCreates.items.filter(item => !current.items.some(existing => existing.reviewRef === item.reviewRef))],
      })
    } catch (caught) {
      if (!controller.signal.aborted && revision === extensionRevisionRef.current) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (listControllerRef.current === controller) listControllerRef.current = undefined
      if (revision === extensionRevisionRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    extensionRevisionRef.current += 1
    listControllerRef.current?.abort()
    listControllerRef.current = undefined
    locallyCreatedReviewsRef.current.clear()
    setPage(initialPage)
    setLoading(initialPage === undefined)
    setTopLevelComposer({ textContent: '', rating: 0, clientMutationId: '', error: '' })
    setReplyComposer(undefined)
    if (initialPage === undefined) void load()
    return () => { listControllerRef.current?.abort() }
  }, [extensionId])
  useEffect(() => {
    if (canCreateTopLevelReview) return
    setTopLevelComposer({ textContent: '', rating: 0, clientMutationId: '', error: '' })
  }, [canCreateTopLevelReview])
  useEffect(() => {
    if (replyComposer === undefined) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) setReplyComposer(undefined) }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [replyComposer !== undefined, submitting])

  const openReplyComposer = (parent: ArkmeExtensionReviewItem) => {
    if (submitting) return
    try {
      setReplyComposer({ parent, textContent: '', rating: 0, clientMutationId: newMutationId(), error: '' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const submit = async (kind: 'top-level' | 'reply') => {
    const current = kind === 'top-level' ? topLevelComposer : replyComposer
    if (current === undefined || submitting) return
    let prepared = current
    try {
      if (prepared.clientMutationId === '') prepared = { ...prepared, clientMutationId: newMutationId() }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      if (kind === 'top-level') setTopLevelComposer(value => ({ ...value, error: message }))
      else setReplyComposer(value => value === undefined ? value : { ...value, error: message })
      return
    }
    if (kind === 'top-level') setTopLevelComposer(prepared)
    else setReplyComposer(prepared)
    setSubmitting(true)
    const revision = extensionRevisionRef.current
    try {
      const result = await callArkme<ArkmeExtensionReviewCreateResult>('extensions.reviews.create', {
        ...extensionReviewCreateParams(extensionId, prepared),
      })
      if (revision !== extensionRevisionRef.current) return
      locallyCreatedReviewsRef.current.set(result.review.reviewRef, result)
      setPage(currentPage => applyCreatedExtensionReview(currentPage, result))
      if (kind === 'top-level') setTopLevelComposer({ textContent: '', rating: 0, clientMutationId: '', error: '' })
      else setReplyComposer(undefined)
    } catch (caught) {
      if (revision !== extensionRevisionRef.current) return
      const message = caught instanceof Error ? caught.message : String(caught)
      if (kind === 'top-level') setTopLevelComposer(value => ({ ...value, error: message }))
      else setReplyComposer(value => value === undefined ? value : { ...value, error: message })
    } finally {
      if (revision === extensionRevisionRef.current) setSubmitting(false)
    }
  }

  return <section style={styles.section} aria-label="扩展评论">
    <div style={styles.headingRow}>
      <h3 style={styles.heading} title={extensionRatingLabel(summary)}>
        用户评价 <span style={styles.headingCount}>{String(page?.total ?? 0)} 条评论</span>
      </h3>
    </div>
    {composerMode === 'top-level' && <ArkmeExtensionInlineReviewComposer
          state={topLevelComposer} submitting={submitting}
          {...(currentUserAvatarRef === undefined ? {} : { currentUserAvatarRef })}
          onChange={setTopLevelComposer} onSubmit={() => { void submit('top-level') }}
        />}
    {error !== '' && <div style={styles.error} role="alert">{error}</div>}
    {loading && <div style={styles.state}>正在加载评论…</div>}
    {!loading && tree.length === 0 && error === '' && <div style={styles.state}>
      {canCreateTopLevelReview ? '还没有评论，来发表第一条评价吧。' : '还没有用户评价。'}
    </div>}
    {!loading && tree.length > 0 && <div style={styles.list}>
      {tree.map(node => <ReviewNode
        key={node.item.reviewRef}
        node={node}
        onReply={openReplyComposer}
        {...(replyComposer === undefined ? {} : { replyEditor: {
          state: replyComposer,
          submitting,
          ...(currentUserAvatarRef === undefined ? {} : { currentUserAvatarRef }),
          onChange: setReplyComposer,
          onCancel: () => { if (!submitting) setReplyComposer(undefined) },
          onSubmit: () => { void submit('reply') },
        } })}
      />)}
    </div>}
    {page?.hasMore === true && <button type="button" style={styles.loadMore} disabled={loadingMore} onClick={() => { void load(page.nextOffset ?? page.offset + page.limit) }}>
      {loadingMore ? '加载中…' : '加载更多'}
    </button>}
  </section>
}
