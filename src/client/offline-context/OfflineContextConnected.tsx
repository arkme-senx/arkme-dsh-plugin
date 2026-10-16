import { useCallback, useEffect, useId, useMemo, useState, useRef, useSyncExternalStore } from 'react'
import { createArkmeSdk } from '../../sdk/index.js'
import type { OfflineContextCommand, OfflineContextCommandResult, OfflineContextList, OfflineContextPreview, OfflineContextTranscript, OfflineContextPlayback, OfflineContextCoverage, OfflineContextCapability, OfflineContextRangeOptions } from '../../offline-context-contract.js'
import type { OfflineContextActions, OfflineContextEntry } from '../../offline-context.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../../types.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { arkmeUi } from '../ui-controller.js'
import { OfflineContextMessagePicker } from './OfflineContextMessagePicker.js'
import { OfflineContextCard } from './OfflineContextCard.js'
import { tr } from '../locale.js'
import { arkmeChatTimelineDelta } from '../chat-directory-store.js'

const sdk = createArkmeSdk()
type Options = { messageRef: string; label: string }[]
export function offlineRelinkOptions(items: ArkmeTimelineItem[]): Options {
  return items.flatMap(item => item.offlineContextMessageRef ? [{ messageRef: item.offlineContextMessageRef, label: (item.textContent || item.title || tr('附件消息')).slice(0, 120) }] : [])
}

