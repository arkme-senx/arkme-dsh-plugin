import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeExtensionRatingSummary,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewPage,
} from '../extensions/types.js'
import { callArkme } from './api.js'

const accent = '#09B83E'
const emptyRating: ArkmeExtensionRatingSummary = { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] }

const styles: Record<string, CSSProperties> = {
  section: { padding: '14px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { margin: 0, fontSize: 13, lineHeight: '20px', fontWeight: 650, color: 'var(--dsw-alias-label-primary, #242629)' },
  commentButton: { height: 30, padding: '0 13px', border: 0, borderRadius: 8, background: 'rgba(9,184,62,.10)', color: accent, font: 'inherit', fontSize: 11, fontWeight: 650, cursor: 'pointer' },
  summary: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  average: { fontSize: 22, lineHeight: '28px', fontWeight: 700, color: 'var(--dsw-alias-label-primary, #242629)' },
  stars: { display: 'inline-flex', gap: 2, color: '#f3aa18', letterSpacing: 0, fontSize: 14 },
  count: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 10 },
  list: { marginTop: 10 },
  review: { padding: '11px 0', borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)' },
  reply: { marginLeft: 24, paddingLeft: 10, borderLeft: '2px solid rgba(9,184,62,.12)' },
  authorRow: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 },
  avatar: { width: 24, height: 24, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, background: 'var(--dsw-alias-fill-secondary, #f4f5f6)', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 10, fontWeight: 650 },
  author: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary, #242629)', fontSize: 11, fontWeight: 600 },
  time: { marginLeft: 'auto', color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 9 },
  content: { margin: '6px 0 0 31px', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  itemActions: { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 0 31px' },
  replyButton: { padding: 0, border: 0, background: 'transparent', color: accent, font: 'inherit', fontSize: 10, cursor: 'pointer' },
  state: { padding: '18px 0 10px', color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 11, textAlign: 'center' },
  error: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(194,65,59,.08)', color: 'var(--dsw-alias-state-error-primary, #c2413b)', fontSize: 11 },
  loadMore: { width: '100%', height: 30, marginTop: 6, border: 0, borderRadius: 8, background: 'var(--dsw-alias-fill-secondary, #f4f5f6)', color: 'var(--dsw-alias-label-secondary, #717780)', font: 'inherit', fontSize: 10, cursor: 'pointer' },
  overlay: { position: 'fixed', zIndex: 120, inset: 0, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(17,24,39,.28)' },
  composer: { width: 'min(480px, calc(100vw - 48px))', padding: 18, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 14, background: 'var(--dsw-specific-sidebar-fill, #fff)', boxShadow: '0 18px 50px rgba(20,24,31,.22)' },
  composerTitle: { margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 650, color: 'var(--dsw-alias-label-primary, #242629)' },
  composerHint: { marginTop: 4, color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 10, lineHeight: '16px' },
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

function authorInitial(name: string): string {
  return [...name.trim()].slice(0, 2).join('') || 'A'
}

function ReviewNode({ node, depth, onReply }: {
  node: ArkmeExtensionReviewTreeNode
  depth: number
  onReply(item: ArkmeExtensionReviewItem): void
}) {
  const item = node.item
  return <div style={{ ...styles.review, ...(depth > 0 ? styles.reply : {}) }}>
    <div style={styles.authorRow}>
      <span style={styles.avatar} aria-hidden>{authorInitial(item.authorName)}</span>
      <span style={styles.author}>{item.authorName}{item.authorArkmeId ? ` · @${item.authorArkmeId}` : ''}</span>
      {item.rating > 0 && <Stars value={item.rating} size={11} />}
      <time style={styles.time}>{reviewTime(item.createdAtMillis)}</time>
    </div>
    <p style={styles.content}>{item.textContent}</p>
    <div style={styles.itemActions}>
      <button type="button" style={styles.replyButton} onClick={() => { onReply(item) }}>回复</button>
    </div>
    {node.children.map(child => <ReviewNode key={child.item.reviewRef} node={child} depth={depth + 1} onReply={onReply} />)}
  </div>
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
  initialRatingSummary = emptyRating,
  initialPage,
}: {
  extensionId: string
  initialRatingSummary?: ArkmeExtensionRatingSummary
  initialPage?: ArkmeExtensionReviewPage
}) {
  const [page, setPage] = useState<ArkmeExtensionReviewPage | undefined>(initialPage)
  const [loading, setLoading] = useState(initialPage === undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [composer, setComposer] = useState<ArkmeExtensionReviewComposerState>()
  const [submitting, setSubmitting] = useState(false)
  const tree = useMemo(() => extensionReviewTree(page?.items ?? []), [page?.items])
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
    if (composer === undefined) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) setComposer(undefined) }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [composer !== undefined, submitting])

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
      <button type="button" style={styles.commentButton} onClick={() => { openComposer() }}>评论</button>
    </div>
    <div style={styles.summary}>
      <span style={styles.average}>{summary.count === 0 ? '—' : summary.average.toFixed(1)}</span>
      <div><Stars value={summary.average} /><div style={styles.count}>{extensionRatingLabel(summary)}</div></div>
    </div>
    {error !== '' && <div style={styles.error} role="alert">{error}</div>}
    {loading && <div style={styles.state}>正在加载评论…</div>}
    {!loading && tree.length === 0 && error === '' && <div style={styles.state}>还没有评论，来发表第一条评价吧。</div>}
    {!loading && tree.length > 0 && <div style={styles.list}>
      {tree.map(node => <ReviewNode key={node.item.reviewRef} node={node} depth={0} onReply={openComposer} />)}
    </div>}
    {page?.hasMore === true && <button type="button" style={styles.loadMore} disabled={loadingMore} onClick={() => { void load(page.nextOffset ?? page.offset + page.limit) }}>
      {loadingMore ? '加载中…' : '加载更多'}
    </button>}
    {composer !== undefined && <ArkmeExtensionReviewComposerDialog
      state={composer} submitting={submitting} onChange={setComposer}
      onClose={() => { if (!submitting) setComposer(undefined) }} onSubmit={() => { void submit() }}
    />}
  </section>
}
