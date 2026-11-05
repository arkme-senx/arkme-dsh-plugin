import { WorldPublicationActions } from './WorldPublicationControls.js'
import {WorldSoundPublicationAction} from './WorldSoundPublicationAction.js'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeWorldAuthorLabel, ArkmeWorldFeedItem } from '../types.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeMessageDetailAuthor } from './ArkmeMessageDetailAuthor.js'
import { ArkmeMembershipBadge } from './ArkmeMembershipBadge.js'
import { WorldPublisherAttribution } from './ArkmeWorldSurface.js'
import { WorldTeamBadge } from './WorldTeamBadge.js'
import { callArkme } from './api.js'
import { invalidateWorldImages } from './world-image-cache.js'
import { worldReactionContexts } from './world-reactions.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

/** A public projection only: never open the author's underlying private Record. */
export function ArkmeWorldRecordDetail({ item: seed, onClose, onOpenAuthor, renderContent, renderAvatar }: {
  item: ArkmeWorldFeedItem
  onClose(): void
  onOpenAuthor?(item: ArkmeWorldFeedItem): void
  renderContent(item: ArkmeWorldFeedItem): ReactNode
  renderAvatar(item: ArkmeWorldFeedItem): ReactNode
}) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const owner = useRef(account)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ ref: string; item: ArkmeWorldFeedItem; loading: boolean; error?: string }>({ ref: seed.recordRef, item: seed, loading: true })
  useEffect(() => {
    if (account !== owner.current) return
    let labelsController: AbortController | undefined
    let active: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let currentItem = seed
    let disposed = false
    const revalidate = () => {
      // One current read per open detail, including repeated native focus events.
      if (active || disposed) return
      const controller = new AbortController()
      active = controller
      labelsController?.abort()
      const fail = (message: string) => {
        invalidateWorldImages([...seed.imageRefs, ...currentItem.imageRefs])
        // Reuse the shared authority owner so mounted feed cards also discard
        // withdrawn bodies, comment previews and reaction actors. A transport
        // error alone is not treated as a confirmed revocation.
        worldReactionContexts.retry(account, seed.recordRef)
        setState(current => ({ ...current, loading: false, error: message }))
      }
      timer = setTimeout(() => {
        controller.abort()
        active = undefined
        fail(tr('读取超时，请重试'))
      }, 15_000)
      void callArkme<ArkmeWorldFeedItem>('world.record.read', { recordRef: seed.recordRef }, controller.signal)
        .then(item => {
          if (controller.signal.aborted) return
          // Keep the selected capability and composer mounted while refreshing.
          currentItem = { ...item, recordRef: seed.recordRef, authorName: item.teamAuthor ? item.authorName : seed.authorName }
          setState({ ref: seed.recordRef, item: currentItem, loading: false })
          if (!item.teamAuthor) {
            const labels = new AbortController(); labelsController = labels
            void callArkme<ArkmeWorldAuthorLabel[]>('world.author-labels', { authorRefs: [item.authorRef ?? item.recordRef] }, labels.signal)
              .then(values => {
                const label = values.find(value => value.authorRef === (item.authorRef ?? item.recordRef))
                if (labels.signal.aborted || disposed || !label) return
                setState(current => ({ ...current, item: { ...current.item, authorName: label.authorName, memberType: label.memberType } }))
              }).catch(() => {})
          }
        })
        .catch(error => {
          if (!controller.signal.aborted) fail(error instanceof Error ? error.message : tr('暂时无法读取这条公开内容'))
        })
        .finally(() => {
          if (active === controller) { clearTimeout(timer); active = undefined }
        })
    }
    setState(current => current.ref === seed.recordRef ? { ...current, loading: true } : { ref: seed.recordRef, item: seed, loading: true })
    revalidate()
    window.addEventListener('focus', revalidate)
    window.addEventListener('arkme-reaction-policy-changed', revalidate)
    return () => {
      disposed = true
      window.removeEventListener('focus', revalidate)
      window.removeEventListener('arkme-reaction-policy-changed', revalidate)
      clearTimeout(timer)
      active?.abort()
      labelsController?.abort()
    }
  }, [seed.recordRef, account, attempt])
  useEffect(() => {
    if (seed.memberType === undefined || seed.teamAuthor) return
    setState(current => current.ref === seed.recordRef ? { ...current, item: { ...current.item, memberType: seed.memberType } } : current)
  }, [seed.recordRef, seed.memberType])
  if (account !== owner.current) return null
  const view = state.ref === seed.recordRef ? state : { item: seed, loading: true, error: undefined }
  const item = { ...view.item, memberType: view.item.teamAuthor ? undefined : view.item.memberType }
  const authorAction = (item.authorRef || item.teamAuthor) && onOpenAuthor ? () => onOpenAuthor(item) : undefined
  const authorButton = { padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left' as const, cursor: 'pointer' }
  const avatar = renderAvatar(item)
  return <ArkmeDetailShell title="" label={tr('世界动态详情')} closeLabel={tr('关闭动态详情')} resizeLabel={tr('调整动态详情宽度')}
    style={{ top: 0 }} widthPreferenceKey="arkme:world-detail-width:v1" onClose={onClose}
    headerActions={seed.soundExcerpt?<WorldSoundPublicationAction recordRef={seed.recordRef} onWithdrawn={onClose}/>:<WorldPublicationActions target={{recordRef:seed.recordRef}} onUnpublished={onClose}/>}
    headerContent={<ArkmeMessageDetailAuthor
      avatar={authorAction ? <button type="button" style={authorButton} aria-label={tr('查看{v0}的用户卡片', { v0: item.authorName })} onClick={authorAction}>{avatar}</button> : avatar}
      name={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{authorAction ? <button type="button" style={authorButton} onClick={authorAction}>{item.authorName}</button> : item.authorName}{item.teamAuthor ? <WorldTeamBadge /> : <ArkmeMembershipBadge memberType={item.memberType} />}</span>}
      at={item.publishedAtMillis || item.createdAtMillis}
      timeSuffix={item.teamAuthor && item.publisher?.name ? <WorldPublisherAttribution item={item} /> : undefined} />}
    onPointerDownOutside={event => {
      if (!(event.target instanceof Element)) return
      // Card clicks switch this panel. Portaled menus, previews and author cards
      // keep owning their own interaction, just as in normal message details.
      if (event.target.closest('[data-world-record-ref],[role="dialog"],[role="menu"]')) return
      onClose()
    }}>
    <div style={{ color: c.tertiary, fontSize: 11, marginBottom: 18 }}>{tr('来源：世界')}</div>
    {view.loading && <p role="status" style={{ color: c.tertiary, fontSize: 12 }}>{tr('正在读取最新内容…')}</p>}
    {view.error ? <div role="alert" style={{ color: c.secondary, fontSize: 13, lineHeight: '22px' }}>
      <p>{view.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button>
    </div> : renderContent(item)}
  </ArkmeDetailShell>
}
