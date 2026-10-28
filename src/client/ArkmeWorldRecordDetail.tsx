import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeWorldFeedItem } from '../types.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeMessageDetailAuthor } from './ArkmeMessageDetailAuthor.js'
import { ArkmeMembershipBadge } from './ArkmeMembershipBadge.js'
import { callArkme } from './api.js'
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
    const controller = new AbortController()
    setState({ ref: seed.recordRef, item: seed, loading: true })
    const timeout = setTimeout(() => {
      controller.abort()
      setState(current => ({ ...current, loading: false, error: tr('读取超时，请重试') }))
    }, 15_000)
    void callArkme<ArkmeWorldFeedItem>('world.record.read', { recordRef: seed.recordRef }, controller.signal)
      .then(item => {
        if (controller.signal.aborted) return
        // Keep the selected capability and viewer's contact remark. Renewed media
        // refs must not remount the comment composer and discard its draft.
        setState({ ref: seed.recordRef, item: { ...item, recordRef: seed.recordRef, authorName: seed.authorName }, loading: false })
      })
      .catch(error => {
        if (!controller.signal.aborted) setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : tr('暂时无法读取这条公开内容') }))
      })
      .finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort() }
  }, [seed.recordRef, account, attempt])
  if (account !== owner.current) return null
  const view = state.ref === seed.recordRef ? state : { item: seed, loading: true, error: undefined }
  const item = { ...view.item, authorName: seed.authorName, memberType: seed.memberType ?? view.item.memberType }
  const authorAction = item.authorRef && onOpenAuthor ? () => onOpenAuthor(item) : undefined
  const authorButton = { padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left' as const, cursor: 'pointer' }
  const avatar = renderAvatar(item)
  return <ArkmeDetailShell title="" label={tr('世界动态详情')} closeLabel={tr('关闭动态详情')} resizeLabel={tr('调整动态详情宽度')}
    style={{ top: 0 }} widthPreferenceKey="arkme:world-detail-width:v1" onClose={onClose}
    headerContent={<ArkmeMessageDetailAuthor
      avatar={authorAction ? <button type="button" style={authorButton} aria-label={tr('查看{v0}的用户卡片', { v0: item.authorName })} onClick={authorAction}>{avatar}</button> : avatar}
      name={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{authorAction ? <button type="button" style={authorButton} onClick={authorAction}>{item.authorName}</button> : item.authorName}<ArkmeMembershipBadge memberType={item.memberType} /></span>}
      at={item.publishedAtMillis || item.createdAtMillis} />}
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
