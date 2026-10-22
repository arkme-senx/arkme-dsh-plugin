import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { CheckSquare } from '@phosphor-icons/react/dist/icons/CheckSquare'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import type { ArkmeTimelineItem } from '../types.js'
import type { LocalTranscriptEntry, LocalTranscriptChange } from '../local-transcript-state.js'
import type { MessageUnderlineSnapshot } from '../message-annotations.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeMessageTextSelectionToolbar, useMessageTextSelectionTarget, type MessageSelectionTarget } from './ArkmeMessageTextSelection.js'
import { useMessageUnderlines } from './ArkmeMessageUnderlines.js'
import type { MessageMarkTransport } from './message-underline-session.js'
import { useSelectedMessageSearch } from './message-selection-search.js'
import { applyMessageTextReplacement, resolveMessageTextReplacement } from './message-text-replacement.js'
import { quoteDigest } from './message-quote-selection.js'
import { copyText } from './clipboard-text.js'

export interface TranscriptInteractionRow { id: string; text: string; speaker: string; at: number; playable: boolean }
function TextTarget({ target, children }: { target: MessageSelectionTarget; children: ReactNode }) {
  const ref = useMessageTextSelectionTarget(target.item.textContent, target)
  return <span ref={ref} style={{ cursor: 'text', userSelect: 'text', whiteSpace: 'pre-wrap' }}>{children}</span>
}
const smallButton = { border: 0, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 11, padding: '2px 5px' }
const controlButton = { ...smallButton, border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, color: arkmeTheme.text, padding: '5px 9px', fontSize: 12 }
const message = (e: unknown) => e instanceof Error ? e.message : '本机保存失败，请重试'

type TranscriptMenuPoint = { id: string; x: number; y: number }
type TranscriptMenuHandle = { open(point: TranscriptMenuPoint): void }

/** Opening a menu must not reconcile thousands of transcript rows in its parent. */
const TranscriptContextMenu = forwardRef<TranscriptMenuHandle, {
  rows: TranscriptInteractionRow[]
  onCopy(row: TranscriptInteractionRow): void
  onSelect(row: TranscriptInteractionRow): void
  onPlay(row: TranscriptInteractionRow): void
}>(function TranscriptContextMenu({ rows, onCopy, onSelect, onPlay }, ref) {
  const [point, setPoint] = useState<TranscriptMenuPoint>()
  useImperativeHandle(ref, () => ({ open: setPoint }), [])
  const row = point ? rows.find(row => row.id === point.id) : undefined
  useEffect(() => { if (!row) setPoint(undefined) }, [row])
  if (!point || !row) return null
  const close = () => setPoint(undefined)
  return <ArkmeActionMenu point={point} label="转写操作" onClose={close} autoFocus actions={[
    { id: 'copy', label: '复制', icon: <Copy />, onSelect: () => { close(); onCopy(row) } },
    { id: 'select', label: '多选', icon: <CheckSquare />, onSelect: () => { close(); onSelect(row) } },
    { id: 'play', label: '播放', icon: <Play />, disabled: !row.playable, onSelect: () => { close(); onPlay(row) } },
  ]} />
})

