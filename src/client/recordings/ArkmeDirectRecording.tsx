import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { arkmeUi } from '../ui-controller.js'
import { directRecordingStore as store, type DirectRecordingAccount } from './direct-recording-store.js'
import { useRecordingBreathStyle } from './recording-breath.js'

const owners = new Map<symbol, DirectRecordingAccount>()

const button: CSSProperties = { minHeight: 36, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.base, color: theme.text, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }
const primary: CSSProperties = { ...button, background: theme.primaryAction, color: theme.onPrimaryAction }
export function recordingClock(millis: number): string {
  const seconds = Math.floor(Math.max(0, millis) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}
export function useDirectRecordingOwner(accountKey: string | undefined, userId: number | undefined, importPath: string, enabled: boolean, onAccepted: () => void) {
  const [phase, setPhase] = useState(store.getSnapshot().phase)
  const [volatile, setVolatile] = useState(store.getSnapshot().volatile)
  const accepted = useRef(onAccepted); accepted.current = onAccepted
  const revision = useRef(0)
  useEffect(() => {
    const owner = Symbol('recording-owner')
    const account = accountKey && userId && enabled ? { key: accountKey, userId, importPath } : undefined
    if (account) owners.set(owner, account)
    store.configure(account ?? [...owners.values()].at(-1))
    // Inactive routes retain their owner; removing the entire plugin must release the microphone.
    return () => { owners.delete(owner); store.configure([...owners.values()].at(-1)) }
  }, [accountKey, userId, importPath, enabled])
  useEffect(() => {
    const changed = () => {
      const snapshot = store.getSnapshot()
      setPhase(previous => previous === snapshot.phase ? previous : snapshot.phase)
      setVolatile(snapshot.volatile)
      if (snapshot.acceptedRevision > revision.current) accepted.current()
      revision.current = snapshot.acceptedRevision
    }
    changed(); return store.subscribe(changed)
  }, [])
  useEffect(() => {
    if (phase === 'idle' && !volatile) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const pageHide = () => { void store.stop() }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', pageHide)
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', pageHide) }
  }, [phase, volatile])
  useEffect(() => {
    if (phase !== 'recording' || !navigator.wakeLock) return
    let disposed = false
    let sentinel: WakeLockSentinel | undefined
    const acquire = () => {
      if (document.visibilityState !== 'visible' || sentinel) return
      void navigator.wakeLock.request('screen').then(value => {
        if (disposed) { void value.release(); return }
        sentinel = value; value.addEventListener('release', () => { sentinel = undefined })
      }).catch(() => { /* Browser/OS may deny wake locks; UI explicitly warns against sleep. */ })
    }
    acquire(); document.addEventListener('visibilitychange', acquire)
    return () => { disposed = true; document.removeEventListener('visibilitychange', acquire); void sentinel?.release() }
  }, [phase])
}

export function ArkmeDirectRecordingButton({ onStart }: { onStart(): void }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const recording = state.phase === 'recording'
  const breathStyle = useRecordingBreathStyle(recording, state.startedAt)
  return <button type="button" data-arkme-feedback="neutral" style={{ ...primary, ...breathStyle, opacity: state.phase === 'idle' ? 1 : .65 }}
    disabled={state.phase !== 'idle' || !state.accountKey}
    onClick={() => { onStart(); void store.start() }}><Microphone size={16} aria-hidden data-arkme-recording-breath={recording ? 'icon' : undefined} />{state.phase === 'starting' ? '正在准备…' : '开始录音'}</button>
}

export function ArkmeDirectRecordingStatus({ floating = false, onShowTasks }: { floating?: boolean; onShowTasks?(): void }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const breathStyle = useRecordingBreathStyle(state.phase === 'recording', state.startedAt)
  if (!state.accountKey || (floating && state.phase === 'idle') || (!floating && state.phase === 'idle' && !state.pending.length && !state.error && !state.message)) return null
  const recording = state.phase === 'recording'
  const download = async (id: string) => {
    const file = await store.download(id)
    if (!file) return
    const url = URL.createObjectURL(file); const link = document.createElement('a')
    link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const content = <section aria-label="直接录音状态" data-arkme-direct-recording={floating ? 'floating' : 'calendar'}
    style={{ ...breathStyle, marginTop: floating ? 0 : 12, padding: '12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.layer2, color: theme.text, fontSize: 13, lineHeight: '20px', minWidth: 0,
      ...(floating ? { position: 'fixed', bottom: 20, right: 24, zIndex: 80, maxWidth: 'calc(100vw - 48px)', boxSizing: 'border-box', boxShadow: theme.shadow } : {}) }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
      {recording && <span data-arkme-recording-breath="dot" aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: theme.danger }} />}
      <span role="status">{recording ? '正在录音' : state.message || '本机录音'}</span>
      {(recording || state.phase === 'saving') && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{recordingClock(state.elapsedMillis)}</span>}
      {floating && <button type="button" style={button} onClick={() => arkmeUi.showRecordings()}>查看录音</button>}
      {recording && <button type="button" style={{ ...primary, marginLeft: 'auto' }} onClick={() => { void store.stop() }}>结束并保存</button>}
      {state.phase === 'uploading' && <span>{Math.floor(state.progress * 100)}%</span>}
    </div>
    {!floating && recording && <>
      <div aria-label="麦克风音量" style={{ display: 'flex', height: 24, alignItems: 'center', gap: 3, margin: '8px 0' }}>
        {state.levels.map((level, index) => <i key={index} style={{ width: 4, height: Math.max(2, Math.min(24, level * 48)), borderRadius: 2, background: theme.accent }} />)}
      </div>
      <div style={{ color: theme.secondary, fontSize: 12 }}>本次最长 {Math.round(state.maxMillis / 60000)} 分钟 · 请勿关闭页面或让电脑休眠</div>
    </>}
    {state.error && <div role="alert" style={{ marginTop: 8, color: theme.danger }}>{state.error}</div>}
    {!floating && state.phase === 'idle' && state.pending.length > 0 && <div style={{ marginTop: 8 }}>
      <div style={{ color: theme.secondary }}>待提交录音（仅当前浏览器保存）</div>
      {state.pending.map(record => <div key={record.id} style={{ paddingTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere' }}>{new Date(record.startedAt).toLocaleString('zh-CN')} · {recordingClock(record.bytes / (record.sampleRate * 2) * 1000)}{!record.finished ? ' · 恢复的录音' : ''}</span>
        <button type="button" style={button} onClick={() => { void store.upload(record.id) }}>重试上传</button>
        <button type="button" style={button} onClick={() => { void download(record.id) }}>下载备份</button>
      </div>)}
    </div>}
    {!floating && state.acceptedRevision > 0 && onShowTasks && <button type="button" style={{ ...button, marginTop: 8 }} onClick={onShowTasks}>查看处理进度</button>}
  </section>
  // DSH/contact routes hide the conversation layer; the recording controls must remain operable.
  return floating && typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
