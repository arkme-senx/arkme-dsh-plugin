import { useEffect, useRef, useState } from 'react'
import { ArkmeClientError, type ArkmeSdk } from '../sdk/index.js'
import type { ArkmeExtensionPublishPage, ArkmeExtensionPublishResult } from '../extensions/types.js'

const stateLabels: Record<string, string> = { uploading: '等待上传', running: '执行中', failed: '发布失败', interrupted: '发布已中断', published: '已发布', rejected: '校验未通过', audit_rejected: '审核未通过', revoked: '已撤销', expired: '已过期', unknown: '结果待查询', validating: '待查询执行结果' }

export function ArkmeExtensionPublishHistory({ sdk, onPublished }: { sdk: ArkmeSdk; onPublished(): void }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<ArkmeExtensionPublishPage>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController>()
  useEffect(() => () => { active.current?.abort() }, [])
  const load = async (offset = 0) => {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setBusy(true); setError('')
    try { const result = await sdk.extensionPublishSessions({ limit: 10, offset, signal: controller.signal }); if (!controller.signal.aborted) setPage(result) }
    catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const resume = async (item: ArkmeExtensionPublishResult) => {
    if (busy || item.publish_session_id === undefined || !item.can_resume) return
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setBusy(true); setError('')
    try {
      const result = await sdk.resumeExtensionPublish(item.publish_session_id, controller.signal)
      if (controller.signal.aborted) return
      setPage(current => current === undefined ? current : { ...current, items: current.items.map(entry => entry.publish_session_id === result.publish_session_id ? result : entry) })
      if (result.status === 'published') onPublished()
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : String(caught))
      const receipt = caught instanceof ArkmeClientError ? caught.body.publishReceipt : undefined
      if (receipt !== undefined) setPage(current => current === undefined ? current : { ...current, items: current.items.map(entry => entry.publish_session_id === receipt.publish_session_id ? receipt : entry) })
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <section style={{ gridColumn: '1 / -1', padding: 12, border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 10 }} aria-label="发布记录">
    <button type="button" aria-expanded={open} onClick={() => { if (!open) { setOpen(true); void load() } else { active.current?.abort(); setBusy(false); setOpen(false) } }}>发布记录</button>
    {open && <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <div>查看未完成的发布并恢复原会话。刷新状态不会启动审核。</div>
      <button type="button" disabled={busy} onClick={() => { void load(page?.offset ?? 0) }}>{busy ? '处理中…' : '刷新状态'}</button>
      {error !== '' && <div role="alert">{error}</div>}
      {page?.items.map(item => <article key={item.publish_session_id} style={{ borderTop: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', paddingTop: 10 }}>
        <b>{item.extension_id} · {item.version}</b>
        <div role="status">{stateLabels[item.execution_state ?? item.status] ?? '结果待查询'}{item.phase === 'audit' ? ' · 审核阶段' : ''}</div>
        {(item.error_message || item.validation_error_message) && <div>{item.error_message || item.validation_error_message}</div>}
        <small style={{ display: 'block', overflowWrap: 'anywhere' }}>发布编号：{item.publish_session_id}</small>
        {item.error_code && <small style={{ display: 'block' }}>错误：{item.error_code}</small>}
        {item.can_resume && item.recovery_expires_at !== undefined && <div>恢复截止：{new Date(item.recovery_expires_at).toLocaleString()}</div>}
        {(item.retry_after_millis ?? 0) > 0 && <div>请在约 {Math.ceil((item.retry_after_millis ?? 0) / 1000)} 秒后刷新状态。</div>}
        {item.can_resume && <button type="button" disabled={busy} onClick={() => { void resume(item) }}>恢复发布</button>}
      </article>)}
      {page?.items.length === 0 && <div>暂无发布记录</div>}
      {page !== undefined && <div>
        <button type="button" disabled={busy || page.offset === 0} onClick={() => { void load(Math.max(0, page.offset - page.limit)) }}>上一页</button>
        <button type="button" disabled={busy || !page.has_more} onClick={() => { void load(page.offset + page.limit) }}>下一页</button>
      </div>}
    </div>}
  </section>
}
