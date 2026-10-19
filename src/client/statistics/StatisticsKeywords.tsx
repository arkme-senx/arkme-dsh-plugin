import type { StatisticsKeyword } from '../../statistics-contract.js'
import { arkmeIntlLocale, tr } from '../locale.js'
import type { StatisticsResource } from './use-statistics.js'

const previewCount = 18
const format = (value: number) => value.toLocaleString(arkmeIntlLocale())
const sortKeywords = (items: StatisticsKeyword[]) => items.slice().sort((a, b) => (b.occurrenceCount ?? -1) - (a.occurrenceCount ?? -1) || a.text.localeCompare(b.text))

/** The list and cloud share the same frequency values and source action. */
export function StatisticsKeywords({ resource, onSelect, onRetry, onOpenList }: {
  resource: StatisticsResource<{ keywords: StatisticsKeyword[] | null }>
  onSelect(keyword: StatisticsKeyword): void
  onRetry(): void
  onOpenList(): void
}) {
  const items = resource.value?.keywords && sortKeywords(resource.value.keywords)
  const visible = items?.slice(0, previewCount)
  const max = Math.max(1, ...items?.map(item => item.occurrenceCount ?? 0) ?? [])
  return <section className="stats-card stats-keyword-card" aria-label={tr('关键词词频')}>
    <header><div><h2>{tr('关键词词频')}</h2><small>{tr('点击词语查看相关快记')}</small></div>
      <button disabled={resource.loading || !!resource.error || !items?.length} onClick={onOpenList}>{tr('查看词频')}</button>
    </header>
    {resource.loading ? <p className="stats-status" role="status">{tr('正在读取关键词…')}</p>
      : resource.error ? <p className="stats-status" role="alert">{resource.error}<button onClick={onRetry}>{tr('重试')}</button></p>
      : !items ? <p className="stats-status">{tr('关键词词频尚未接通')}<small className="stats-keyword-note">{tr('当前统计服务未提供关键词数据。')}</small></p>
      : !items.length ? <p className="stats-status">{tr('此范围暂无关键词')}</p>
      : <>
        <div className="stats-keywords" aria-label={tr('关键词词云')}>
          {visible?.map((item, index) => <button key={`${item.text}:${index}`} onClick={() => onSelect(item)} title={item.text}
            style={{ fontSize: `${14 + 10 * Math.log1p(item.occurrenceCount ?? 0) / Math.log1p(max)}px` }}>
            <span>{item.text}</span><small>{item.occurrenceCount === null ? tr('次数待提供') : `${format(item.occurrenceCount)} ${tr('次')}`}</small>
          </button>)}
        </div>
        {items.length > previewCount && <button className="stats-keyword-more" onClick={onOpenList}>{tr('查看全部')} {format(items.length)} {tr('个关键词')}</button>}
      </>}
  </section>
}

export function StatisticsKeywordList({ items, onSelect }: { items: StatisticsKeyword[]; onSelect(keyword: StatisticsKeyword): void }) {
  return <ol className="stats-frequency-list" aria-label={tr('关键词词频列表')}>
    {sortKeywords(items).map((item, index) => <li key={`${item.text}:${index}`}><button onClick={() => onSelect(item)} title={item.text}>
      <span className="stats-frequency-rank" aria-hidden="true">{index + 1}</span>
      <span className="stats-frequency-word">{item.text}{item.recordCount !== null && <small>{tr('涉及')} {format(item.recordCount)} {tr('条快记')}</small>}</span>
      <span className="stats-frequency-count">{item.occurrenceCount === null ? tr('次数待提供') : <>{format(item.occurrenceCount)} <small>{tr('次')}</small></>}</span>
    </button></li>)}
  </ol>
}
