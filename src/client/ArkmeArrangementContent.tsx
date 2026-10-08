import { useEffect, useId, useState } from 'react'
import type { ArkmeArrangementDetail, ArkmeArrangementItem } from '../types.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export function ArkmeArrangementContent({ item, expanded }: { item: ArkmeArrangementItem; expanded: boolean }) {
  const { arrangementRef } = item
  const [detail, setDetail] = useState<ArkmeArrangementDetail>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const regionId = useId()
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setError(false)
    setLoading(true)
    void withArkmeReadDeadline(signal => callArkme<ArkmeArrangementDetail>('arrangements.detail', { arrangementRef }, signal), controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        if (value.arrangementRef !== arrangementRef) throw new Error('Arrangement identity mismatch')
        setDetail(value)
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [arrangementRef, expanded, attempt])
  const source = detail?.creationSource ?? item.creationSource
  const hasSource = !!source?.items.length || !!source?.unavailableCount
  return <div className="arkme-arrangement-content" draggable={false}
    onDragStart={event => { event.preventDefault(); event.stopPropagation() }}>
    {expanded && <div id={regionId} className="arkme-arrangement-content-detail" role="region" aria-label={tr('创建原文')}>
      <strong>{tr('创建原文')}</strong>
      {source?.items.map((entry, index) => <div className="arkme-arrangement-source-item" key={index}>
        <div className="arkme-arrangement-content-text">{entry.text}</div>
      </div>)}
      {!!source?.unavailableCount && <div className="arkme-arrangement-content-empty">{tr('创建原文暂不可查看')} ({source.unavailableCount})</div>}
      {loading && <div role="status">{tr('加载中…')}</div>}
      {error && <div role="alert">{tr('创建原文加载失败')}<button type="button" data-arrangement-content-retry={arrangementRef}
        onClick={event => { event.stopPropagation(); setAttempt(value => value + 1) }}>{tr('重试')}</button></div>}
      {!loading && !error && !hasSource && <div className="arkme-arrangement-content-empty">{tr('暂无创建原文')}</div>}
    </div>}

  </div>
}
