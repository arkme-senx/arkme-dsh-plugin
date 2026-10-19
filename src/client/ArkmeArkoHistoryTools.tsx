import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import type { ArkmeArkoHistoryItem, ArkmeArkoHistoryPage } from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeConversationHeaderIconButton } from './ArkmeGroupChatControls.js'
import { ArkmeSelfCalendarPopover } from './ArkmeCalendarSurface.js'
import { ConversationActionsMenu, conversationExportActionItem } from './PrivateChatActions.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { downloadArkmeConversationMarkdown } from './conversation-export.js'
import { arkoHistoryDate, arkoHistoryDays, arkoHistoryKey, exportArkoHistory, readArkoHistory, searchArkoHistory } from './arko-history-browser.js'
import { tr } from './locale.js'

const button: CSSProperties = { border: 0, padding: '6px 8px', borderRadius: 6, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 12 }
type Archive = { items: ArkmeArkoHistoryItem[]; loading: boolean; complete: boolean; error: string }
export function ArkmeArkoHistoryTools({ accountScope, name, host, disabled, clearDisabled, detailOpen, onClear, onCapabilities, onLocate, onOpenPanel, getReadingDate }: {
  accountScope: string; name: string; host: RefObject<HTMLDivElement>; disabled: boolean; clearDisabled: boolean
  detailOpen: boolean
  onClear(): void; onCapabilities(trigger: HTMLButtonElement | null): void; onOpenPanel(): void
  onLocate(items: ArkmeArkoHistoryItem[], item: ArkmeArkoHistoryItem): void
  getReadingDate(): string | undefined
}) {
  const calendarAnchor = useRef<HTMLButtonElement>(null), menuAnchor = useRef<HTMLButtonElement>(null)
  const searchAnchor = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<'calendar' | 'search' | 'menu'>()
  const [query, setQuery] = useState(''), [visibleCount, setVisibleCount] = useState(50)
  const [archive, setArchive] = useState<Archive>({ items: [], loading: false, complete: false, error: '' })
  const [exporting, setExporting] = useState(false), [exportNotice, setExportNotice] = useState('')
  const controller = useRef<AbortController>(), inFlight = useRef<Promise<ArkmeArkoHistoryItem[]>>()
  useEffect(() => () => { controller.current?.abort() }, [accountScope])
  useEffect(() => { if (detailOpen) setOpen(undefined) }, [detailOpen])
  useEffect(() => {
    if (open !== 'search') return
    const frame = requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])
  const read = () => {
    if (inFlight.current) return inFlight.current
    const current = new AbortController(); controller.current = current
    setArchive(previous => ({ ...previous, loading: true, complete: false, error: '' }))
    const task = readArkoHistory((offset, signal) => callArkme<ArkmeArkoHistoryPage>('arko.history', { limit: 50, offset }, signal), current.signal,
      items => { if (!current.signal.aborted) setArchive({ items, loading: true, complete: false, error: '' }) })
      .then(items => { if (!current.signal.aborted) setArchive({ items, loading: false, complete: true, error: '' }); return items })
      .catch((error: unknown) => { if (!current.signal.aborted) setArchive(previous => ({ ...previous, loading: false, complete: false, error: error instanceof Error ? error.message : tr('读取失败') })); throw error })
      .finally(() => { if (controller.current === current) inFlight.current = undefined })
    inFlight.current = task
    return task
  }
  const toggle = (next: 'calendar' | 'search' | 'menu') => {
    if (open === next) { setOpen(undefined); return }
    if (next !== 'menu') onOpenPanel(); setOpen(next)
    if (next !== 'menu') void read().catch(() => {})
  }
  const exportMessages = async () => {
    if (exporting) return
    setExporting(true); setExportNotice('正在读取对话记录…')
    const task = read(), current = controller.current!
    try {
      const items = await task
      if (current.signal.aborted) return
      const fileName = `${name.replace(/[\\/:*?"<>|\r\n]/g, '_')}-对话-${arkoHistoryDate(Date.now())}.md`
      downloadArkmeConversationMarkdown(fileName, exportArkoHistory(items, name))
      setExportNotice(tr('已导出 {v0} 条消息', { v0: items.length }))
    } catch (error) {
      if (!current.signal.aborted) setExportNotice(error instanceof Error ? error.message : tr('导出失败，请重试'))
    } finally { if (!current.signal.aborted) setExporting(false) }
  }
  const days = useMemo(() => arkoHistoryDays(archive.items), [archive.items])
  const hits = useMemo(() => searchArkoHistory(archive.items, query), [archive.items, query])
  const progress = archive.loading ? tr('正在读取历史 · 已读取 {v0} 条', { v0: archive.items.length })
    : archive.complete ? tr('已读取 {v0} 条历史', { v0: archive.items.length }) : tr('当前结果不完整 · 已读取 {v0} 条', { v0: archive.items.length })
  return <>
    <ArkmeConversationHeaderIconButton label={tr('按日期查看 Arko 对话')} buttonRef={calendarAnchor} hasPopup="dialog" expanded={open === 'calendar'} onClick={() => toggle('calendar')}><CalendarBlank size={24} aria-hidden /></ArkmeConversationHeaderIconButton>
    <ArkmeConversationHeaderIconButton label={tr('搜索 Arko 对话')} buttonRef={searchAnchor} hasPopup="dialog" expanded={open === 'search'} onClick={() => toggle('search')}><MagnifyingGlass size={24} aria-hidden /></ArkmeConversationHeaderIconButton>
    <ConversationActionsMenu anchor={menuAnchor} label={tr('更多 Arko 操作')} trigger={{ open: open === 'menu', onOpenChange: value => value ? toggle('menu') : setOpen(undefined) }} onClose={() => setOpen(undefined)} items={[
      conversationExportActionItem({ busy: exporting, processed: archive.items.length, invoke: () => { void exportMessages() } }),
      { id: 'new-context', label: tr('清除上下文'), icon: <ArrowsClockwiseIcon size={20} />, disabled: clearDisabled, invoke: onClear },
      { id: 'capabilities', label: tr('{v0} 能干什么', { v0: name }), icon: <RobotIcon size={20} />, disabled, invoke: () => onCapabilities(menuAnchor.current) },
    ]} />
    <ArkmeSelfCalendarPopover open={open === 'calendar'} anchor={calendarAnchor} accountScope={accountScope} scopeKey="arko-history"
      getReadingDate={getReadingDate} onClose={() => setOpen(undefined)} onSelectRecord={() => {}}
      index={{ value: { days }, loading: archive.loading, error: archive.error, incomplete: !archive.complete, notice: progress, retry: () => { void read().catch(() => {}) } }}
      onSelectIndexedDay={date => { const item = archive.items.find(item => arkoHistoryDate(item.createdAtMillis) === date); if (item) onLocate(archive.items, item) }} />
    {host.current && open === 'search' && createPortal(<ArkmeDetailShell title={tr('搜索 Arko 对话')} label={tr('搜索 Arko 对话')} returnFocusRef={searchAnchor}
      onClose={() => setOpen(undefined)} bodyStyle={{ padding: '12px 16px' }}>
      <input ref={searchInput} type="search" aria-label={tr('搜索 Arko 关键词')} placeholder={tr('搜索提问和回复')} value={query}
        onChange={event => { setQuery(event.target.value); setVisibleCount(50) }}
        style={{ width: '100%', height: 36, boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, padding: '0 10px', background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit' }} />
      <p role="status" style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{progress}{query.trim() && ` · ${hits.length} 条匹配`}</p>
      {archive.error && <p role="alert" style={{ color: arkmeTheme.danger, fontSize: 12 }}>{archive.error}<button type="button" style={button} onClick={() => { void read().catch(() => {}) }}>{tr('重试')}</button></p>}
      {hits.slice(0, visibleCount).map(item => <button type="button" key={arkoHistoryKey(item)} data-arko-search-hit={item.messageId}
        onClick={() => { onLocate(archive.items, item); setOpen(undefined) }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 0', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' }}>
        <span style={{ display: 'block', color: arkmeTheme.secondary, fontSize: 12, marginBottom: 6 }}>{item.role === 'user' ? tr('我') : name} · {arkoHistoryDate(item.createdAtMillis) ? new Date(item.createdAtMillis).toLocaleString() : tr('时间未提供')}</span>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.6 }}><ArkmeRichText text={item.role === 'assistant' ? arkmeMarkdownPlainText(item.text) : item.text} presentation="preview" /></span>
      </button>)}
      {hits.length > visibleCount && <button type="button" style={button} onClick={() => setVisibleCount(value => value + 50)}>{tr('显示更多结果')}</button>}
      {archive.complete && query.trim() && hits.length === 0 && <p style={{ color: arkmeTheme.secondary, fontSize: 13 }}>{tr('没有匹配的消息')}</p>}
      {!query.trim() && <p style={{ color: arkmeTheme.secondary, fontSize: 13 }}>{tr('输入关键词，查找提问和回复')}</p>}
    </ArkmeDetailShell>, host.current)}
    {host.current && exportNotice && createPortal(<div role="status" style={{ position: 'absolute', zIndex: 12, top: 76, right: 16, maxWidth: 'calc(100% - 32px)', padding: '8px 12px', borderRadius: 8, background: arkmeTheme.layer2, color: arkmeTheme.secondary, border: `1px solid ${arkmeTheme.border}`, fontSize: 12 }}>
      {exporting ? progress : exportNotice}
      {exporting ? <button type="button" style={button} onClick={() => { controller.current?.abort(); inFlight.current = undefined; setExporting(false); setExportNotice('已取消导出'); setArchive(value => ({ ...value, loading: false, complete: false })) }}>{tr('取消')}</button>
        : <button type="button" style={button} onClick={() => setExportNotice('')}>{tr('关闭')}</button>}
    </div>, host.current)}
  </>
}