/** Lazy detail reads keep unrelated history independent of Audio availability. */
export function OfflineContextConnected({ entryRef, revision, title, source, relinkOptions = [], onChanged }: {
  entryRef: string; revision: string; title: string; source?: ArkmeSourceItem; relinkOptions?: Options; onChanged?(): void
}) {
  const [open, setOpen] = useState(false)
  return <div style={{ padding: '8px 12px' }}>
    {!open ? <button type="button" onClick={() => setOpen(true)}>{tr('线下交流')} · {title || tr('查看关联')} · {tr('仅你可见')}</button>
      : <ConnectedCard key={entryRef} entryRef={entryRef} revision={revision} {...(source ? { source } : {})} relinkOptions={relinkOptions} {...(onChanged ? { onChanged } : {})} />}
  </div>
}
function ConnectedCard({ entryRef, revision, source, relinkOptions, onChanged }: {
  entryRef: string; revision: string; source?: ArkmeSourceItem; relinkOptions: Options; onChanged?: () => void
}) {
  const [entry, setEntry] = useState<OfflineContextEntry>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [pending, setPending] = useState<OfflineContextCommandResult[]>()
  const [playback, setPlayback] = useState<OfflineContextPlayback>()
  const [transcript, setTranscript] = useState<OfflineContextTranscript>()
  const id = useId()
  const lifecycle = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller
    return () => controller.abort()
  }, [entryRef, source?.sourceRef])
  // Reads are cancelled on account/conversation unmount. Mutations are owned by
  // the durable Host journal and are never retried by a component lifecycle.
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setPending(undefined); setEntry(undefined); setTranscript(undefined); setPlayback(undefined)
    void Promise.all([
      sdk.offlineContext({ operation: 'read', entryRef }, controller.signal),
      sdk.offlineContext({ operation: 'pending' }, controller.signal),
    ]).then(([value, operations]) => {
      if (controller.signal.aborted) return
      setEntry(value as OfflineContextEntry)
      setPending((operations as OfflineContextCommandResult[]).filter(v => v.entryRef === entryRef && (v.outcome === 'pending' || v.outcome === 'unknown')))
    }).catch(() => { if (!controller.signal.aborted) setError(tr('关联暂不可用，请重新读取。')) })
    return () => controller.abort()
  }, [entryRef, revision, refresh])
  const changed = useCallback(() => { if (lifecycle.current?.signal.aborted) return; setRefresh(n => n + 1); onChanged?.() }, [onChanged])
  const actions = useMemo<OfflineContextActions>(() => ({
    rangeOptions: async (entry, signal) => await sdk.offlineContext({ operation: 'range-options', entryRef: entry.id, revision: entry.revision }, signal) as OfflineContextRangeOptions,
    preview: async (entry, includeTranscript, signal) => await sdk.offlineContext({ operation: 'preview', entryRef: entry.id, revision: entry.revision, includeTranscript }, signal) as OfflineContextPreview,
    change: async action => {
      const base = { requestId: action.requestId, entryRef: action.entryId, revision: action.expectedRevision }
      const change = action.change
      let command: OfflineContextCommand
      switch (change.kind) {
        case 'confirm': case 'restore': case 'withdraw': command = { ...base, action: change.kind }; break
        case 'dismiss': command = { ...base, action: 'dismiss', reason: change.reason }; break
        case 'range': command = { ...base, action: 'range', evidenceRefs: change.evidenceIds, ...(change.startOffset === undefined ? {} : { startOffset: change.startOffset }), ...(change.endOffset === undefined ? {} : { endOffset: change.endOffset }) }; break
        case 'relink': command = { ...base, action: 'relink', messageRef: change.messageRef }; break
        case 'share': if (!change.previewRef) return { status: 'not_applied' }; command = { ...base, action: 'share', previewRef: change.previewRef }; break
      }
      const result = await sdk.offlineContext({ operation: 'command', command }) as OfflineContextCommandResult
      if (result.outcome === 'applied') { changed(); return { status: 'applied' } }
      if (result.outcome === 'not_applied') { changed(); return { status: 'not_applied' } }
      return { status: 'unknown' }
    },
    reconcile: async action => {
      const result = await sdk.offlineContext({ operation: 'result', entryRef: action.entryId, requestId: action.requestId }) as OfflineContextCommandResult
      if (result.outcome === 'applied' || result.outcome === 'not_applied') { changed(); return result.outcome }
      return 'pending'
    },
    openMessage: async messageRef => {
      if (!source) throw new Error('Conversation unavailable')
      const signal = lifecycle.current?.signal
      const page = await sdk.readChatTimeline(source.sourceRef, { mode: 'around', messageRef }, signal)
      signal?.throwIfAborted()
      const item = page.items.find(item => item.offlineContextMessageRef === messageRef)
      if (!item) throw new Error('Message unavailable')
      arkmeUi.showConversationTarget(source, item.itemUid, item.sendAtMillis, item.recordOwnerUserId)
    },
    openTranscript: async transcriptRef => { const signal = lifecycle.current?.signal; const value = await sdk.offlineContext({ operation: 'transcript', transcriptRef }, signal); signal?.throwIfAborted(); setTranscript(value as OfflineContextTranscript) },
    play: async playbackRef => { const signal = lifecycle.current?.signal; const value = await sdk.offlineContext({ operation: 'playback', playbackRef }, signal); signal?.throwIfAborted(); setPlayback(value as OfflineContextPlayback) },
  }), [changed, source])
  return <>
    {error && <p role="alert">{error}<button type="button" onClick={() => setRefresh(n => n + 1)}>{tr('重新读取')}</button></p>}
    {entry ? <OfflineContextCard renderMessagePicker={(selected, onSelect) => <OfflineContextMessagePicker selected={selected} onSelect={onSelect} />} entry={entry} actions={actions} relinkOptions={relinkOptions} recoveryPending={pending === undefined || pending.length > 0} /> : !error && <p role="status">{tr('正在读取关联…')}</p>}
    {!!pending?.length && <p role="status">{tr('有操作尚未确认，已暂停新的修改。')}<button type="button" onClick={() => setRefresh(n => n + 1)}>{tr('核对状态')}</button></p>}
    {playback && <ArkmeConfirmDialog layout="picker" titleId={id} title={tr('回听所选原文')} busy={false} onClose={() => setPlayback(undefined)}>
      {playback.clips.map((clip, index) => <audio key={clip.playbackRef} controls aria-label={`${tr('原文音频')} ${index + 1}`} src={sdk.mediaUrl(clip.playbackRef)}
        onLoadedMetadata={event => { event.currentTarget.currentTime = clip.startOffsetMillis / 1000 }}
        onTimeUpdate={event => { const audio = event.currentTarget; if (audio.currentTime >= clip.endOffsetMillis / 1000) audio.pause() }}
        onSeeking={event => { const audio = event.currentTarget; const start = clip.startOffsetMillis / 1000, end = clip.endOffsetMillis / 1000; if (audio.currentTime < start || audio.currentTime > end) audio.currentTime = start }} />)}
    </ArkmeConfirmDialog>}
    {transcript && <ArkmeConfirmDialog layout="picker" titleId={id} title={tr('转写原文')} busy={false} onClose={() => setTranscript(undefined)}>
      <p style={{ whiteSpace: 'pre-wrap' }}>{Array.from(transcript.text).slice(0, transcript.from).join('')}<mark>{Array.from(transcript.text).slice(transcript.from, transcript.to).join('')}</mark>{Array.from(transcript.text).slice(transcript.to).join('')}</p>
    </ArkmeConfirmDialog>}
  </>
}

