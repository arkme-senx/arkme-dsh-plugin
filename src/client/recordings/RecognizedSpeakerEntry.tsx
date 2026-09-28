import { useEffect, useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { ArkmeRecordingSpeakerCandidate } from '../../types.js'
import { tr, useArkmeLocale } from '../locale.js'
import { markedSpeakerKeys, recognizedSpeakerTracker } from '../recognized-speaker-tracker.js'
import { RecognizedSpeakerDirectory, recognizedSpeakerDirectory, readSpeakerOptions as loadMarked, readSpeakerPage as loadPage, readSpeakerPresence, speakerRetryDelay } from '../recognized-speaker-directory.js'

export function RecognizedSpeakerEntry({ accountKey, active, onOpen, style, readMarked = loadMarked, readPage = loadPage, directory: providedDirectory }: {
  accountKey?: string | undefined
  active: boolean
  onOpen(): void
  style: CSSProperties | undefined
  readMarked?: typeof loadMarked
  readPage?: typeof loadPage
  directory?: RecognizedSpeakerDirectory
}) {
  useArkmeLocale()
  const directory = useMemo(() => providedDirectory ?? (readMarked === loadMarked && readPage === loadPage ? recognizedSpeakerDirectory
    : new RecognizedSpeakerDirectory({ marked: readMarked, page: readPage, presence: readSpeakerPresence }, 0)), [providedDirectory, readMarked, readPage])
  const snapshot = useSyncExternalStore(recognizedSpeakerTracker.subscribe, () => recognizedSpeakerTracker.get(accountKey), () => recognizedSpeakerTracker.get(accountKey))
  useEffect(() => {
    if (!active || accountKey === undefined) return
    const controller = new AbortController()
    let busy = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (busy || controller.signal.aborted || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      busy = true
      try {
        let marked: ArkmeRecordingSpeakerCandidate[] | undefined
        const updateTotal = () => {
          const value = directory.peekCandidates(accountKey)
          if (marked !== undefined && value?.total !== undefined && !controller.signal.aborted) {
            recognizedSpeakerTracker.setTotal(accountKey, markedSpeakerKeys(marked).length + value.total)
          }
        }
        const [, result] = await Promise.all([
          directory.readMarked(accountKey, controller.signal).then(value => { marked = value; updateTotal() }),
          directory.readCandidates(accountKey, controller.signal, updateTotal),
        ])
        if (controller.signal.aborted) return
        if (result.complete && marked !== undefined) recognizedSpeakerTracker.observe(accountKey, marked, result.items)
        else recognizedSpeakerTracker.uncertain(accountKey)
      } catch (error) {
        if (!controller.signal.aborted) {
          recognizedSpeakerTracker.uncertain(accountKey)
          const delay = speakerRetryDelay(error)
          if (delay !== undefined) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { void refresh() }, delay) }
        }
      }
      finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60_000)
    const onVisible = () => { void refresh() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => { controller.abort(); clearInterval(timer); clearTimeout(retryTimer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible) }
  }, [accountKey, active, directory])
  return <button data-arkme-feedback="recording-action" type="button" style={{ ...style, flexDirection: 'column', minWidth: 0, fontSize: 13 }} onClick={onOpen}>
    <span style={{ display: 'flex', maxWidth: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <UsersThree size={16} style={{ flexShrink: 0 }} aria-hidden /><span title={tr('已识别说话人')} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr('已识别说话人')}</span>
      {snapshot.total !== undefined && <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{snapshot.total}</span>}<CaretRight size={12} style={{ flexShrink: 0 }} aria-hidden />
    </span>
    {(snapshot.newCount ?? 0) > 0 && <span style={{ fontSize: 11, lineHeight: '15px', fontWeight: 400 }} aria-live="polite">{tr('新识别 {v0} 个', { v0: snapshot.newCount! })}</span>}
  </button>
}
