import { tr } from './locale.js'
import type { PersonalTranscriptEntry, TranscriptViewCommand } from '../transcript-view-contract.js'
import type { ArkmeMessageQuote } from '../message-quote.js'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { CheckSquare } from '@phosphor-icons/react/dist/icons/CheckSquare'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import type { ArkmeTimelineItem } from '../types.js'
import type { MessageUnderlineChange } from '../message-annotations.js'
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

export interface TranscriptInteractionRow { id: string; text: string; speaker: string; at: number; playable: boolean;viewRef?:string;sourceVersion?:string;excerptOrigin?:{kind:'recording'|'call';itemRef:string};excerptSource?:import('../record-excerpt.js').RecordExcerptSource }
function TextTarget({ target, children }: { target: MessageSelectionTarget; children: ReactNode }) {
  const ref = useMessageTextSelectionTarget(target.item.textContent, target)
  return <span ref={ref} style={{ cursor: 'text', userSelect: 'text', whiteSpace: 'pre-wrap' }}>{children}</span>
}
const smallButton = { border: 0, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 11, padding: '2px 5px' }
const controlButton = { ...smallButton, border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, color: arkmeTheme.text, padding: '5px 9px', fontSize: 12 }
const message = (e: unknown) => e instanceof Error ? e.message : '云端保存失败，请重试'

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

