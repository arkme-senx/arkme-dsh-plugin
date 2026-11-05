import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { copyText } from './clipboard-text.js'
import type { TranscriptViewSavedPage } from '../transcript-view-contract.js'

/** Historical snapshots remain reachable from their source after resegmentation. */
export function TranscriptViewHistory({
  sourceRef,
  onClose,
}: {
  sourceRef: string
  onClose(): void
}) {
  const auth = useSyncExternalStore(
    arkmeAuthStore.subscribe,
    arkmeAuthStore.getSnapshot,
    arkmeAuthStore.getSnapshot,
  ).auth
  const account =
    auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const key = `${account}:${sourceRef}`,
    currentKey = useRef(key)
  currentKey.current = key
  const [page, setPage] = useState<{
    key: string
    rows: TranscriptViewSavedPage['items']
    cursor: string
  }>({ key, rows: [], cursor: '' })
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [retry, setRetry] = useState(0)
  const lifetime = useRef<AbortController>()
  const load = async (after = '', signal = lifetime.current?.signal) => {
    if (!account || signal?.aborted) return
    setBusy(true)
    try {
      const result = await callArkme<TranscriptViewSavedPage>(
        'transcript.views.saved',
        { accountKey: account, ref: sourceRef, after },
        signal,
      )
      if (signal?.aborted || currentKey.current !== key) return
      setPage((old) => ({
        key,
        rows: [...(after && old.key === key ? old.rows : []), ...result.items],
        cursor: result.next_cursor,
      }))
      setNotice('')
    } catch (error) {
      if (!signal?.aborted && currentKey.current === key) {
        const body=(error as {body?:{code?:string;httpStatus?:number}})?.body
        if(body?.code === 'transcript-source-unavailable' || body?.code === 'transcript-account-changed' || [401,403].includes(body?.httpStatus ?? 0)) setPage({key,rows:[],cursor:''})
        setNotice(error instanceof Error ? error.message : '更正读取失败')
      }
    } finally {
      if (!signal?.aborted && currentKey.current === key) setBusy(false)
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void load('', controller.signal)
    return () => controller.abort()
  }, [key, retry])
  if (!account) return null
  const rows = page.key === key ? page.rows : [],
    cursor = page.key === key ? page.cursor : ''
  return (
    <section
      aria-label="已保存的个人更正"
      style={{
        border: `1px solid ${arkmeTheme.border}`,
        borderRadius: 8,
        padding: 12,
        maxHeight: 360,
        overflow: 'auto',
        color: arkmeTheme.text,
      }}
    >
      <p>历史快照，仅自己可见；原文重分段后，旧更正保留供复核。</p>
      {rows.map((row) => (
        <div
          key={row.segment_uid}
          style={{
            padding: '8px 0',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          <div>{row.text}</div>
          <small>
            {row.marks.length} 个历史标记 · 版本 {row.revision}
          </small>
          <button
            type="button"
            onClick={() => {
              void copyText(row.text).catch((error) => setNotice(String(error)))
            }}
          >
            复制更正
          </button>
        </div>
      ))}
      {!rows.length && !busy && !notice && <div>暂无已保存更正</div>}
      {busy && <div role="status">读取中</div>}
      {notice && (
        <div role="alert">
          {notice}
          <button
            type="button"
            disabled={busy}
            onClick={() => setRetry((v) => v + 1)}
          >
            重试
          </button>
        </div>
      )}
      {cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void load(cursor)
          }}
        >
          加载更多
        </button>
      )}
      <button type="button" onClick={onClose}>
        关闭更正列表
      </button>
    </section>
  )
}