export function OfflineContextCandidates({ source, items, onChanged }: { source: ArkmeSourceItem; items: ArkmeTimelineItem[]; onChanged(): void }) {
  const [open, setOpen] = useState(false)
  const [supported, setSupported] = useState(false)
  const [coverage, setCoverage] = useState<OfflineContextCoverage>()
  const [state, setState] = useState<'suggested' | 'dismissed'>('suggested')
  const [page, setPage] = useState<OfflineContextList>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const id = useId()
  const pageController = useRef<AbortController | undefined>(undefined)
  const invalidation = useSyncExternalStore(arkmeChatTimelineDelta.subscribe, () => arkmeChatTimelineDelta.getSnapshotForSource(source.sourceKey ?? source.sourceRef).invalidationRevision, () => 0)
  useEffect(() => {
    const controller = new AbortController()
    void sdk.offlineContext({ operation: 'capability' }, controller.signal).then(value => {
      if (!controller.signal.aborted) setSupported((value as OfflineContextCapability).supported)
    }).catch(() => { if (!controller.signal.aborted) setSupported(false) })
    return () => controller.abort()
  }, [source.sourceRef])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(); pageController.current = controller; setBusy(true); setError(''); setPage(undefined); setCoverage(undefined)
    void Promise.all([sdk.offlineContext({ operation: 'list', sourceRef: source.sourceRef, state }, controller.signal), sdk.offlineContext({ operation: 'coverage', sourceRef: source.sourceRef }, controller.signal)]).then(([value, observation]) => {
      if (!controller.signal.aborted) { setPage(value as OfflineContextList); setCoverage(observation as OfflineContextCoverage) }
    }).catch(() => { if (!controller.signal.aborted) setError(tr('暂时无法读取候选')) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [open, source.sourceRef, state, refresh, invalidation])
  const relinkOptions = useMemo(() => offlineRelinkOptions(items), [items])
  if (!supported) return null
  const latest = coverage?.observations[0]
  return <><button type="button" onClick={() => setOpen(true)}>{tr('线下交流')}</button>
    {open && <ArkmeConfirmDialog layout="picker" titleId={id} title={tr('线下交流关联')} busy={false} onClose={() => setOpen(false)}>
      {latest && <p role="status">{new Date(latest.startAtMillis).toLocaleString()}–{new Date(latest.endAtMillis).toLocaleString()}：{!latest.complete ? tr('正在核对录音与消息') : latest.issues.length ? tr('部分来源尚未完成核对') : !latest.evidenceSeen ? tr('检查时未发现可用录音') : latest.matches === 0 ? tr('已检查，未找到足够证据的关联') : tr('已完成本次检查')} · {tr('检查时间')} {new Date(latest.observedAtMillis).toLocaleString()}</p>}
      <label>{tr('查看')}<select value={state} onChange={e => setState(e.target.value as typeof state)}><option value="suggested">{tr('待确认')}</option><option value="dismissed">{tr('已移除')}</option></select></label>
      {busy && <p role="status">{tr('正在读取…')}</p>}{error && <p role="alert">{error}<button type="button" onClick={() => setRefresh(v => v + 1)}>{tr('重试')}</button></p>}
      {page?.entries.map(entry => <ConnectedCard key={entry.id} entryRef={entry.id} revision={entry.revision} source={source} relinkOptions={relinkOptions} onChanged={() => { setRefresh(v => v + 1); onChanged() }} />)}
      {page && !page.entries.length && <p>{tr('当前没有待展示的关联；这不代表没有录音或没有线下交流。')}</p>}
      {page?.nextCursor && <button type="button" disabled={busy} onClick={() => {
        const signal = pageController.current?.signal
        if (!signal || signal.aborted) return
        setBusy(true); setError('')
        void sdk.offlineContext({ operation: 'list', sourceRef: source.sourceRef, state, cursor: page.nextCursor! }, signal).then(value => {
          if (signal.aborted) return
          const next = value as OfflineContextList; setPage({ ...next, entries: [...page.entries, ...next.entries] })
        }).catch(() => { if (!signal.aborted) setError(tr('读取失败，请重试')) }).finally(() => { if (!signal.aborted) setBusy(false) })
      }}>{tr('加载更多')}</button>}
    </ArkmeConfirmDialog>}
  </>
}
