import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { TeamWorldContext, TeamWorldFeedback as Feedback, TeamWorldResponse } from '../team-world-contract.js'
import type { ArkmeWorldFeedItem } from '../types.js'
import { callArkme } from './api.js'
import { WorldInteractionPreviewContent, WorldInfiniteScrollTrigger } from './ArkmeWorldSurface.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ReactionLabel } from './ReactionLabel.js'
import { expressionLabel } from './reaction-expression.js'
import { invalidateWorldImages } from './world-image-cache.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr } from './locale.js'

type Page = TeamWorldResponse<{ action: 'feedback'; accountKey: string; teamRef: string }>
export function TeamWorldFeedback({ accountKey, context, onOpen, refreshKey, scrollRootRef }: {
  scrollRootRef?: RefObject<HTMLElement>; accountKey: string; context: TeamWorldContext; onOpen(item: ArkmeWorldFeedItem, commentRef?: string): void; refreshKey: number
}) {
  const [page, setPage] = useState<Page>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const fallbackRoot = useRef<HTMLElement>(null)
  const request = useRef<AbortController>(), rows = useRef<Feedback[]>([]), startSequence = useRef(0)
  const [windowed, setWindowed] = useState(false)
  const load = useCallback(async (afterSequence?: number) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try {
      const append = afterSequence !== undefined
      let position = afterSequence ?? startSequence.current
      const wanted = append ? 0 : rows.current.length
      let next: Page, fresh: Feedback[] = [], reads = 0
      do {
        next = await callArkme<Page>('team.world', { action: 'feedback', accountKey, teamRef: context.teamRef, afterSequence: position, limit: 20, includeRead: true }, controller.signal)
        if (controller.signal.aborted) return
        if (next.hasMore && next.afterSequence <= position) throw Error(tr('反馈分页未推进，请重试'))
        reads++; fresh.push(...next.items); position = next.afterSequence
      } while (next.hasMore && fresh.length < wanted && reads < 5)
      const combined = [...new Map([...(append ? rows.current : []), ...fresh].map(item => [item.sequence, item])).values()]
      if (combined.length > 100) { startSequence.current = combined[combined.length - 101]!.sequence; setWindowed(true) }
      const currentPublications = new Map(fresh.map(item => [item.contentKey ?? item.contentRef, item.publication]))
      rows.current = combined.slice(-100).map(item => {
        const key = item.contentKey ?? item.contentRef
        if (!currentPublications.has(key)) return item
        const publication = currentPublications.get(key)
        if (publication) return { ...item, publication }
        invalidateWorldImages([...(item.publication?.imageRefs ?? []), ...(item.comment?.imageRefs ?? [])])
        const { publication: _publication, comment: _comment, ...fact } = item
        return fact
      })
      setPage({ ...next, items: rows.current })
    } catch (error) {
      if (!controller.signal.aborted) {
        invalidateWorldImages(rows.current.flatMap(item => [...(item.publication?.imageRefs ?? []), ...(item.comment?.imageRefs ?? [])]))
        rows.current = []; setPage(undefined); setError(error instanceof Error ? error.message : tr('共同反馈读取失败'))
      }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }, [accountKey, context.teamRef])
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('focus', refresh); window.addEventListener('arkme-reaction-policy-changed', refresh); return () => { request.current?.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('arkme-reaction-policy-changed', refresh) } }, [load, refreshKey])
  // The server remembers older deliveries too; acknowledge only this displayed window.
  const readThrough = page ? Math.min(page.afterSequence, page.offeredThrough) : 0
  const markRead = async () => {
    if (!page || busy || readThrough <= page.seenThrough) return
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      await callArkme('team.world', { action: 'feedback-read', accountKey, teamRef: context.teamRef, throughSequence: readThrough }, controller.signal)
      if (!controller.signal.aborted) setPage(current => current && ({ ...current, seenThrough: readThrough }))
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('标记失败')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const groups = new Map<string, Feedback[]>()
  for (const item of page?.items ?? []) { const key = item.contentKey ?? item.contentRef; groups.set(key, [...(groups.get(key) ?? []), item]) }
  return <section aria-label={tr('共同反馈')}>
    {windowed && <p style={{ color: c.secondary, fontSize: 12 }}>{tr('当前显示最近加载的 100 条反馈')} <button type="button" style={actionStyle} onClick={() => { startSequence.current = 0; rows.current = []; setWindowed(false); void load() }}>{tr('返回最早反馈')}</button></p>}
    {error && <p role="alert">{error} <button type="button" style={actionStyle} onClick={() => void load()}>{tr('重试')}</button></p>}
    {[...groups.entries()].map(([key, items]) => {
      const first = items[0]!, publication = first.publication
      const title = publication?.headline.trim() || publication?.textContent.trim() || first.preview.title.trim() || tr('无标题快记')
      return <article key={key} data-team-feedback-group style={{ padding: '16px 0', borderBottom: `1px solid ${c.borderSoft}` }}>
        <button type="button" disabled={!publication} onClick={() => publication && onOpen(publication)} aria-label={tr('查看快记：{v0}', { v0: title })}
          style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 8, padding: '10px 12px', background: c.subtle, color: c.text, font: 'inherit', cursor: publication ? 'pointer' : 'default' }}>
          <span style={{ display: 'block', marginBottom: 4, fontSize: 11, color: c.secondary }}>{tr('快记')}{!publication && ` · ${tr(first.preview.deleted ? '已删除' : '当前未公开')}`}</span>
          <strong style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 13, fontWeight: 500 }}><ArkmeRichText text={title} presentation="preview" /></strong>
        </button>
        <div style={{ padding: '0 12px' }}>
          {items.map(item => {
            const actor = item.isMe ? tr('我') : item.actorName || tr('用户')
            const action = tr(item.kind === 'comment' ? '评论了这条快记' : !item.reaction ? '的表态当前不可访问' : item.reaction.active ? '添加了表态' : '取消了表态')
            return <div key={item.sequence} style={{ padding: '12px 0', borderBottom: `1px solid ${c.borderSoft}` }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                {item.comment && publication
                  ? <button type="button" style={{ ...actionStyle, padding: 0, textAlign: 'left', color: c.text, fontSize: 13 }} onClick={() => onOpen(publication, item.comment!.recordRef)}><strong>{actor}</strong> {action}</button>
                  : <span><strong>{actor}</strong> {action}</span>}
                {item.reaction && <ReactionLabel label={expressionLabel(item.reaction.expression)} />}
                {!item.isMe && item.sequence > (page?.seenThrough ?? 0) && <small style={{ color: c.accent }}>{tr('未读')}</small>}
              </div>
              <time style={{ display: 'block', color: c.secondary, fontSize: 11, marginTop: 4 }}>{new Date(item.at).toLocaleString()}</time>
              {item.comment && publication && <WorldInteractionPreviewContent item={publication} previewImages
                items={[{ ...item.comment, interactionRef: item.comment.recordRef, parentRef: publication.recordRef, isSelf: item.isMe }]}
                onOpen={() => onOpen(publication, item.comment!.recordRef)} />}
              {item.kind === 'comment' && !item.comment && <p style={{ margin: '8px 0 0', color: c.secondary, fontSize: 12 }}>{tr('评论当前不可访问')}</p>}
            </div>
          })}
        </div>
      </article>
    })}
    {busy && <p role="status">{tr('加载中…')}</p>}
    {!busy && !error && !page?.items.length && <p style={{ color: c.secondary }}>{tr('暂无共同反馈')}</p>}
    {page?.hasMore && !error && <WorldInfiniteScrollTrigger scrollRootRef={scrollRootRef ?? fallbackRoot} loading={busy} error={false} onLoadMore={() => void load(page.afterSequence)} />}
    {page && readThrough > page.seenThrough && <button type="button" style={actionStyle} disabled={busy} onClick={() => void markRead()}>{tr('标记已读')}</button>}
  </section>
}

const actionStyle = { padding: '6px 8px', border: 0, borderRadius: 6, background: 'transparent', color: c.secondary, cursor: 'pointer', font: 'inherit', fontSize: 12 }