/** Private transcript views share selection UI; ASR and chat facts retain their owners. */
export function useTranscriptInteractions({ scope, rows, enabled = true, onPlay, onStop, playing = false, onMultiSelect, onFind, onPublish }: {
  scope: string; rows: TranscriptInteractionRow[]; enabled?: boolean
  onPlay(ids: string[]): void; onStop?(): void; playing?: boolean; onMultiSelect?(id: string): void; onFind?(text: string): void; onPublish?(ids:string[]):void
}) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const viewer = auth?.status === 'authenticated' ? auth.userId : undefined
  const key = `${account}:${scope}`, sourceRef = `transcript:${key}`
  const currentKey = useRef(key), accessEpoch = useRef(0)
  if(currentKey.current!==key)accessEpoch.current++
  currentKey.current=key
  const epoch=accessEpoch.current
  const latest = useRef({ rows, onPlay, onMultiSelect, onFind }); latest.current = { rows, onPlay, onMultiSelect, onFind }
  const [state, setState] = useState<{ epoch: number; entries: Record<string, PersonalTranscriptEntry> }>({ epoch, entries: {} })
  const entries = state.epoch === epoch ? state.entries : {}
  const entriesRef = useRef(entries); entriesRef.current = entries
  const [notice, setNotice] = useState(''), [retry, setRetry] = useState(0)
  const menuRef = useRef<TranscriptMenuHandle>(null)
  const [selected, setSelected] = useState<Set<string>>()
  const restoring = useRef(new Set<string>())
  const [search, setSearch] = useState(''), [matchIndex, setMatchIndex] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const failure = (error: unknown, notify = true) => {
    if (!alive.current || currentKey.current !== key || accessEpoch.current !== epoch) return
    const body = (error as {body?:{code?:string;httpStatus?:number}})?.body
    if (body?.code === 'transcript-source-unavailable' || body?.code === 'transcript-account-changed' || [401,403].includes(body?.httpStatus ?? 0)) {
      accessEpoch.current++
      entriesRef.current = {}
      setState({ epoch: accessEpoch.current, entries: {} })
      setSelected(undefined)
      notify = true
    }
    if (notify) setNotice(message(error))
  }
  const guard = () => { if (!alive.current || currentKey.current !== key || accessEpoch.current !== epoch) throw new Error('转写页面已切换，请重新选择') }
  const accept = (next: Record<string, PersonalTranscriptEntry>,force=false) => {
    const selection=typeof window==='undefined'?null:window.getSelection?.();const anchor=selection?.toString()?(selection.anchorNode instanceof Element?selection.anchorNode:selection.anchorNode?.parentElement)?.closest<HTMLElement>('[data-transcript-row]'):null;const selectedId=anchor?.dataset.transcriptScope===sourceRef?anchor.dataset.transcriptRow:undefined;
    if (!alive.current || currentKey.current !== key || accessEpoch.current !== epoch) return
    setState(old => {
      if (accessEpoch.current !== epoch) return old
      const merged = { ...(old.epoch === epoch ? old.entries : {}) }
      let changed = old.epoch !== epoch
      for (const [id, entry] of Object.entries(next)) if ((force||id!==selectedId)&&(!merged[id] || merged[id]!.revision <= entry.revision && JSON.stringify(merged[id]) !== JSON.stringify(entry))) { merged[id] = entry; changed = true }
      if (!changed) return old
      entriesRef.current = merged
      return { epoch, entries: merged }
    })
  }
  const read = async (ids: string[], signal?: AbortSignal,watch=false) => {
    guard()
    const items=ids.flatMap(id=>{const row=latest.current.rows.find(r=>r.id===id);const prior=entriesRef.current[id];return row?.viewRef?[{id,ref:row.viewRef,...(watch&&prior&&prior.originalVersion===row.sourceVersion?{knownRevision:prior.revision,knownOriginalVersion:prior.originalVersion,...(prior.pendingCommand?{knownPendingOperationId:prior.pendingCommand.operation_id}:{})}:{})}]:[]})
    if(!items.length)return {}
    const result = await callArkme<Record<string,PersonalTranscriptEntry>>('transcript.views.read', { accountKey: account, scope, items }, signal).catch(error => { failure(error, false); throw error })
    guard(); accept(result); return result
  }
  const change = async (row: TranscriptInteractionRow, entry: PersonalTranscriptEntry | undefined, patch: {restore?:boolean;mark?:MessageUnderlineChange;anchor?:ArkmeMessageQuote;replacement?:string;operationId?:string}, signal?: AbortSignal) => {
    guard()
    if(!row.viewRef||!entry)throw new Error('正在读取云端更正，请稍后重试')
    if(entry.legacy&&!patch.restore)throw new Error('这段文字有本机更正，请先选择同步到账号；原数据已保留')
    const command:TranscriptViewCommand={operation_id:patch.operationId??patch.mark?.operationId??crypto.randomUUID(),expected_revision:entry.revision,original_version:entry.originalVersion,
      action:patch.restore?'restore':patch.mark?.kind==='add'?'add_mark':patch.mark?.kind==='remove'?'remove_mark':'replace',
      ...(patch.anchor?{anchor:patch.anchor}:{}),...(patch.replacement!==undefined?{replacement:patch.replacement}:{}),
      ...(patch.mark?.kind==='add'?{anchor:patch.mark.anchor}:{}),...(patch.mark?.kind==='remove'?{annotation_id:patch.mark.annotationId}:{})}
    const result=await callArkme<PersonalTranscriptEntry>('transcript.views.change',{accountKey:account,ref:row.viewRef,command},signal).catch(error => { failure(error, false); throw error })
    guard();accept({[row.id]:result},true);return result
  }
  const restore = (row: TranscriptInteractionRow, entry: PersonalTranscriptEntry) => {
    const target = JSON.stringify([account, row.viewRef])
    if (restoring.current.has(target)) return
    restoring.current.add(target)
    void change(row, entry, { restore: true })
      .catch(failure)
      .finally(() => { restoring.current.delete(target) })
  }
  const currentRead=useRef(read);currentRead.current=read
  const idsKey = JSON.stringify(rows.map(row => [row.id,row.sourceVersion,row.viewRef]))
  useEffect(() => {
    if (!account || !enabled || typeof window === 'undefined' || typeof document === 'undefined' || typeof window.getSelection !== 'function') return
    const controller = new AbortController()
    let loading=false
    const refresh = async () => {
      if(loading||controller.signal.aborted)return
      loading=true
      const requestEpoch=accessEpoch.current
      try {
        const ids = (JSON.parse(idsKey) as string[][]).map(row=>row[0]!)
        for (let i = 0; i < ids.length; i += 40) await currentRead.current(ids.slice(i, i + 40), controller.signal,true)
        if (!controller.signal.aborted && accessEpoch.current === requestEpoch) setNotice('')
      } catch (error) { if (!controller.signal.aborted && currentKey.current === key && accessEpoch.current === requestEpoch) setNotice(message(error)) } finally {loading=false}
    }
    const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh()},15000)
    const selectionChanged=()=>{if(!window.getSelection()?.toString())void refresh()}
    void refresh(); if (typeof window !== 'undefined') window.addEventListener('focus', refresh);document.addEventListener('selectionchange',selectionChanged)
    return () => { clearInterval(timer);controller.abort(); if (typeof window !== 'undefined') window.removeEventListener('focus', refresh);document.removeEventListener('selectionchange',selectionChanged) }
  }, [key, idsKey, enabled, retry])
  useEffect(() => { setSelected(undefined); setSearch(''); setNotice('') }, [key, enabled])
  const display = (row: TranscriptInteractionRow, entry = entriesRef.current[row.id]) => entry && entry.originalVersion === row.sourceVersion ? (entry.legacy?.original === entry.original ? entry.legacy.text : entry.text) : row.text
  const target = (row: TranscriptInteractionRow): MessageSelectionTarget => {
    const text = display(row)
    return { sourceRef,...(row.excerptOrigin?{excerptOrigin:row.excerptOrigin}:{}),...(row.excerptSource?{excerptSource:row.excerptSource}:{}),selectionDomain: 'transcript', localMarkRef: JSON.stringify([row.id, text]),
      item: { itemUid: row.id, senderName: row.speaker, isMe: false, sendAtMillis: row.at, title: '', textContent: text, textFormat: 'plain', status: 1 } }
  }
  const snapshot = async (row: TranscriptInteractionRow, entry: PersonalTranscriptEntry | undefined): Promise<MessageUnderlineSnapshot> => {
    if (!(entry?.legacy?.marks??entry?.marks)?.length) return { revision: entry?.revision ?? 0, accessible: true, items: [] }
    const digest = await quoteDigest({ title: '', textContent: display(row, entry), textFormat: 'plain' } as ArkmeTimelineItem)
    return { revision: entry?.revision ?? 0, accessible: true, items: (entry?.legacy?.marks ?? entry?.marks ?? []).map(mark => ({ ...mark, state: mark.state === 'stale' || mark.anchor?.sourceDigest !== digest ? 'stale' : 'available' })) }
  }
  const hasPrivateRows = rows.some(row => !!row.viewRef)
  const canChange = (target: MessageSelectionTarget) => !!account && !!latest.current.rows.find(row => row.id === target.item.itemUid)?.viewRef
  const transport = useMemo<MessageMarkTransport>(() => ({
    retainOnReadError:true,
    capabilities: async (_source,signal) => {const caps=await callArkme<{supported:boolean;protocol_version:number}>('transcript.views.capabilities',{},signal);return {supported:!!account&&enabled&&caps.supported&&caps.protocol_version===1,maxLength:2000,storage:'cloud',requiresBaseRevision:true}},
    list: async (_source, refs, signal) => {
      const ids = refs.map(ref => (JSON.parse(ref) as string[])[0]!)
      const data = await read(ids, signal)
      return Promise.all(refs.map(async (ref, index) => {
        const row = latest.current.rows.find(row => row.id === ids[index])
        return { actionRef: ref, snapshot: row?.viewRef ? await snapshot(row, data[row.id]) : { revision: 0, accessible: false, items: [] } }
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
  }), [key, enabled, epoch, hasPrivateRows])
  const marks = useMessageUnderlines(`${key}:${epoch}`, enabled && account && hasPrivateRows ? sourceRef : undefined, viewer, transport, 'cloud')
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
      {enabled && row.viewRef && entry && !entry.legacy && entry.originalVersion === row.sourceVersion
        && (entry.originalChanged || entry.text !== entry.original) && <button type="button" style={smallButton}
          title={`${tr('原文')}：${entry.original}\n${tr('个人更正')}：${entry.previousText ?? entry.text}`}
          onClick={event => { event.stopPropagation(); restore(row, entry) }}>
          {tr(entry.originalChanged ? '原文已更新 · 恢复原文' : '个人更正 · 恢复原文')}
        </button>}
      {entry?.pendingCommand && row.viewRef && <button type="button" style={smallButton} title={tr('上次保存结果尚未确认，点击重试')} onClick={() => {void callArkme<PersonalTranscriptEntry>('transcript.views.change',{accountKey:account,ref:row.viewRef,command:{operation_id:crypto.randomUUID(),expected_revision:entry.revision,original_version:entry.originalVersion,action:'retry_pending'}}).then(next=>accept({[row.id]:next},true)).catch(error=>{failure(error);setRetry(v=>v+1)})}}>{tr('重试上次提交')}</button>}
      {entry?.legacy && <button type="button" style={smallButton} title={`本机更正：${entry.legacy.text}\n原数据将保留，确认后仅同步到自己的账号`}
        onClick={event=>{event.stopPropagation();if(!row.viewRef)return;void callArkme<PersonalTranscriptEntry>('transcript.views.import',{accountKey:account,scope,item:{id:row.id,ref:row.viewRef},operationId:crypto.randomUUID()}).then(next=>accept({[row.id]:next},true)).catch(failure)}}>本机更正 · 同步到账号</button>}
      {entry?.legacy&&<button type="button" style={smallButton} title="保留本机旧数据，使用当前账号的云端原文" onClick={event => { event.stopPropagation(); restore(row, entry) }}>使用云端原文</button>}
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
    <ArkmeMessageTextSelectionToolbar key={`toolbar:${key}:${epoch}`} selectionDomain="transcript" replySourceRef={sourceRef} markStorage="cloud" selfNote={{ sourceLabel: scope.startsWith('call:') ? '通话转写' : '录音转写', accountKey: account }}
      onUnderline={marks.mark} getMarks={marks.getMarks} onRemoveMark={marks.remove} canMark={canChange} canReplace={canChange}
      prepareReplace={async (t, quote, signal) => {
        const row = latest.current.rows.find(row => row.id === t.item.itemUid)
        if (!row) throw new Error('转写片段已变化')
        const data = await read([row.id], signal), entry = data[row.id]
        if (display(row, entry) !== t.item.textContent) throw new Error('转写已更新，请重新选择')
        const operationId=crypto.randomUUID()
        const range = resolveMessageTextReplacement(t.item, quote)
        return { save: async value => {
          const current = latest.current.rows.find(r => r.id === row.id)
          if (!current || current.text !== row.text) throw new Error('云端原文已更新，请重新选择')
          applyMessageTextReplacement(t.item.textContent, range, value)
          await change(row, entry, { anchor:quote,replacement:value,operationId }, signal)
        } }
      }} />
    {marks.layer}
    <TranscriptContextMenu key={`menu:${key}:${epoch}`} ref={menuRef} rows={rows}
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
      {onPublish&&<button type="button" style={controlButton} disabled={!selectedRows.length||selectedRows.length>150||selectedRows.some(r=>!r.playable)} onClick={()=>onPublish(selectedRows.map(r=>r.id))}>发到世界</button>}
      <button type="button" style={controlButton} onClick={() => setSelected(undefined)}>取消</button>
    </div>}
  </>
  return { host, controls, renderText, contextMenu,ready:rows.every(row=>!row.viewRef||entries[row.id]?.originalVersion===row.sourceVersion),error:notice, text: (row: TranscriptInteractionRow) => display(row), copyRows, selected, toggle,
    checkbox: (row: TranscriptInteractionRow) => selected ? <input type="checkbox" aria-label={`选择 ${row.speaker} 的转写片段`} checked={selected.has(row.id)} onClick={e => e.stopPropagation()} onChange={() => toggle(row.id)} /> : null }
}
