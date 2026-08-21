import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeExtensionRatingSummary,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewPage,
} from '../extensions/types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'

const accent = '#8295E8'
const emptyRating: ArkmeExtensionRatingSummary = { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }

const styles: Record<string, CSSProperties> = {
  section: { padding: '14px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { margin: 0, fontSize: 13, lineHeight: '20px', fontWeight: 650, color: 'var(--dsw-alias-label-primary, #242629)' },
  commentButton: { height: 30, padding: '0 13px', border: 0, borderRadius: 8, background: 'rgba(130,149,232,.12)', color: accent, font: 'inherit', fontSize: 11, fontWeight: 650, cursor: 'pointer' },
  summary: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  average: { fontSize: 22, lineHeight: '28px', fontWeight: 700, color: 'var(--dsw-alias-label-primary, #242629)' },
  stars: { display: 'inline-flex', gap: 2, color: '#f3aa18', letterSpacing: 0, fontSize: 14 },
  count: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 10 },
  list: { marginTop: 10 },
  review: { position: 'relative', padding: '11px 0', borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', cursor: 'pointer' },
  openThreadButton: { position: 'absolute', zIndex: 0, inset: 0, width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  reviewContent: { position: 'relative', zIndex: 1, pointerEvents: 'none' },
  reviewLayout: { display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr)', columnGap: 10, alignItems: 'start' },
  reviewMain: { minWidth: 0 },
  authorRow: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 },
  author: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary, #242629)', fontSize: 12, fontWeight: 650 },
  time: { marginLeft: 'auto', color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 9 },
  ratingRow: { height: 20, display: 'flex', alignItems: 'center', marginTop: 2 },
  content: { margin: '7px 0 0', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  itemActions: { display: 'flex', alignItems: 'center', gap: 8, margin: '7px 0 0' },
  replyButton: { display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 30, padding: '2px 4px 2px 0', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 12, fontWeight: 600, lineHeight: '16px', cursor: 'pointer' },
  state: { padding: '18px 0 10px', color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 11, textAlign: 'center' },
  error: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(194,65,59,.08)', color: 'var(--dsw-alias-state-error-primary, #c2413b)', fontSize: 11 },
  loadMore: { width: '100%', height: 30, marginTop: 6, border: 0, borderRadius: 8, background: 'var(--dsw-alias-fill-secondary, #f4f5f6)', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 10, cursor: 'pointer' },
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
  originalQuote: { marginTop: 12, padding: '9px 11px', borderLeft: `3px solid ${accent}`, borderRadius: '0 8px 8px 0', background: 'var(--dsw-alias-fill-secondary, #f4f5f6)' },
  originalLabel: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 9, lineHeight: '14px', fontWeight: 600 },
  originalText: { maxHeight: 54, margin: '3px 0 0', overflow: 'auto', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11, lineHeight: '17px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  ratingPicker: { display: 'flex', gap: 3, marginTop: 12 },
  starButton: { width: 28, height: 28, padding: 0, border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer' },
  textarea: { width: '100%', minHeight: 112, marginTop: 12, padding: 10, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 9, outline: 0, background: 'var(--dsw-specific-sidebar-fill, #fff)', color: 'var(--dsw-alias-label-primary, #242629)', font: 'inherit', fontSize: 12, lineHeight: '18px' },
  composerFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  charCount: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 9 },
  actions: { display: 'flex', gap: 8 },
  cancel: { height: 32, padding: '0 13px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 11, cursor: 'pointer' },
  submit: { height: 32, padding: '0 15px', border: 0, borderRadius: 8, background: accent, color: '#fff', font: 'inherit', fontSize: 11, fontWeight: 650, cursor: 'pointer' },
}

export interface ArkmeExtensionReviewTreeNode {
  item: ArkmeExtensionReviewItem
  children: ArkmeExtensionReviewTreeNode[]
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

function reviewTime(createdAtMillis: number): string {
  if (!Number.isFinite(createdAtMillis) || createdAtMillis <= 0) return ''
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(createdAtMillis))
}

function ReplyIcon() {
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path d="M8.5 19H8C4 19 2 18 2 13V8C2 4 4 2 8 2H16C20 2 22 4 22 8V13C22 17 20 19 16 19H15.5C15.19 19 14.89 19.15 14.7 19.4L13.2 21.4C12.54 22.28 11.46 22.28 10.8 21.4L9.3 19.4C9.14 19.18 8.77 19 8.5 19Z" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 8H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function ReviewPresentation({ item, replyCount, onReply, clickThrough = false }: {
  item: ArkmeExtensionReviewItem
  replyCount: number
  onReply(item: ArkmeExtensionReviewItem): void
  clickThrough?: boolean
}) {
  return <div style={{ ...styles.reviewLayout, ...(clickThrough ? styles.reviewContent : {}) }}>
    <ArkmeUserAvatar
      {...(item.authorAvatarRef === undefined ? {} : { avatarRef: item.authorAvatarRef })}
      {...(item.authorAvatarFallback === undefined ? {} : { fallback: item.authorAvatarFallback })}
      size={38}
      label={`${item.authorName}头像`}
    />
    <div data-arkme-review-main="true" style={styles.reviewMain}>
      <div style={styles.authorRow}>
        <span style={styles.author}>{item.authorName}</span>
        <time style={styles.time}>{reviewTime(item.createdAtMillis)}</time>
      </div>
      {item.rating > 0 && <div style={styles.ratingRow}><Stars value={item.rating} size={12} /></div>}
      <p style={styles.content}>{item.textContent}</p>
      <div style={{ ...styles.itemActions, position: 'relative', zIndex: 2, pointerEvents: 'auto' }}>
        <ReplyButton item={item} count={replyCount} onReply={onReply} />
      </div>
    </div>
  </div>
}

function ReplyButton({ item, count, onReply }: {
  item: ArkmeExtensionReviewItem
  count: number
  onReply(item: ArkmeExtensionReviewItem): void
}) {
  return <button
    type="button"
    style={styles.replyButton}
    aria-label={`回复${item.authorName}，已有 ${String(count)} 条回复`}
    onClick={event => { event.stopPropagation(); onReply(item) }}
  >
    <ReplyIcon />
    <span>{count}</span>
  </button>
}

function ReviewNode({ node, onOpen, onReply }: {
  node: ArkmeExtensionReviewTreeNode
  onOpen(node: ArkmeExtensionReviewTreeNode): void
  onReply(item: ArkmeExtensionReviewItem): void
}) {
  const item = node.item
  const replyCount = extensionReviewReplyCount(node)
  return <article style={styles.review}>
    <button
      type="button"
      style={styles.openThreadButton}
      aria-label={`查看${item.authorName}的评论及 ${String(replyCount)} 条回复`}
      onClick={() => { onOpen(node) }}
    />
    <ReviewPresentation item={item} replyCount={replyCount} onReply={onReply} clickThrough />
  </article>
}

function ThreadReply({ node, depth, onReply }: {
  node: ArkmeExtensionReviewTreeNode
  depth: number
  onReply(item: ArkmeExtensionReviewItem): void
}) {
  const item = node.item
  const replyCount = extensionReviewReplyCount(node)
  return <div style={{ ...styles.threadReply, marginLeft: Math.min(depth * 18, 54) }}>
    <ReviewPresentation item={item} replyCount={replyCount} onReply={onReply} />
    {node.children.map(child => <ThreadReply key={child.item.reviewRef} node={child} depth={depth + 1} onReply={onReply} />)}
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
            <ReviewPresentation item={item} replyCount={replyCount} onReply={onReply} />
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

export function ArkmeExtensionReviews({
  extensionId,
  canCreateTopLevelReview = true,
  initialRatingSummary = emptyRating,
  initialPage,
}: {
  extensionId: string
  canCreateTopLevelReview?: boolean
  initialRatingSummary?: ArkmeExtensionRatingSummary
  initialPage?: ArkmeExtensionReviewPage
}) {
  const [page, setPage] = useState<ArkmeExtensionReviewPage | undefined>(initialPage)
  const [loading, setLoading] = useState(initialPage === undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [composer, setComposer] = useState<ArkmeExtensionReviewComposerState>()
  const [selectedThreadRef, setSelectedThreadRef] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const tree = useMemo(() => extensionReviewTree(page?.items ?? []), [page?.items])
  const selectedThread = useMemo(
    () => tree.find(node => node.item.reviewRef === selectedThreadRef),
    [selectedThreadRef, tree],
  )
  const summary = page?.ratingSummary ?? initialRatingSummary

  const load = async (offset = 0) => {
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const next = await callArkme<ArkmeExtensionReviewPage>('extensions.reviews.list', { extensionId, limit: 20, offset })
      setPage(current => offset === 0 || current === undefined ? next : {
        ...next,
        items: [...current.items, ...next.items.filter(item => !current.items.some(existing => existing.reviewRef === item.reviewRef))],
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => { if (initialPage === undefined) void load() }, [extensionId])
  useEffect(() => {
    if (canCreateTopLevelReview) return
    setComposer(current => current?.parent === undefined ? undefined : current)
  }, [canCreateTopLevelReview])
  useEffect(() => {
    if (composer === undefined) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) setComposer(undefined) }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [composer !== undefined, submitting])
  useEffect(() => {
    if (selectedThreadRef === undefined || composer !== undefined) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedThreadRef(undefined) }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [selectedThreadRef, composer !== undefined])

  const openComposer = (parent?: ArkmeExtensionReviewItem) => {
    try {
      setComposer({ ...(parent === undefined ? {} : { parent }), textContent: '', rating: 0, clientMutationId: newMutationId(), error: '' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const submit = async () => {
    if (composer === undefined || submitting) return
    setSubmitting(true)
    try {
      await callArkme<ArkmeExtensionReviewCreateResult>('extensions.reviews.create', {
        ...extensionReviewCreateParams(extensionId, composer),
      })
      setComposer(undefined)
      await load()
    } catch (caught) {
      setComposer(current => current === undefined ? current : {
        ...current,
        error: caught instanceof Error ? caught.message : String(caught),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return <section style={styles.section} aria-label="扩展评论">
    <div style={styles.headingRow}>
      <h3 style={styles.heading}>用户评价</h3>
      {canCreateTopLevelReview && <button type="button" style={styles.commentButton} onClick={() => { openComposer() }}>评论</button>}
    </div>
    <div style={styles.summary}>
      <span style={styles.average}>{summary.count === 0 ? '—' : summary.average.toFixed(1)}</span>
      <div><Stars value={summary.average} /><div style={styles.count}>{extensionRatingLabel(summary)}</div></div>
    </div>
    {error !== '' && <div style={styles.error} role="alert">{error}</div>}
    {loading && <div style={styles.state}>正在加载评论…</div>}
    {!loading && tree.length === 0 && error === '' && <div style={styles.state}>
      {canCreateTopLevelReview ? '还没有评论，来发表第一条评价吧。' : '还没有用户评价。'}
    </div>}
    {!loading && tree.length > 0 && <div style={styles.list}>
      {tree.map(node => <ReviewNode
        key={node.item.reviewRef}
        node={node}
        onOpen={selected => { setSelectedThreadRef(selected.item.reviewRef) }}
        onReply={openComposer}
      />)}
    </div>}
    {page?.hasMore === true && <button type="button" style={styles.loadMore} disabled={loadingMore} onClick={() => { void load(page.nextOffset ?? page.offset + page.limit) }}>
      {loadingMore ? '加载中…' : '加载更多'}
    </button>}
    {selectedThread !== undefined && <ArkmeExtensionReplyListDialog
      root={selectedThread}
      onClose={() => { setSelectedThreadRef(undefined) }}
      onReply={openComposer}
    />}
    {composer !== undefined && <ArkmeExtensionReviewComposerDialog
      state={composer} submitting={submitting} onChange={setComposer}
      onClose={() => { if (!submitting) setComposer(undefined) }} onSubmit={() => { void submit() }}
    />}
  </section>
}
