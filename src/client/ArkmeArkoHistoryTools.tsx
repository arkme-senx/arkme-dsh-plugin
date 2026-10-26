import { arkoLifecycleSync } from './arko-lifecycle-sync.js'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import type { ArkmeArkoHistoryItem } from '../types.js'
import type { ArkmeArkoContextWindow, ArkmeArkoMessagePage, ArkmeArkoSearchPage } from '../arko-history-contract.js'
import { createArkmeSdk } from '../sdk/index.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeConversationHeaderIconButton } from './ArkmeGroupChatControls.js'
import { ArkmeSelfCalendarPopover } from './ArkmeCalendarSurface.js'
import { ConversationActionsMenu, conversationExportActionItem } from './PrivateChatActions.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { arkoHistoryDate } from './arko-history-browser.js'
import { tr } from './locale.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { useSelectedMessageSearch } from './message-selection-search.js'

const button: CSSProperties = { border: 0, padding: '6px 8px', borderRadius: 6, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 12 }
const feedbackStyle: CSSProperties = { maxWidth: '100%', boxSizing: 'border-box', overflowWrap: 'anywhere', padding: '8px 12px', borderRadius: 8, background: arkmeTheme.layer2, color: arkmeTheme.secondary, border: `1px solid ${arkmeTheme.border}`, fontSize: 12 }
const failText = (error: unknown) => error instanceof Error ? error.message : tr('读取失败')
const emptyPage: ArkmeArkoSearchPage = { items: [], hasMore: false, scanned: 0, consistency: 'live' }
const nextDate = (date: string) => { const day = new Date(`${date}T00:00:00`); day.setDate(day.getDate() + 1); return arkoHistoryDate(day.getTime()) }

