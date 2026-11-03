import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeEnvironment, ArkmeSearchRecordItem, ArkmeSourceItem } from '../types.js'
import type { LocationMarker, LocationSource, LocationViewport } from '../location-search.js'
import { worldLocationViewport } from '../location-search.js'
import { conversationLocationCache as cache } from './conversation-location-cache.js'
import { conversationLocationGroups, locationRecordDate } from './conversation-location-map.js'
import { ArkmeLocationMapFrame } from './ArkmeLocationMapFrame.js'
import { locationSearchCache } from './location-search-cache.js'
import { selfTopicDirectory } from './self-topic-directory-cache.js'
import { arkmeIntlLocale, tr } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import { ARKME_DSH_INPUT_TOPIC_KIND } from '../topic-policy.js'

export function SelfLocationScopePicker({ source, userId, environment, onChange }: {
  source: ArkmeSourceItem; userId: number; environment: ArkmeEnvironment; onChange(source: ArkmeSourceItem): void
}) {
  const directory = selfTopicDirectory(userId, environment)
  const state = useSyncExternalStore(directory.subscribe, directory.getSnapshot, directory.getSnapshot)
  useEffect(() => { void directory.ensure() }, [directory])
  const sources = state.sources.some(item => item.sourceRef === source.sourceRef) ? state.sources : [source, ...state.sources]
  const name = (item: ArkmeSourceItem) => {
    if (item.kind === 'send_to_self') return tr('全部')
    if (item.kind === 'default_category') return tr('未分类')
    const names = [item.displayName], seen = new Set([item.sourceRef])
    let parent = sources.find(value => value.sourceRef === item.parentSourceRef || item.parentTopicHierarchyKey && value.topicHierarchyKey === item.parentTopicHierarchyKey)
    while (parent && !seen.has(parent.sourceRef)) { names.unshift(parent.displayName); seen.add(parent.sourceRef); const current = parent; parent = sources.find(value => value.sourceRef === current.parentSourceRef || current.parentTopicHierarchyKey && value.topicHierarchyKey === current.parentTopicHierarchyKey) }
    return names.join(' / ')
  }
  return <div className="arkme-location-scope"><label>{tr('发给自己的位置')} <select aria-label={tr('位置消息范围')} value={source.sourceRef}
    style={{ color: arkmeTheme.text, background: arkmeTheme.base, borderColor: arkmeTheme.border }}
    onChange={event => { const next = sources.find(item => item.sourceRef === event.currentTarget.value); if (next) onChange(next) }}>
    {sources.filter(item => ['send_to_self', 'default_category', 'topic'].includes(item.kind) && item.topicKind !== ARKME_DSH_INPUT_TOPIC_KIND).map(item => <option key={item.sourceRef} value={item.sourceRef}>{name(item)}</option>)}
  </select></label>{state.loading && <small role="status">{tr('正在读取主题…')}</small>}{state.error && <span role="alert">{state.error} <button type="button" onClick={() => { void directory.ensure(true) }}>{tr('重试')}</button></span>}</div>
}

