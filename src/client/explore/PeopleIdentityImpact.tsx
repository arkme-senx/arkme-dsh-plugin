import { useEffect, useState } from 'react'
import type { PeopleIdentityImpact } from '../../people-contract.js'
import { callArkme } from '../api.js'
import { tr } from '../locale.js'

/** Every page stays bound to the original signed preview; closing cancels the read. */
export function PeopleIdentityImpactPanel({ commandRef, onReady }: { commandRef: string; onReady(ready: boolean): void }) {
  const [value, setValue] = useState<PeopleIdentityImpact>(), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    const c = new AbortController(); onReady(false); setError(''); setValue(undefined)
    void (async () => {
      let cursor: string | undefined
      const seen = new Set<string>()
      try {
        for (;;) {
          const p = await callArkme<PeopleIdentityImpact>('people.identities', { action: 'impact', commandRef, ...(cursor ? { cursor } : {}) }, c.signal)
          if (c.signal.aborted) return
          if (!p || !['complete','pending'].includes(p.state)) throw new Error(tr('影响范围响应不完整'))
          setValue(p)
          if (p.state === 'complete') { onReady(p.unavailableRecordCount === 0); return }
          if (!p.nextCursor || seen.has(p.nextCursor)) throw new Error(tr('影响范围分页已变化，请重新预览'))
          cursor = p.nextCursor; seen.add(cursor)
        }
      } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('影响范围暂不可用')) }
    })()
    return () => c.abort()
  }, [commandRef, revision])
  return <div className="explore-muted">
    {value && <><p>{tr('关系原文（去重）')}：{value.relationRecordCount}{value.state === 'pending' ? ` · ${tr('统计中')}` : ''}{value.unavailableRecordCount > 0 ? ` · ${tr('来源暂不可核对')} ${value.unavailableRecordCount}` : ''}</p>
      <p>{tr('录音片段')}：{value.recordingCount ?? tr('等待核对')} · {tr('聊天原文')}：{value.chatCount ?? tr('等待核对')}</p>
      {value.displayChange && <p>{tr('人物显示名')}：{value.displayChange.before.join('、') || tr('未建档')} → {value.displayChange.after.join('、') || tr('未关联')}</p>}
      {value.names.map((n,i) => <p key={i}>{tr(n.target ? '目标人物名称' : '涉及人物名称')}：{n.name}</p>)}</>}
    {value && value.unavailableRecordCount > 0 && <p>{tr('有来源暂不可核对，暂不能确认；请恢复来源后重新预览。')}</p>}
    {!value && !error && <p role="status">{tr('正在核对影响范围…')}</p>}
    <p>{tr('关系原文、录音片段和聊天原文分别核对；来源权限和内容不改变。未完成或失败的来源不计作零，同名不作为合并依据。')}</p>
    {error && <p role="alert" className="explore-error">{error} <button className="explore-source-link" onClick={() => setRevision(v => v + 1)}>{tr('重新统计')}</button></p>}
  </div>
}