export function ArkmeArkoHistoryTools({ accountScope, name, host, disabled, clearDisabled, detailOpen, onClear, onCapabilities, onLocate, onOpenPanel, getReadingDate }: {
  accountScope: string; name: string; host: RefObject<HTMLDivElement>; disabled: boolean; clearDisabled: boolean; detailOpen: boolean
  onClear(): void; onCapabilities(trigger: HTMLButtonElement | null): void; onOpenPanel(): void
  onLocate(window: ArkmeArkoContextWindow, item: ArkmeArkoHistoryItem): void
  getReadingDate(): string | undefined
}) {
  const calendarAnchor = useRef<HTMLButtonElement>(null), menuAnchor = useRef<HTMLButtonElement>(null), searchAnchor = useRef<HTMLButtonElement>(null), searchInput = useRef<HTMLInputElement>(null)
  const lifecycleGeneration = useSyncExternalStore(arkoLifecycleSync.subscribe, arkoLifecycleSync.snapshot, arkoLifecycleSync.snapshot)
  const [open, setOpen] = useState<'calendar' | 'search' | 'menu'>()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(emptyPage), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('')
  const [locationFeedback, setLocationFeedback] = useState<{ text: string; pending: boolean }>()
  const [exporting, setExporting] = useState(false), [notice, setNotice] = useState(''), [exportCount, setExportCount] = useState(0)
  const searchController = useRef<AbortController>(), locateController = useRef<AbortController>(), exportController = useRef<AbortController>()
  const cancelLocation = useCallback(() => { locateController.current?.abort(); setLocationFeedback(undefined) }, [])
  useEffect(() => () => { searchController.current?.abort(); locateController.current?.abort(); exportController.current?.abort() }, [accountScope])
  useEffect(() => { setPage(emptyPage); setNotice(''); setLocationFeedback(undefined); setExporting(false); setOpen(undefined) }, [accountScope])
  useEffect(() => { if (detailOpen) { cancelLocation(); setOpen(undefined) } }, [detailOpen, cancelLocation])
  const search = useCallback(async (cursor?: string) => {
    searchController.current?.abort()
    if (!query.trim()) { setPage(emptyPage); setSearching(false); setSearchError(''); return }
    const controller = new AbortController(); searchController.current = controller
    setSearching(true); setSearchError('')
    try {
      let next = cursor
      const visited = new Set<string>(cursor ? [cursor] : [])
      const found = new Set<string>()
      for (let index = 0; index < 1000; index++) {
        const result = await callArkme<ArkmeArkoSearchPage>('arko.search', { keyword: query.trim(), limit: 50,
          ...(next ? { cursor: next } : {}) }, controller.signal)
        controller.signal.throwIfAborted()
        const replace = index === 0 && !cursor
        setPage(previous => ({ ...result, scanned: (replace ? 0 : previous.scanned) + result.scanned,
          items: [...new Map([...(replace ? [] : previous.items), ...result.items].map(item => [item.messageKey, item])).values()].slice(-200) }))
        for (const item of result.items) found.add(item.messageKey)
        if (!result.hasMore || found.size >= 50) break
        if (!result.nextCursor || visited.has(result.nextCursor)) throw new Error('搜索分页未能继续，请重试')
        visited.add(result.nextCursor); next = result.nextCursor
      }
    } catch (error) { if (!controller.signal.aborted) setSearchError(failText(error)) }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }, [query])
  useEffect(() => {
    searchController.current?.abort(); setSearching(false)
    if (open !== 'search') return
    cancelLocation()
    setPage(emptyPage); setSearchError(''); if (query.trim()) setSearching(true)
    const timer = setTimeout(() => { void search() }, 300)
    return () => { clearTimeout(timer); searchController.current?.abort() }
  }, [open, search, cancelLocation, lifecycleGeneration])
  useEffect(() => {
    if (open !== 'search') return
    const frame = requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])
  const locate = async (ref: string, controller = new AbortController()) => {
    searchController.current?.abort(); setSearching(false)
    locateController.current?.abort(); locateController.current = controller; setLocationFeedback({ text: tr('正在定位原消息…'), pending: true })
    try {
      const window = await callArkme<ArkmeArkoContextWindow>('arko.context', { messageRef: ref, before: 20, after: 20 }, controller.signal)
      if (controller.signal.aborted) return
      const anchor = window.items.find(item => item.messageRef === window.anchorMessageRef)
      if (!anchor) throw new Error('原消息已不可查看，请刷新后重试')
      onLocate(window, anchor); setOpen(undefined); setLocationFeedback(undefined)
    } catch (error) { if (!controller.signal.aborted) setLocationFeedback({ text: failText(error), pending: false }) }
  }
  const locateDay = async (date: string) => {
    locateController.current?.abort(); const controller = new AbortController(); locateController.current = controller
    setLocationFeedback({ text: tr('正在定位这一天的对话…'), pending: true })
    try {
      let cursor: string | undefined
      const visited = new Set<string>()
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await callArkme<ArkmeArkoMessagePage>('arko.messages', { startAtMillis: new Date(`${date}T00:00:00`).getTime(),
          endAtMillis: new Date(`${nextDate(date)}T00:00:00`).getTime(), direction: 'asc', limit: 1, ...(cursor ? { cursor } : {}) }, controller.signal)
        controller.signal.throwIfAborted()
        const ref = result.items[0]?.messageRef
        if (ref) { locateController.current = undefined; await locate(ref, controller); return }
        if (!result.hasMore) { setLocationFeedback({ text: tr('这一天没有可查看的对话'), pending: false }); return }
        if (!result.nextCursor || visited.has(result.nextCursor)) throw new Error('日期分页未能继续，请重试')
        visited.add(result.nextCursor); cursor = result.nextCursor
      }
      throw new Error('当天候选消息较多，定位超过读取预算，请使用关键词缩小范围')
    } catch (error) { if (!controller.signal.aborted) setLocationFeedback({ text: failText(error), pending: false }) }
  }
  const loadMonth = useCallback(async (range: { startDate: string; endDate: string; timezone: string }, signal: AbortSignal) => {
    const result = await callArkme<{ daily_data: Array<{ date: string; count: number; has_items: boolean }>; coverage: { status: string } }>('calendar.activity',
      { source: 'arko', mode: 'buckets', body: { start_date: range.startDate, end_date: nextDate(range.endDate), timezone: range.timezone } }, signal)
    if (result.coverage?.status !== 'complete' || !Array.isArray(result.daily_data)) throw new Error('日历读取不完整，请重试')
    return { days: result.daily_data.map(day => ({ bucketDate: day.date, count: day.count, hasRecords: day.has_items, protectedCount: 0 })) }
  }, [lifecycleGeneration])
  const toggle = (next: 'calendar' | 'search' | 'menu') => { if (open === next) { setOpen(undefined); return }; if (next !== 'menu') { cancelLocation(); onOpenPanel() }; setOpen(next) }
  useSelectedMessageSearch(accountScope ? `arko:${accountScope}` : undefined, text => {
    cancelLocation(); setQuery(text); onOpenPanel(); setOpen('search')
    requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
  })
  const exportMessages = async () => {
    if (exportController.current && !exportController.current.signal.aborted) return
    const controller = new AbortController(); exportController.current = controller
    setExporting(true); setExportCount(0); setNotice(tr('正在读取并校验历史 · 已读取 {v0} 条', { v0: 0 }))
    try {
      const result = await createArkmeSdk().arkoExport(controller.signal, progress => {
        if (!controller.signal.aborted) { setExportCount(progress.count); setNotice(tr('正在读取并校验历史 · 已读取 {v0} 条', { v0: progress.count })) }
      })
      if (controller.signal.aborted) return
      const link = document.createElement('a'); link.href = createArkmeSdk().localFileUrl(result.fileRef, true); link.download = result.fileName
      document.body.append(link); link.click(); link.remove()
      setExportCount(result.count); setNotice(tr('已导出 {v0} 条消息', { v0: result.count }))
    } catch (error) { if (!controller.signal.aborted) setNotice(failText(error)) }
    finally { if (exportController.current === controller) { exportController.current = undefined; if (!controller.signal.aborted) setExporting(false) } }
  }
  return <>
    <ArkmeConversationHeaderIconButton label={tr('按日期查看 Arko 对话')} buttonRef={calendarAnchor} hasPopup="dialog" expanded={open === 'calendar'} onClick={() => toggle('calendar')}><CalendarBlank size={24} aria-hidden /></ArkmeConversationHeaderIconButton>
    <ArkmeConversationHeaderIconButton label={tr('搜索 Arko 对话')} buttonRef={searchAnchor} hasPopup="dialog" expanded={open === 'search'} onClick={() => toggle('search')}><MagnifyingGlass size={24} aria-hidden /></ArkmeConversationHeaderIconButton>
    <ConversationActionsMenu anchor={menuAnchor} label={tr('更多 Arko 操作')} trigger={{ open: open === 'menu', onOpenChange: value => value ? toggle('menu') : setOpen(undefined) }} onClose={() => setOpen(undefined)} items={[
      conversationExportActionItem({ busy: exporting, processed: exportCount, invoke: () => { void exportMessages() } }),
      { id: 'new-context', label: tr('清除上下文'), icon: <ArrowsClockwiseIcon size={20} />, disabled: clearDisabled, invoke: () => { cancelLocation(); onClear() } },
      { id: 'capabilities', label: tr('{v0} 能干什么', { v0: name }), icon: <RobotIcon size={20} />, disabled, invoke: () => { cancelLocation(); onCapabilities(menuAnchor.current) } },
    ]} />
    <ArkmeSelfCalendarPopover open={open === 'calendar'} anchor={calendarAnchor} accountScope={accountScope} scopeKey="arko-history"
      getReadingDate={getReadingDate} onClose={() => setOpen(undefined)} onSelectRecord={() => {}}
      index={{ loadMonth, loading: false, error: '', retry: () => {} }} onSelectIndexedDay={date => { void locateDay(date) }} />
    {host.current && open === 'search' && createPortal(<ArkmeDetailShell title={tr('搜索 Arko 对话')} label={tr('搜索 Arko 对话')} returnFocusRef={searchAnchor} onClose={() => { cancelLocation(); setOpen(undefined) }} bodyStyle={{ padding: '12px 16px' }}>
      <input ref={searchInput} type="search" aria-label={tr('搜索 Arko 关键词')} placeholder={tr('搜索提问和回复')} value={query} onChange={event => setQuery(event.target.value)}
        style={{ width: '100%', height: 36, boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, padding: '0 10px', background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit' }} />
      <p role="status" style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{searching ? tr('正在搜索 · 已扫描 {v0} 条', { v0: page.scanned }) : searchError ? tr('搜索未完成，请重试') : !query.trim() ? tr('输入关键词，查找提问和回复') : page.hasMore ? tr('搜索尚未完成，可继续查找；当前保留最多 200 条匹配') : tr('已扫描到历史末尾；当前窗口最多保留 200 条匹配')}{query.trim() && ` · 当前显示 ${page.items.length} 条匹配`}</p>
      {query.trim() && <button type="button" disabled={searching} style={button} onClick={() => { void search() }}>{tr('重新搜索')}</button>}
      {searchError && <p role="alert" style={{ color: arkmeTheme.danger }}>{searchError}<button type="button" style={button} onClick={() => { void search(page.nextCursor) }}>{tr('重试')}</button></p>}
      {page.items.map(item => <button type="button" key={item.messageKey} data-arko-search-hit={item.messageRef} onClick={() => { void locate(item.messageRef) }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 0', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' }}>
        <span style={{ display: 'block', color: arkmeTheme.secondary, fontSize: 12, marginBottom: 6 }}>{item.role === 'user' ? tr('我') : name} · {new Date(item.createdAtMillis).toLocaleString()}</span>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.6 }}><ArkmeRichText text={item.role === 'assistant' ? arkmeMarkdownPlainText(item.snippet) : item.snippet} presentation="preview" /></span>
      </button>)}
      {page.hasMore && <button type="button" data-arko-search-more disabled={searching} style={button} onClick={() => { void search(page.nextCursor) }}>{page.items.length ? tr('显示更多结果') : tr('继续查找')}</button>}
      {!searching && !searchError && query.trim() && !page.hasMore && page.items.length === 0 && <p>{tr('没有匹配的消息')}</p>}
    </ArkmeDetailShell>, host.current)}
    {host.current && (locationFeedback || notice) && createPortal(<div style={{ position: 'absolute', zIndex: 12, top: 76, right: 16, maxWidth: 'calc(100% - 32px)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      {locationFeedback && <div role="status" style={feedbackStyle}>
        {locationFeedback.text}<button type="button" style={button} onClick={cancelLocation}>{locationFeedback.pending ? tr('取消定位') : tr('关闭')}</button>
      </div>}
      {notice && <div role="status" style={feedbackStyle}>
        {notice}{exporting ? <button type="button" style={button} onClick={() => { exportController.current?.abort(); setExporting(false); setNotice(tr('已取消导出')) }}>{tr('取消')}</button>
          : <button type="button" style={button} onClick={() => setNotice('')}>{tr('关闭')}</button>}
      </div>}
    </div>, host.current)}
  </>
}