/** Shared transcript commands; local overlays never mutate cloud transcripts or chat records. */
export function useTranscriptInteractions({ scope, rows, enabled = true, onPlay, onStop, playing = false, onMultiSelect, onFind }: {
  scope: string; rows: TranscriptInteractionRow[]; enabled?: boolean
  onPlay(ids: string[]): void; onStop?(): void; playing?: boolean; onMultiSelect?(id: string): void; onFind?(text: string): void
}) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const viewer = auth?.status === 'authenticated' ? auth.userId : undefined
  const key = `${account}:${scope}`, sourceRef = `transcript:${key}`
  const currentKey = useRef(key); currentKey.current = key
  const latest = useRef({ rows, onPlay, onMultiSelect, onFind }); latest.current = { rows, onPlay, onMultiSelect, onFind }
  const [state, setState] = useState<{ key: string; entries: Record<string, LocalTranscriptEntry> }>({ key, entries: {} })
  const entries = state.key === key ? state.entries : {}
  const entriesRef = useRef(entries); entriesRef.current = entries
  const [notice, setNotice] = useState(''), [retry, setRetry] = useState(0)
  const menuRef = useRef<TranscriptMenuHandle>(null)
  const [selected, setSelected] = useState<Set<string>>()
  const [search, setSearch] = useState(''), [matchIndex, setMatchIndex] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const guard = () => { if (!alive.current || currentKey.current !== key) throw new Error('转写页面已切换，请重新选择') }
  const accept = (next: Record<string, LocalTranscriptEntry>) => {
    if (!alive.current || currentKey.current !== key) return
    setState(old => {
      const merged = { ...(old.key === key ? old.entries : {}) }
      let changed = old.key !== key
      for (const [id, entry] of Object.entries(next)) if (!merged[id] || merged[id]!.revision < entry.revision) { merged[id] = entry; changed = true }
      if (!changed) return old
      entriesRef.current = merged
      return { key, entries: merged }
    })
  }
  const read = async (ids: string[], signal?: AbortSignal) => {
    guard()
    const result = await callArkme<Record<string, LocalTranscriptEntry>>('transcript.local.read', { accountKey: account, scope, ids }, signal)
    guard(); accept(result); return result
  }
  const change = async (row: TranscriptInteractionRow, entry: LocalTranscriptEntry | undefined, patch: Partial<LocalTranscriptChange>, signal?: AbortSignal) => {
    guard()
    const result = await callArkme<Record<string, LocalTranscriptEntry>>('transcript.local.change', { accountKey: account, scope, id: row.id,
      change: { id: row.id, original: row.text, expectedRevision: entry?.revision ?? 0, ...patch } }, signal)
    guard(); accept(result); return result[row.id]!
  }
  const idsKey = JSON.stringify(rows.map(row => row.id))
  useEffect(() => {
    if (!account || !enabled) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const ids = JSON.parse(idsKey) as string[]
        for (let i = 0; i < ids.length; i += 200) await read(ids.slice(i, i + 200), controller.signal)
        if (!controller.signal.aborted) setNotice('')
      } catch (error) { if (!controller.signal.aborted && currentKey.current === key) setNotice(message(error)) }
    }
    void refresh(); if (typeof window !== 'undefined') window.addEventListener('focus', refresh)
    return () => { controller.abort(); if (typeof window !== 'undefined') window.removeEventListener('focus', refresh) }
  }, [key, idsKey, enabled, retry])
  useEffect(() => { setSelected(undefined); setSearch(''); setNotice('') }, [key, enabled])
  const display = (row: TranscriptInteractionRow, entry = entriesRef.current[row.id]) => entry?.original === row.text ? entry.text : row.text
  const target = (row: TranscriptInteractionRow): MessageSelectionTarget => {
    const text = display(row)
    return { sourceRef, selectionDomain: 'transcript', localMarkRef: JSON.stringify([row.id, text]),
      item: { itemUid: row.id, senderName: row.speaker, isMe: false, sendAtMillis: row.at, title: '', textContent: text, textFormat: 'plain', status: 1 } }
  }
  const snapshot = async (row: TranscriptInteractionRow, entry: LocalTranscriptEntry | undefined): Promise<MessageUnderlineSnapshot> => {
    if (!entry?.marks.length) return { revision: entry?.revision ?? 0, accessible: true, items: [] }
    const digest = await quoteDigest({ title: '', textContent: display(row, entry), textFormat: 'plain' } as ArkmeTimelineItem)
    return { revision: entry?.revision ?? 0, accessible: true, items: (entry?.marks ?? []).map(mark => ({ ...mark, state: mark.anchor?.sourceDigest === digest ? 'available' : 'stale' })) }
  }
  const transport = useMemo<MessageMarkTransport>(() => ({
    capabilities: async () => ({ supported: !!account && enabled, maxLength: 2000, storage: 'local' }),
    list: async (_source, refs, signal) => {
      const ids = refs.map(ref => (JSON.parse(ref) as string[])[0]!)
      const data = await read(ids, signal)
      return Promise.all(refs.map(async (ref, index) => {
        const row = latest.current.rows.find(row => row.id === ids[index])
        return { actionRef: ref, snapshot: row ? await snapshot(row, data[row.id]) : { revision: 0, accessible: false, items: [] } }
      }))
    },
    change: async (_source, ref, mark, signal) => {
      const [id, text] = JSON.parse(ref) as string[]
      const row = latest.current.rows.find(row => row.id === id)
      if (!row) throw new Error('转写片段已不在当前页面')
      const data = await read([row.id], signal), entry = data[row.id]
      if (display(row, entry) !== text) throw new Error('转写已变化，请重新选择文字')
      return snapshot(row, await change(row, entry, { mark }, signal))
    },
  }), [key, enabled])
  const marks = useMessageUnderlines(key, enabled && account ? sourceRef : undefined, viewer, transport)
  useSelectedMessageSearch(enabled ? sourceRef : undefined, text => {
    if (latest.current.onFind) latest.current.onFind(text)
    else { setSearch(text); setMatchIndex(0) }
  })
  const results: { id: string; start: number; end: number }[] = []
  if (search) for (const row of rows) {
    const text = display(row), haystack = text.toLocaleLowerCase(), needle = search.toLocaleLowerCase()
    let start = 0, at: number
    while ((at = haystack.indexOf(needle, start)) >= 0) { results.push({ id: row.id, start: at, end: at + needle.length }); start = at + needle.length; if (results.length >= 10000) break }
  }
  const activeMatch = results[Math.min(matchIndex, Math.max(0, results.length - 1))]
  useEffect(() => {
    if (!activeMatch) return
    document.querySelector(`[data-transcript-scope="${CSS.escape(sourceRef)}"] [data-transcript-search-active]`)?.scrollIntoView({ block: 'center' })
  }, [sourceRef, activeMatch?.id, activeMatch?.start])
  const copyRows = async (ids: string[]) => {
    try { await copyText(latest.current.rows.filter(row => ids.includes(row.id)).sort((a,b) => a.at - b.at).map(row => `${row.speaker} ${new Date(row.at).toLocaleTimeString()}\n${display(row)}`).join('\n\n')) }
    catch (error) { setNotice(message(error)) }
  }
  const renderText = (row: TranscriptInteractionRow, render?: (text: string) => ReactNode) => {
    const text = display(row), entry = entries[row.id], mine = results.filter(hit => hit.id === row.id)
    let child: ReactNode = render ? render(text) : text
    if (search && mine.length) {
      const parts: ReactNode[] = []; let start = 0
      for (const hit of mine) { parts.push(text.slice(start, hit.start), <mark key={hit.start} data-transcript-search-active={activeMatch === hit || activeMatch?.id === hit.id && activeMatch.start === hit.start || undefined} style={{ background: arkmeTheme.warningSoft, color: 'inherit' }}>{text.slice(hit.start, hit.end)}</mark>); start = hit.end }
      parts.push(text.slice(start)); child = parts
    }
    return <span data-transcript-scope={sourceRef} data-transcript-row={row.id}>
      <TextTarget target={target(row)}>{child}</TextTarget>
      {entry && (entry.text !== entry.original || entry.original !== row.text) && <button type="button" style={smallButton}
        title={`原文：${entry.original}\n本机更正：${entry.text}\n点击恢复当前云端原文`}
        onClick={event => { event.stopPropagation(); void change(row, entry, { restore: true }).catch(e => setNotice(message(e))) }}>
        {entry.original !== row.text ? '原文已更新 · 恢复原文' : '本机更正 · 恢复原文'}
      </button>}
    </span>
  }
  const contextMenu = (row: TranscriptInteractionRow, event: MouseEvent) => {
    if (!enabled) return
    event.preventDefault(); event.stopPropagation()
    // The shared toolbar handles text selections first in document capture phase.
    if (document.getSelection()?.toString().trim()) return
    menuRef.current?.open({ id: row.id, x: event.clientX, y: event.clientY })
  }
  const selectedRows = rows.filter(row => selected?.has(row.id)).sort((a,b) => a.at - b.at)
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const host = enabled && typeof document !== 'undefined' && document.body && typeof window !== 'undefined' ? <>
    <ArkmeMessageTextSelectionToolbar selectionDomain="transcript" replySourceRef={sourceRef} markStorage="local"
      onUnderline={marks.mark} getMarks={marks.getMarks} onRemoveMark={marks.remove} canReplace={() => !!account}
      prepareReplace={async (t, quote, signal) => {
        const row = latest.current.rows.find(row => row.id === t.item.itemUid)
        if (!row) throw new Error('转写片段已变化')
        const data = await read([row.id], signal), entry = data[row.id]
        if (display(row, entry) !== t.item.textContent) throw new Error('转写已更新，请重新选择')
        const range = resolveMessageTextReplacement(t.item, quote)
        return { save: async value => {
          const current = latest.current.rows.find(r => r.id === row.id)
          if (!current || current.text !== row.text) throw new Error('云端原文已更新，请重新选择')
          const text = applyMessageTextReplacement(t.item.textContent, range, value).text
          await change(row, entry, { text }, signal)
        } }
      }} />
    {marks.layer}
    <TranscriptContextMenu key={`menu:${key}`} ref={menuRef} rows={rows}
      onCopy={row => { void copyText(display(row)).catch(e => { if (alive.current && currentKey.current === key) setNotice(message(e)) }) }}
      onSelect={row => { if (latest.current.onMultiSelect) latest.current.onMultiSelect(row.id); else setSelected(new Set([row.id])) }}
      onPlay={row => latest.current.onPlay([row.id])} />
    {notice && <div role="alert" style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000, maxWidth: 'min(420px, calc(100vw - 40px))', padding: '8px 12px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.menu, fontSize: 12, color: arkmeTheme.danger }}>{notice}<button type="button" style={smallButton} onClick={() => setRetry(v => v + 1)}>重试</button></div>}
  </> : null
  const controls = <>
    {search && <div role="search" style={{ position: 'sticky', bottom: 0, background: arkmeTheme.menu, padding: 8, borderRadius: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <input style={{ minWidth: 100, flex: 1, border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, background: arkmeTheme.input, color: arkmeTheme.text, padding: '5px 8px' }} aria-label="查找通话转写" value={search} onChange={e => { setSearch(e.target.value); setMatchIndex(0) }} />
      <span>{results.length ? Math.min(matchIndex + 1, results.length) : 0}/{results.length}</span>
      <button type="button" style={controlButton} disabled={!results.length} onClick={() => setMatchIndex(i => (i - 1 + results.length) % results.length)}>上一处</button>
      <button type="button" style={controlButton} disabled={!results.length} onClick={() => setMatchIndex(i => (i + 1) % results.length)}>下一处</button>
      <button type="button" style={controlButton} onClick={() => setSearch('')}>关闭查找</button>
    </div>}
    {selected && <div role="toolbar" aria-label="转写多选操作" style={{ position: 'sticky', bottom: 0, background: arkmeTheme.menu, padding: 10, display: 'flex', gap: 12, alignItems: 'center', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8 }}>
      <span>已选 {selectedRows.length} 段</span><button type="button" style={controlButton} disabled={!selectedRows.length} onClick={() => { void copyRows(selectedRows.map(r => r.id)) }}>复制</button>
      <button type="button" style={controlButton} disabled={!playing && (!selectedRows.length || selectedRows.some(r => !r.playable))} onClick={() => playing && onStop ? onStop() : latest.current.onPlay(selectedRows.map(r => r.id))}>{playing && onStop ? '停止' : '播放'}</button>
      <button type="button" style={controlButton} onClick={() => setSelected(undefined)}>取消</button>
    </div>}
  </>
  return { host, controls, renderText, contextMenu, text: (row: TranscriptInteractionRow) => display(row), copyRows, selected, toggle,
    checkbox: (row: TranscriptInteractionRow) => selected ? <input type="checkbox" aria-label={`选择 ${row.speaker} 的转写片段`} checked={selected.has(row.id)} onClick={e => e.stopPropagation()} onChange={() => toggle(row.id)} /> : null }
}
