import { useCallback, useEffect, useRef, useState } from 'react'
import { tr } from './locale.js'

export type Page<T> = { items: T[]; cursor?: string; warning?: string }

/** Read-only pagination, isolated per mounted account and source. Failed pages retain visible content. */
export function useBuiltinPreviewPage<T>(read: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>, key: (item: T) => string) {
  const [page, setPage] = useState<Page<T>>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const request = useRef<AbortController>(), failedCursor = useRef<string>(), keyRef = useRef(key)
  keyRef.current = key
  const load = useCallback(async (cursor?: string) => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller; failedCursor.current = cursor
    setLoading(true); setError('')
    const timer = setTimeout(() => { controller.abort(); setError(tr('内容加载超时，请重试')); setLoading(false); request.current = undefined }, 20000)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    try {
      const next = await read(cursor, controller.signal)
      if (controller.signal.aborted) return
      if (next.cursor !== undefined && next.cursor === cursor) throw new Error(tr('历史分页异常，请重试'))
      setPage(old => ({ ...next, items: [...new Map([...(cursor ? old?.items ?? [] : []), ...next.items].map(item => [keyRef.current(item), item])).values()] }))
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('加载失败，请重试'))
    } finally {
      clearTimeout(timer)
      if (request.current === controller) { request.current = undefined; setLoading(false) }
    }
  }, [read])
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = undefined } }, [load])
  return { page, loading, error, more: () => load(page?.cursor), retry: () => load(failedCursor.current) }
}
