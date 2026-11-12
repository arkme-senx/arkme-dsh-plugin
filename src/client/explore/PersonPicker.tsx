import { useEffect, useRef, useState } from 'react'
import { personMatches, PEOPLE_SOURCE_LABELS } from '../../people-contract.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { usePeopleDirectory } from './usePeopleDirectory.js'
import { PeopleLoading } from './PeopleSurface.js'
import { callArkme } from '../api.js'
import { tr } from '../locale.js'

export function PersonPicker({ accountScope, onClose, onChoose }: { accountScope: string; onClose(): void; onChoose(value: { label: string; speakerRef: string }): void }) {
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(50)
  const { people, reads, refresh, hasMore, loadMore } = usePeopleDirectory(accountScope, query)
  const [binding, setBinding] = useState<{ label: string; state: string; commandRef: string }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const controller = useRef(new AbortController())
  useEffect(() => { const c = new AbortController(); controller.current = c; return () => c.abort() }, [accountScope])
  const prepare = async (personRef: string, label: string) => {
    setBusy(true); setError(''); const signal = controller.current.signal
    try { const result = await callArkme<{ state: string; commandRef: string }>('people.identities', { action: 'binding-preview', personRef }, signal); if (!signal.aborted) setBinding({ ...result, label }) }
    catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : tr('读取失败，请重试')) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const bind = async () => {
    if (!binding || busy) return
    setBusy(true); setError(''); const signal = controller.current.signal
    try { const result = await callArkme<{ speakerRef: string }>('people.identities', { action: 'binding-apply', commandRef: binding.commandRef }, signal); if (!signal.aborted) onChoose({ label: binding.label, speakerRef: result.speakerRef }) }
    catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : tr('操作失败，请重试')) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const visible = people
  return <ArkmeDetailShell title={tr('选择已有的人物')} label={tr('选择已有的人物')} onClose={onClose} style={{ position: 'fixed', top: 8, bottom: 8, zIndex: 1021 }}><div className="arkme-explore-dialog">
    <input autoFocus aria-label={tr('搜索人物档案')} placeholder={tr('姓名、备注或别名')} value={query} onChange={event => { setQuery(event.target.value); setLimit(50) }}/>
    <PeopleLoading reads={reads} onRetry={refresh}/>
    <div className="people-picker-list">{visible.slice(0, limit).map(person => {
      const target = person.facets.find(x => x.speakerRef) ?? person.facets.find(x => x.assignmentRef)
      return <button key={person.key} className="explore-row" disabled={busy || !!binding || (!target?.assignmentRef && !person.facets.some(f => f.personRef && !f.accountLinked))} onClick={() => { if (target?.assignmentRef) onChoose({ label: person.name, speakerRef: target.assignmentRef }); else { const ref = person.facets.find(f => f.personRef && !f.accountLinked)?.personRef; if (ref) void prepare(ref, person.name) } }}>
        <strong>{person.name}{person.isSelf ? ` · ${tr('我')}` : ''}</strong><div className="explore-row-meta">{person.sources.map(source => tr(PEOPLE_SOURCE_LABELS[source])).join(' · ')}</div>
        {!!person.aliases.length && <div className="explore-muted">{person.aliases.join('、')}</div>}
        {!target?.assignmentRef && <div className="explore-muted">{tr('用于录音标记 · 先预览录音身份')}</div>}
      </button>
    })}{visible.length > limit && <button className="explore-source-link" onClick={() => setLimit(value => value + 50)}>{tr('显示更多人物')}</button>}{visible.length <= limit && hasMore && <button className="explore-source-link" onClick={loadMore}>{tr('加载更多人物')}</button>}</div>
    {binding && <section className="explore-evidence"><strong>{binding.label}</strong><p>{tr(binding.state === 'reuse' ? '将复用此人物已有的录音身份。' : '将为此人物建立可复用的录音身份，无需对方注册账号。')}</p><p className="explore-muted">{tr('本步不修改转写。随后仍需确认片段范围并保存；撤销片段纠错会保留人物身份。')}</p><div className="explore-detail-actions"><button className="explore-button" disabled={busy} onClick={() => void bind()}>{tr('确认并继续标记')}</button><button className="explore-button" disabled={busy} onClick={() => setBinding(undefined)}>{tr('取消')}</button></div></section>}
    {busy && <p role="status">{tr('正在处理…')}</p>}{error && <p role="alert" className="explore-error">{error}</p>}
    <p className="explore-muted">{tr('选择后回到原弹窗确认应用范围并保存。同名人物不会自动合并。')}</p>
  </div></ArkmeDetailShell>
}
