import { WorldInfiniteScrollTrigger } from './ArkmeWorldSurface.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TeamWorldActivity as Activity, TeamWorldContext } from '../team-world-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { TeamWorldImages } from './TeamWorldImages.js'
import { invalidateWorldImages } from './world-image-cache.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr } from './locale.js'
const actions = { publish: '发布了快记', edit: '修改了快记', unpublish: '取消了公开', delete: '删除了快记', restore: '恢复了快记' }
export function TeamWorldActivity({ team, onClose }: { team?: TeamWorldContext | undefined; onClose(): void }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const body = useRef<HTMLDivElement>(null)
  return <ArkmeDetailShell style={{ top: 0 }} bodyRef={body} title={tr('我的团队操作')} label={tr('我的团队操作')} onClose={onClose}><ActivityList scrollRootRef={body} key={`${accountKey}:${team?.jotmoId ?? ''}`} accountKey={accountKey} team={team} /></ArkmeDetailShell>
}
function ActivityList({ accountKey, team, scrollRootRef }: { scrollRootRef: { readonly current: HTMLDivElement | null }; accountKey: string; team?: TeamWorldContext | undefined }) {
  const [items, setItems] = useState<Activity[]>([]), [cursor, setCursor] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>(), rows = useRef<Activity[]>([])
  const pages = useRef<{ cursor?: string; items: Activity[] }[]>([])
  const loading = useRef(false), anchor = useRef<{ id: string; top: number }>()
  useLayoutEffect(() => {
    if (!anchor.current || !scrollRootRef.current) return
    const row = [...scrollRootRef.current.querySelectorAll<HTMLElement>('[data-team-page-row]')].find(el => el.dataset.teamPageRow === anchor.current!.id)
    if (row) scrollRootRef.current.scrollTop += row.getBoundingClientRect().top - anchor.current.top
    anchor.current = undefined
  }, [items, scrollRootRef])
  const load = useCallback(async (next?: string) => {
    if (next && loading.current) return
    request.current?.abort(); const controller = new AbortController(); request.current = controller; loading.current = true; setBusy(true); setError('')
    try {
      const fresh: typeof pages.current = []
      let position = next ?? pages.current[0]?.cursor
      const count = next ? 1 : Math.max(1, pages.current.length)
      let nextCursor: string | undefined
      for (let index = 0; index < count; index++) {
        const page = await callArkme<{ items: Activity[]; hasMore: boolean; nextCursor?: string }>('team.world', { accountKey, action: 'activity', ...(team ? { teamRef: team.teamRef } : {}), limit: 20, ...(position ? { cursor: position } : {}) }, controller.signal)
        if (controller.signal.aborted) return
        if (page.hasMore && (!page.nextCursor || page.nextCursor === position)) throw Error(tr('操作记录分页未推进'))
        fresh.push({ ...(position ? { cursor: position } : {}), items: page.items })
        nextCursor = page.hasMore ? page.nextCursor : undefined; position = nextCursor
        if (!nextCursor) break
      }
      const combined = [...(next ? pages.current : []), ...fresh]
      if (combined.length > 5 && scrollRootRef.current) {
        const item = combined[combined.length - 5]!.items[0]
        const id = item && item.requestUid
        const row = [...scrollRootRef.current.querySelectorAll<HTMLElement>('[data-team-page-row]')].find(el => el.dataset.teamPageRow === id)
        if (row && id) anchor.current = { id, top: row.getBoundingClientRect().top }
      }
      pages.current = combined.slice(-5)
      rows.current = [...new Map(pages.current.flatMap(page => page.items).map(item => [item.requestUid, item])).values()]
      setItems(rows.current); setCursor(nextCursor)
    } catch (error) {
      if (!controller.signal.aborted) {
        invalidateWorldImages(rows.current.flatMap(item => item.preview?.imageRefs ?? [])); rows.current = []; setItems([])
        setError(error instanceof Error ? error.message : tr('读取失败'))
      }
    } finally { if (!controller.signal.aborted) { loading.current = false; setBusy(false) } }
  }, [accountKey, team?.teamRef])
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('focus', refresh); return () => { request.current?.abort(); window.removeEventListener('focus', refresh) } }, [load])
  return <section>
    {error && <p role="alert">{error} <button type="button" style={actionStyle} onClick={() => void load()}>{tr('重试')}</button></p>}
    {items.map(item => <article key={item.requestUid} data-team-page-row={item.requestUid} style={{ padding: '16px 0', borderBottom: `1px solid ${c.borderSoft}` }}>
      <strong>{!team && <>{item.preview?.teamName ?? tr('团队')} · </>}{tr(actions[item.action])}</strong>
      <time style={{ display: 'block', color: c.secondary, fontSize: 11, marginTop: 6 }}>{new Date(item.acceptedAt).toLocaleString()}</time>
      {item.preview ? <><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{[item.preview.title, item.preview.text].filter(Boolean).join('\n')}</p><TeamWorldImages imageRefs={item.preview.imageRefs ?? []} /></> : <p style={{ color: c.secondary }}>{tr('当前内容不可查看')}</p>}
    </article>)}
    {busy && <p role="status">{tr('加载中…')}</p>}
    {!busy && !error && !items.length && <p>{tr('暂无操作记录')}</p>}
    {pages.current[0]?.cursor && <button type="button" style={actionStyle} disabled={busy} onClick={() => { pages.current = []; if (scrollRootRef.current) scrollRootRef.current.scrollTop = 0; void load() }}>{tr('返回最新记录')}</button>}
    {cursor && !error && <WorldInfiniteScrollTrigger scrollRootRef={scrollRootRef} loading={busy} error={false} onLoadMore={() => { if (!busy) void load(cursor) }} />}
  </section>
}

const actionStyle = { padding: '6px 8px', border: 0, borderRadius: 6, background: 'transparent', color: c.secondary, cursor: 'pointer', font: 'inherit', fontSize: 12 }
