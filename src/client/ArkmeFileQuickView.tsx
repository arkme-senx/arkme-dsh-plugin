import { useEffect, useRef, useState } from 'react'
import type { ArkmeContentBlock, ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeFileViewer } from './ArkmeFileViewer.js'
import { ArkmeFileCard } from './ArkmeRichContent.js'

export function ArkmeFileQuickView({ query, onOpenRecord }: { query: string; onOpenRecord: (item: ArkmeSearchRecordItem) => void }) {
  const [page, setPage] = useState<ArkmeRecordSearchResult>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ArkmeContentBlock>()
  const generation = useRef(0)
  const request = useRef<AbortController>()
  const load = async (cursor?: string) => {
    const id = ++generation.current
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const result = await callArkme<ArkmeRecordSearchResult>('files.search', { query, limit: 30, ...(cursor ? { cursor } : {}) }, controller.signal)
      if (id !== generation.current) return
      setPage(current => cursor === undefined ? result : { ...result, items: [...new Map([...(current?.items ?? []), ...result.items].map(item => [item.recordUid, item])).values()] })
    } catch (caught) { if (id === generation.current) setError(controller.signal.aborted ? '加载超时，请重试' : caught instanceof Error ? caught.message : '文件加载失败') }
    finally { clearTimeout(timeout); if (id === generation.current) setLoading(false) }
  }
  useEffect(() => {
    generation.current += 1; request.current?.abort(); setPage(undefined); setPreview(undefined)
    const timer = setTimeout(() => { void load() }, query.trim() ? 300 : 0)
    return () => { clearTimeout(timer); generation.current += 1; request.current?.abort() }
  }, [query])
  return <section aria-label="文件快速查找" style={{ padding: 12 }}>
    {query.trim() !== '' && <p style={{ fontSize: 12, color: 'gray' }}>搜索关联快记中的文件</p>}
    {page?.items.flatMap(item => item.files.map((file, index) => <div key={`${item.recordUid}:${file.fileAssetUid}:${index}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(128,128,128,.18)' }}>
      <div style={{ flex: 1, minWidth: 0 }}><ArkmeFileCard block={{ kind: 'file', mediaRef: file.mediaRef ?? '', ...(file.mediaRef === undefined ? {} : { originalRef: file.mediaRef }), fileName: file.fileName || '文件', mimeType: file.mimeType || 'application/octet-stream', size: file.size ?? 0, sortOrder: index }} onOpen={setPreview} previewOpen={preview?.mediaRef === file.mediaRef} />
        <small style={{ color: 'gray' }}>{new Date(item.sendAtMillis).toLocaleDateString()} · {item.sourceTitle || item.nickname || '快记'}</small>
      </div>
      <button type="button" disabled={item.targetSource === undefined} onClick={() => onOpenRecord(item)}>查看来源</button>
    </div>))}
    {!loading && !error && (page?.items.length ?? 0) === 0 && <p>{page?.hasMore ? '这一页没有匹配文件，可以继续加载' : '暂无文件'}</p>}
    {loading && <p role="status">正在加载…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => { void load(page?.nextCursor) }}>重试</button></p>}
    {!loading && page?.hasMore && page.nextCursor && <button type="button" onClick={() => { void load(page.nextCursor) }}>加载更多</button>}
    {preview !== undefined && <ArkmeFileViewer block={preview} openLocalFile onClose={() => setPreview(undefined)} />}
  </section>
}
