import { useCallback, useEffect, useId, useMemo, useState, useRef, useSyncExternalStore } from 'react'
import { createArkmeSdk } from '../../sdk/index.js'
import type { OfflineContextCommand, OfflineContextCommandResult, OfflineContextList, OfflineContextPreview, OfflineContextTranscript, OfflineContextPlayback, OfflineContextCapability, OfflineContextRangeOptions } from '../../offline-context-contract.js'
import type { OfflineContextActions, OfflineContextEntry } from '../../offline-context.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../../types.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { arkmeUi } from '../ui-controller.js'
import { OfflineContextMessagePicker } from './OfflineContextMessagePicker.js'
import { OfflineContextPending } from './OfflineContextPending.js'
import { OfflineContextCard } from './OfflineContextCard.js'
import { tr } from '../locale.js'
import { arkmeChatTimelineDelta } from '../chat-directory-store.js'

const sdk = createArkmeSdk()
type Options = { messageRef: string; label: string }[]
export function offlineRelinkOptions(items: ArkmeTimelineItem[]): Options {
  return items.flatMap(item => item.offlineContextMessageRef ? [{ messageRef: item.offlineContextMessageRef, label: (item.textContent || item.title || tr('附件消息')).slice(0, 120) }] : [])
}

/** Render the original card directly; data loading must not add a user action. */
export function OfflineContextConnected({ entryRef, revision, source, relinkOptions = [], onChanged }: {
  entryRef: string; revision: string; title: string; source?: ArkmeSourceItem; relinkOptions?: Options; onChanged?(): void
}) {
  return <ConnectedCard key={entryRef} entryRef={entryRef} revision={revision} {...(source ? { source } : {})} relinkOptions={relinkOptions} {...(onChanged ? { onChanged } : {})} />
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
      if (!lifecycle.current?.signal.aborted) {
        setPending(values => [...(values ?? []).filter(value => value.requestId !== result.requestId), { ...result, entryRef: action.entryId }])
      }
      return { status: 'unknown' }
    },
    reconcile: async action => {
      const result = await sdk.offlineContext({ operation: 'result', entryRef: action.entryId, requestId: action.requestId }) as OfflineContextCommandResult
      if (result.outcome === 'applied' || result.outcome === 'not_applied') { changed(); return result.outcome }
      const operations = await sdk.offlineContext({ operation: 'pending' }) as OfflineContextCommandResult[]
      if (!lifecycle.current?.signal.aborted) {
        setPending(operations.filter(value => value.entryRef === action.entryId && (value.outcome === 'pending' || value.outcome === 'unknown')))
      }
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
    {!!pending?.length && <p role="status">{tr('有操作尚未确认，已暂停新的修改。')}<button type="button" onClick={() => setRefresh(n => n + 1)}>{tr('核对状态')}</button>
      {entry && pending.filter(operation => operation.outcome === 'unknown').map(operation => <button type="button" key={operation.requestId} onClick={() => {
        void sdk.offlineContext({ operation: 'command', command: { action: 'retry', entryRef, revision: entry.revision, requestId: operation.requestId } })
          .then(changed).catch(() => { if (!lifecycle.current?.signal.aborted) setError(tr('重试未能确认结果，请稍后核对状态。')) })
      }}>{tr('重试原操作')}</button>)}
    </p>}
    {playback && <ArkmeConfirmDialog titleId={id} title={tr('回听所选原文')} description={tr('播放本次交流所选的录音片段。')} busy={false} confirmLabel={tr('知道了')} busyLabel="" onConfirm={() => setPlayback(undefined)} onClose={() => setPlayback(undefined)}>
      {playback.clips.map((clip, index) => <audio key={clip.playbackRef} controls aria-label={`${tr('原文音频')} ${index + 1}`} src={sdk.mediaUrl(clip.playbackRef)}
        onLoadedMetadata={event => { event.currentTarget.currentTime = clip.startOffsetMillis / 1000 }}
        onTimeUpdate={event => { const audio = event.currentTarget; if (audio.currentTime >= clip.endOffsetMillis / 1000) audio.pause() }}
        onSeeking={event => { const audio = event.currentTarget; const start = clip.startOffsetMillis / 1000, end = clip.endOffsetMillis / 1000; if (audio.currentTime < start || audio.currentTime > end) audio.currentTime = start }} />)}
    </ArkmeConfirmDialog>}
    {transcript && <ArkmeConfirmDialog titleId={id} title={tr('转写原文')} description={tr('高亮部分为本次交流引用的原文。')} busy={false} confirmLabel={tr('知道了')} busyLabel="" onConfirm={() => setTranscript(undefined)} onClose={() => setTranscript(undefined)}>
      <p style={{ whiteSpace: 'pre-wrap' }}>{Array.from(transcript.text).slice(0, transcript.from).join('')}<mark>{Array.from(transcript.text).slice(transcript.from, transcript.to).join('')}</mark>{Array.from(transcript.text).slice(transcript.to).join('')}</p>
    </ArkmeConfirmDialog>}
  </>
}

