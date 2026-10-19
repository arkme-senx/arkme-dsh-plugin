import { useState } from 'react'
import { personMatches, PEOPLE_SOURCE_LABELS } from '../../people-contract.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { usePeopleDirectory } from './usePeopleDirectory.js'
import { PeopleLoading } from './PeopleSurface.js'
import { tr } from '../locale.js'

export function PersonPicker({ accountScope, onClose, onChoose }: { accountScope: string; onClose(): void; onChoose(value: { label: string; speakerRef: string }): void }) {
  const { people, reads, refresh } = usePeopleDirectory(accountScope)
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(50)
  const visible = people.filter(person => personMatches(person, query))
  return <ArkmeDetailShell title={tr('选择已有的人物')} label={tr('选择已有的人物')} onClose={onClose} style={{ position: 'fixed', top: 8, bottom: 8, zIndex: 1021 }}><div className="arkme-explore-dialog">
    <input autoFocus aria-label={tr('搜索人物档案')} placeholder={tr('姓名、备注或别名')} value={query} onChange={event => { setQuery(event.target.value); setLimit(50) }}/>
    <PeopleLoading reads={reads} onRetry={refresh}/>
    <div className="people-picker-list">{visible.slice(0, limit).map(person => {
      const target = person.facets.find(x => x.speakerRef) ?? person.facets.find(x => x.assignmentRef)
      return <button key={person.key} className="explore-row" disabled={!target?.assignmentRef} onClick={() => { if (target?.assignmentRef) onChoose({ label: person.name, speakerRef: target.assignmentRef }) }}>
        <strong>{person.name}{person.isSelf ? ` · ${tr('我')}` : ''}</strong><div className="explore-row-meta">{person.sources.map(source => tr(PEOPLE_SOURCE_LABELS[source])).join(' · ')}</div>
        {!!person.aliases.length && <div className="explore-muted">{person.aliases.join('、')}</div>}
        {!target?.assignmentRef && <div className="explore-muted">{tr('关系人物尚未关联录音身份，暂不能直接标记')}</div>}
      </button>
    })}{visible.length > limit && <button className="explore-source-link" onClick={() => setLimit(value => value + 50)}>{tr('显示更多人物')}</button>}</div>
    <p className="explore-muted">{tr('选择后回到原弹窗确认应用范围并保存。尚未接通的身份关联不会自动创建同名副本。')}</p>
  </div></ArkmeDetailShell>
}
