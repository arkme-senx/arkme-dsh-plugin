import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ArkmeCommonGroupPage } from '../common-groups.js'
import type { ArkmeSourceItem } from '../types.js'
import { ArkmeDirectoryWindow } from './ArkmeDirectoryWindow.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeDirectorySourceAvatar } from './ArkmeAvatar.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

export function ArkmeCommonGroupsPanel({ source, onClose, onOpen, returnFocusRef }: {
  source: ArkmeSourceItem; onClose(): void; onOpen(source: ArkmeSourceItem): void; returnFocusRef: RefObject<HTMLButtonElement>
}) {
  useArkmeLocale()
  const [page, setPage] = useState<ArkmeCommonGroupPage>()
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(true)
  const [paging, setPaging] = useState(false)
  const [pagingFailed, setPagingFailed] = useState(false)
  const pendingRead = useRef<Promise<void>>()
  const currentPage = useRef<ArkmeCommonGroupPage>()
  const sentinel = useRef<HTMLDivElement>(null)
  const [opening, setOpening] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const lifetime = useRef<AbortController>()
  const body = useRef<HTMLDivElement>(null)
  const read = useCallback((signal: AbortSignal, append = false): Promise<void> => {
    if (pendingRead.current) return pendingRead.current
    const previous = currentPage.current
    const work = (async () => {
      setPaging(true)
      const items = append ? [...previous?.items ?? []] : []
      let cursor = append ? previous?.nextCursor : undefined
      const targetCount = append ? items.length + 20 : Math.max(20, previous?.items.length ?? 0)
      let result: ArkmeCommonGroupPage
      do {
        result = await callArkme<ArkmeCommonGroupPage>('group.common.list', { sourceRef: source.sourceRef,
          ...(cursor ? { cursor } : {}) }, signal)
        if (signal.aborted) return
        items.push(...result.items)
        if (result.hasMore && (!result.items.length || !result.nextCursor || result.nextCursor === cursor)) throw new Error(tr('共同群聊读取失败'))
        cursor = result.nextCursor
      } while (result.hasMore && items.length < targetCount)
      // Rebuild the loaded prefix after reconciliation so removed groups disappear.
      const next = { ...result, items: [...new Map(items.map(item => [item.source.sourceKey ?? item.source.sourceRef, item])).values()] }
      currentPage.current = next
      setPage(next)
    })().finally(() => {
      pendingRead.current = undefined
      if (!signal.aborted) setPaging(false)
    })
    pendingRead.current = work
    return work
  }, [source.sourceRef])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    setSyncing(true); setError(''); setPagingFailed(false)
    void (async () => {
      await pendingRead.current?.catch(() => {})
      if (controller.signal.aborted) return
      await read(controller.signal)
      if (controller.signal.aborted) return
      // Twenty rows per response; this finite traversal can be canceled and resumes
      // from the checkpoint committed with the last SQLite batch.
      for (let batch = 0; batch < 2002; batch++) {
        const result = await callArkme<ArkmeCommonGroupPage>('group.common.sync', { sourceRef: source.sourceRef }, controller.signal)
        if (batch === 0 || !result.syncHasMore) {
          await pendingRead.current
          if (controller.signal.aborted) return
          await read(controller.signal)
        }
        if (!result.syncHasMore) return
      }
      throw new Error(tr('同步尚未完成，请继续同步'))
    })().catch(() => { if (!controller.signal.aborted) setError(tr('暂时无法读取共同群聊，请重试')) })
      .finally(() => { if (!controller.signal.aborted) setSyncing(false) })
    return () => controller.abort()
  }, [source.sourceRef, read, refresh])

  const loadMore = useCallback(() => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || pendingRead.current || !currentPage.current?.hasMore) return
    void read(signal, true).catch(() => {
      if (!signal.aborted) { setPagingFailed(true); setError(tr('暂时无法读取共同群聊，请重试')) }
    })
  }, [read])
  useEffect(() => {
    if (paging || pagingFailed || !page?.hasMore || !sentinel.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore()
    }, { root: body.current, rootMargin: '120px 0px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [paging, pagingFailed, page, loadMore])
  const open = async (item: ArkmeSourceItem) => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || opening) return
    setOpening(true); setError('')
    try {
      // A cached source reference does not prove current membership.
      await callArkme('group.settings', { sourceRef: item.sourceRef }, signal)
      const target = await callArkme<ArkmeSourceItem>('directory.group.open-chat', { sourceRef: item.sourceRef }, signal)
      if (!signal.aborted) onOpen(target)
    } catch { if (!signal.aborted) setError(tr('暂时无法打开群聊，请重试')) }
    finally { if (!signal.aborted) setOpening(false) }
  }
  return <ArkmeDetailShell title={tr('共同群聊')} label={tr('共同群聊')}
    onClose={onClose} returnFocusRef={returnFocusRef} bodyRef={body} resizeLabel={tr('调整共同群聊宽度')}>
    {error && <p role="alert" style={{ color: arkmeTheme.tertiary }}>{error}
      <button type="button" data-arkme-feedback="neutral" disabled={syncing || paging} onClick={() => setRefresh(n => n + 1)}>{tr('重试')}</button>
    </p>}
    {page !== undefined && <>
      {page.items.length === 0 && !syncing && !error && <p>{tr('暂无共同群聊')}</p>}
      <ArkmeDirectoryWindow>
      {page.items.map(item => <button key={item.source.sourceKey ?? item.source.sourceRef} type="button" data-arkme-feedback="neutral" disabled={opening}
        onClick={() => { void open(item.source) }} style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', padding: '14px 0', border: 0,
          borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, textAlign: 'left', font: 'inherit' }}>
        <ArkmeDirectorySourceAvatar source={item.source} size={36} />
        <span style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{item.source.displayName}</span>
        <span aria-hidden>›</span>
      </button>)}
      </ArkmeDirectoryWindow>
    </>}
    <div ref={sentinel} data-arkme-common-groups-more style={{ minHeight: 1 }}>
      {(paging || (syncing && !page?.items.length)) && !error && <p role="status" style={{ color: arkmeTheme.tertiary }}>{tr('正在获取共同群聊…')}</p>}
    </div>
  </ArkmeDetailShell>
}