export function ArkmeConversationLocationView({ account, browserAk, source, date, timezone, toolbar, onOpenRecord }: {
  account: string; browserAk: string; source: ArkmeSourceItem; date: string; timezone: string; toolbar: ReactNode
  onOpenRecord(record: ArkmeSearchRecordItem): void
}) {
  const scope = `conversation:${source.sourceRef}:${date}:${timezone}`
  const saved = useRef(locationSearchCache.getNavigation(account, scope))
  const chat = source.kind === 'private_chat' || source.kind === 'group_chat'
  const available: LocationSource[] = chat ? ['my_sent', source.kind === 'group_chat' ? 'received_group' : 'received_private'] : ['quick_note']
  const [sources, setSources] = useState<LocationSource[]>(saved.current?.sources ?? [chat ? 'my_sent' : 'quick_note'])
  const [viewport, setViewport] = useState<LocationViewport>(saved.current?.viewport ?? worldLocationViewport)
  const [initialViewport] = useState(viewport)
  const [selected, setSelected] = useState<{ marker: LocationMarker; viewport: LocationViewport }>()
  const [limit, setLimit] = useState(6)
  useEffect(() => { setSelected(undefined); setLimit(6) }, [date, timezone])
  const state = useSyncExternalStore(cache.subscribe, () => cache.get(account, source.sourceRef), () => cache.get(account, source.sourceRef))
  const revision = useSyncExternalStore(locationSearchCache.subscribe, locationSearchCache.getRevision, locationSearchCache.getRevision)
  useEffect(() => { void cache.load(account, source.sourceRef); return () => cache.pause(account, source.sourceRef) }, [account, source.sourceRef, revision])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void cache.load(account, source.sourceRef) }
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [account, source.sourceRef])
  const records = useMemo(() => state.items.filter(item => sources.includes(item.source) && (!date || locationRecordDate(item.record.sendAtMillis, timezone) === date)), [state.items, sources, date, timezone])
  const groups = useMemo(() => conversationLocationGroups(records, viewport), [records, viewport])
  const markers = useMemo(() => groups.map(group => group.marker), [groups])
  const fitBounds = useMemo(() => records.length ? records.reduce((bounds, item) => ({
    swLat: Math.min(bounds.swLat, item.latitude), neLat: Math.max(bounds.neLat, item.latitude),
    swLon: Math.min(bounds.swLon, item.longitude), neLon: Math.max(bounds.neLon, item.longitude),
  }), { swLat: records[0]!.latitude, neLat: records[0]!.latitude, swLon: records[0]!.longitude, neLon: records[0]!.longitude }) : undefined, [records])
  const visibleSelected = useMemo(() => {
    if (!selected) return
    return { marker: selected.marker, records: conversationLocationGroups(records, selected.viewport).find(group => group.marker.key === selected.marker.key)?.records ?? [] }
  }, [selected, records])
  const save = () => locationSearchCache.saveNavigation(account, { viewport, sources, scrollTop: 0 }, scope)
  useEffect(save, [account, scope, viewport, sources])
  const closeRecords = () => setSelected(undefined)
  const recordTime = (record: ArkmeSearchRecordItem) => record.sendAtMillis > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(record.sendAtMillis) : ''
  return <ArkmeLocationMapFrame account={account} browserAk={browserAk} scope={scope} toolbar={toolbar} markers={markers} initialViewport={initialViewport} fitWhileLoading
    {...(fitBounds ? { fitBounds } : {})}
    sources={sources} availableSources={available} onSourcesChange={next => { setSources(next); closeRecords() }}
    onViewport={next => setViewport(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)}
    onSelect={marker => { const group = groups.find(value => value.marker.key === marker.key); if (group) { setSelected({ marker: group.marker, viewport }); setLimit(6) } }}
    {...(visibleSelected ? { selectedKey: visibleSelected.marker.key, recordTitle: visibleSelected.marker.label, recordCount: visibleSelected.records.length } : {})}
    onCloseRecords={closeRecords}
    summary={<>{state.error ? <>{state.error} <button type="button" onClick={() => { void cache.load(account, source.sourceRef, true) }}>{tr('重试')}</button></>
      : state.loading || !state.complete ? tr('正在读取历史位置：已检查 {count} 条消息', { count: String(state.scanned) })
        : sources.length === 0 ? tr('请选择位置来源') : !records.length ? tr('此范围暂无位置记录') : tr('共 {count} 条位置记录', { count: String(records.length) })}</>}>
    <div className="arkme-location-record-list">
      {visibleSelected?.records.slice(0, limit).map(item => <button className="arkme-location-record" key={item.key} type="button" onClick={() => onOpenRecord(item.record)}>
        <strong>{item.label}</strong>{item.address && item.address !== item.label && <small>{item.address}</small>}
        <p>{item.record.title || item.record.snippet || tr('位置记录')}</p>
        <small>{recordTime(item.record)} · {tr(item.locationKind === 'snapshot' ? '记忆快照中的位置' : '直接发送的位置')}</small>
      </button>)}
      {visibleSelected && visibleSelected.records.length > limit && <button className="arkme-location-more" type="button" onClick={() => setLimit(value => value + 20)}>{tr('加载更多')}</button>}
      {visibleSelected && !visibleSelected.records.length && <p className="arkme-location-message">{tr('暂无匹配的位置记录')}</p>}
    </div>
  </ArkmeLocationMapFrame>
}