export function OfflineContextCandidates(props: { source: ArkmeSourceItem; items: ArkmeTimelineItem[]; state?: 'suggested' | 'dismissed'; onChanged(): void }) {
  // The keyed lifetime prevents a late result from crossing conversations.
  return <CandidateList key={`${props.source.sourceRef}:${props.state ?? 'suggested'}`} {...props} />
}

function CandidateList({ source, items, state = 'suggested', onChanged }: {
  source: ArkmeSourceItem; items: ArkmeTimelineItem[]; state?: 'suggested' | 'dismissed'; onChanged(): void
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<OfflineContextList>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const pageController = useRef<AbortController | undefined>(undefined)
  const invalidation = useSyncExternalStore(arkmeChatTimelineDelta.subscribe, () => arkmeChatTimelineDelta.getSnapshotForSource(source.sourceKey ?? source.sourceRef).invalidationRevision, () => 0)
  useEffect(() => {
    const controller = new AbortController(); pageController.current = controller; setBusy(true); setError('')
    void sdk.offlineContext({ operation: 'capability' }, controller.signal).catch(() => undefined).then(async value => {
      if (controller.signal.aborted) return
      if (!(value as OfflineContextCapability | undefined)?.supported) { setPage(undefined); return }
      const result = await sdk.offlineContext({ operation: 'list', sourceRef: source.sourceRef, state }, controller.signal)
      if (!controller.signal.aborted) setPage(result as OfflineContextList)
    }).catch(() => { if (!controller.signal.aborted) setError(tr('暂时无法读取线下交流，请重试。')) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [source.sourceRef, state, refresh, invalidation])
  const relinkOptions = useMemo(() => offlineRelinkOptions(items), [items])
  const failure = error && <p role="alert">{error}<button type="button" disabled={busy} onClick={() => setRefresh(v => v + 1)}>{tr('重试')}</button></p>
  if (!page?.entries.length) return failure || null
  const content = <>
    {busy && <p role="status">{tr('正在读取…')}</p>}{failure}
    {page.entries.map(entry => <ConnectedCard key={entry.id} entryRef={entry.id} revision={entry.revision} source={source} relinkOptions={relinkOptions} onChanged={() => { setRefresh(v => v + 1); onChanged() }} />)}
    {page.nextCursor && <button type="button" disabled={busy} onClick={() => {
      const signal = pageController.current?.signal
      if (!signal || signal.aborted) return
      setBusy(true); setError('')
      void sdk.offlineContext({ operation: 'list', sourceRef: source.sourceRef, state, cursor: page.nextCursor! }, signal).then(value => {
        if (signal.aborted) return
        const next = value as OfflineContextList
        const entries = new Map([...page.entries, ...next.entries].map(entry => [entry.id, entry]))
        setPage({ ...next, entries: [...entries.values()] })
      }).catch(() => { if (!signal.aborted) setError(tr('读取失败，请重试')) }).finally(() => { if (!signal.aborted) setBusy(false) })
    }}>{tr('加载更多')}</button>}
  </>
  return state === 'dismissed' ? content : <OfflineContextPending count={page.entries.length} hasMore={!!page.nextCursor} open={open} onToggle={() => setOpen(value => !value)}>{content}</OfflineContextPending>
}
