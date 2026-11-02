import { useEffect, useRef, useState, type RefObject } from 'react'
import type { TeamWorldOriginal, TeamWorldFeedback } from '../team-world-contract.js'
import type { ArkmeWorldFeedItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeWorldRecordDetailView } from './ArkmeWorldRecordDetail.js'
import { WorldCard, WorldAuthorAvatar } from './ArkmeWorldSurface.js'
import { WorldPreviewImages } from './WorldPreviewImages.js'
import { invalidateWorldImages } from './world-image-cache.js'
import { tr } from './locale.js'

/** Resolve the authorized original, then read its public World projection.
 * Private drafts never become public cards or reply targets. The parent owns
 * focus revalidation and passes the current source projection after each page read.
 */
export function TeamWorldOriginalDetail({ accountKey, source, returnFocusRef, onClose, onUnavailable, onUpdated, onOpenAuthor }: {
  accountKey: string; source: TeamWorldFeedback; returnFocusRef: RefObject<HTMLElement>
  onClose(): void; onUnavailable(message: string): void; onUpdated(): void
  onOpenAuthor(item: ArkmeWorldFeedItem): void
}) {
  const [state, setState] = useState<{ original?: TeamWorldOriginal; item?: ArkmeWorldFeedItem; message?: string; loading: boolean }>({ loading: true })
  const [attempt, retry] = useState(0)
  const unavailable = useRef(onUnavailable), images = useRef<readonly string[]>([])
  unavailable.current = onUnavailable
  useEffect(() => () => invalidateWorldImages(images.current), [])
  useEffect(() => {
    const controller = new AbortController()
    setState(current => ({ ...current, loading: true }))
    void (async () => {
      let original: TeamWorldOriginal
      try {
        original = await callArkme<TeamWorldOriginal>('team.world', { action: 'original', accountKey, contentRef: source.contentRef }, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) {
          invalidateWorldImages(images.current)
          unavailable.current(error instanceof Error ? error.message : tr('当前没有查看团队快记的权限'))
        }
        return
      }
      if (controller.signal.aborted) return
      let item: ArkmeWorldFeedItem | undefined, message: string | undefined
      if (original.publicRequested && !original.deleted) {
        try { item = await callArkme<ArkmeWorldFeedItem>('world.record.read', { recordRef: original.recordRef }, controller.signal) }
        catch (error) { message = error instanceof Error ? error.message : tr('暂时无法读取公开快记，请重试') }
      }
      if (controller.signal.aborted) return
      if (!item) invalidateWorldImages(images.current)
      images.current = [...original.assets.map(asset => asset.imageRef), ...(item?.imageRefs ?? [])]
      setState(current => ({ original, loading: false,
        ...(item ? { item: { ...item, recordRef: current.item?.recordRef ?? item.recordRef } } : {}),
        ...(message ? { message } : {}),
      }))
    })()
    return () => controller.abort()
  }, [accountKey, source, attempt])
  if (state.item) return <ArkmeWorldRecordDetailView item={state.item} onClose={onClose} returnFocusRef={returnFocusRef}
    renderAvatar={item => <WorldAuthorAvatar item={item} />} onOpenAuthor={onOpenAuthor}>
    <WorldCard item={state.item} commentsRefreshKey={state.item} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen detail
      onOpenInteractions={() => {}} onInteractionCreated={onUpdated} onToggleVoiceprint={() => {}} onOpenAuthor={onOpenAuthor} />
  </ArkmeWorldRecordDetailView>
  return <ArkmeDetailShell title={tr('团队快记')} label={tr('团队快记详情')} closeLabel={tr('关闭快记详情')}
    style={{ top: 0 }} returnFocusRef={returnFocusRef} onClose={onClose}>
    {state.loading ? <p role="status">{tr('正在读取最新内容…')}</p> : state.original && <>
      <h3 className="wm-title">{state.original.title}</h3><p className="wm-card-body">{state.original.text}</p>
      <WorldPreviewImages imageRefs={state.original.assets.map(asset => asset.imageRef)} detail />
      <p className="wm-notice">{state.message || tr('这条快记已删除或尚未公开，公开评论暂不可访问。')}</p>
      {state.message && <button type="button" className="wm-button" onClick={() => retry(value => value + 1)}>{tr('重试')}</button>}
    </>}
  </ArkmeDetailShell>
}
