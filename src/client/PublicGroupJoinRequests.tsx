import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicJoinRequest, PublicJoinRequestPage } from '../public-social-contract.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { publicSocialStyles as s } from './public-social-styles.js'

export function PublicGroupJoinRequests({ accountScope, sourceRef, disabled, onBusyChange }: { accountScope: string; sourceRef: string; disabled: boolean; onBusyChange(busy: boolean): void }) {
  const [items, setItems] = useState<PublicJoinRequest[]>([]), [cursor, setCursor] = useState<string>(), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const read = useRef<AbortController>(), write = useRef<AbortController>()
  const load = useCallback((next?: string) => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller; setLoading(true); setError('')
    void callArkme<PublicJoinRequestPage>('social.groups.requests', { accountScope, sourceRef, ...(next ? { cursor: next } : {}) }, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setItems(old => next ? [...old, ...page.items.filter(row => !old.some(item => item.requestRef === row.requestRef))] : page.items); setCursor(page.nextCursor)
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : tr('读取失败，请重试')) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
  }, [accountScope, sourceRef])
  useEffect(() => { setItems([]); setCursor(undefined); setNotice(''); load(); return () => { read.current?.abort(); write.current?.abort() } }, [load])
  const resolve = (request: PublicJoinRequest, approved: boolean) => {
    if (write.current || disabled || loading) return
    const controller = new AbortController(); write.current = controller; setBusy(true); onBusyChange(true); setError(''); setNotice('')
    void callArkme('social.groups.requests.resolve', { accountScope, sourceRef, requestRef: request.requestRef, approved }, controller.signal).then(() => {
      if (controller.signal.aborted) return
      setItems(old => old.filter(item => item.requestRef !== request.requestRef)); setNotice(tr(approved ? '已同意入群申请' : '已拒绝入群申请'))
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : tr('操作失败，请重试')) }).finally(() => { if (write.current === controller) { write.current = undefined; if (!controller.signal.aborted) { setBusy(false); onBusyChange(false) } } })
  }
  return <section aria-label={tr('入群申请')} style={{ marginTop: 16 }}>
    <header style={s.header}><h3 style={s.name}>{tr('入群申请')}</h3><button type="button" style={s.button} disabled={disabled || loading || busy} onClick={() => load()}>{tr('刷新申请')}</button></header>
    {error && <p role="alert" style={s.error}>{error}</p>}{notice && <p role="status" style={s.secondary}>{notice}</p>}
    {loading && <p role="status" style={s.secondary}>{tr('正在读取入群申请…')}</p>}
    {!loading && !error && items.length === 0 && <p style={s.secondary}>{tr('暂无待处理的入群申请')}</p>}
    {items.map(request => <article key={request.requestRef} style={s.row}><span style={s.identity}>{request.displayName || tr('即我用户')}</span><button type="button" style={s.button} disabled={disabled || busy || loading} onClick={() => resolve(request, true)}>{tr('同意')}</button><button type="button" style={s.button} disabled={disabled || busy || loading} onClick={() => resolve(request, false)}>{tr('拒绝')}</button></article>)}
    {cursor && <button type="button" style={s.button} disabled={disabled || loading || busy} onClick={() => load(cursor)}>{tr('加载更多申请')}</button>}
  </section>
}
