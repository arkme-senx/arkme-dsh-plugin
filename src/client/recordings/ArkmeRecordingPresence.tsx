import { useEffect, useState, useSyncExternalStore } from 'react'
import { DeviceMobile } from '@phosphor-icons/react/dist/icons/DeviceMobile'
import { Desktop } from '@phosphor-icons/react/dist/icons/Desktop'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { recordingPresenceDisplay, type RecordingPresenceSnapshot } from '../../recording-presence.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'
import { directRecordingStore } from './direct-recording-store.js'

import { ArkmeRecordingHistoryDialog } from './ArkmeRecordingHistoryDialog.js'

interface Props { accountKey: string | undefined; active: boolean }
interface Sample { snapshot: RecordingPresenceSnapshot; receivedAt: number }

/** Remount on account/environment change so old rows cannot flash or accept late responses. */
export function ArkmeRecordingPresence({ accountKey, active }: Props) {
  return accountKey ? <PresenceList key={accountKey} accountKey={accountKey} active={active} /> : null
}
function clock(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000)
  const parts = [Math.floor(total / 60) % 60, total % 60]
  if (total >= 3600) parts.unshift(Math.floor(total / 3600))
  return parts.map(part => String(part).padStart(2, '0')).join(':')
}
function PresenceList({ accountKey, active }: { accountKey: string; active: boolean }) {
  useArkmeLocale()
  const local = useSyncExternalStore(directRecordingStore.subscribe, directRecordingStore.getSnapshot, directRecordingStore.getSnapshot)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sample, setSample] = useState<Sample>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'disabled'>('loading')
  const [now, setNow] = useState(0)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!active) return
    let generation = 0
    let controller: AbortController | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let clockTimer: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      generation++
      controller?.abort()
      clearTimeout(pollTimer)
      clearInterval(clockTimer)
    }
    const start = () => {
      stop()
      if (document.visibilityState === 'hidden') return
      const current = generation
      setNow(performance.now())
      clockTimer = setInterval(() => setNow(performance.now()), 1000)
      let interval = 10000
      const poll = async () => {
        controller = new AbortController()
        let disabled = false
        try {
          const snapshot = await withArkmeReadDeadline(signal => callArkme<RecordingPresenceSnapshot>('recordings.presence', {}, signal), controller.signal)
          if (current !== generation) return
          const receivedAt = performance.now()
          setSample({ snapshot, receivedAt }); setNow(receivedAt); setStatus('ready')
          interval = snapshot.pollIntervalMillis
        } catch (error) {
          if (current !== generation) return
          disabled = (error as { body?: { code?: string } } | null)?.body?.code === 'arkme-code-1201'
          setStatus(disabled ? 'disabled' : 'error')
          if (disabled) setSample(undefined)
        } finally {
          if (current === generation && !disabled) pollTimer = setTimeout(() => { void poll() }, interval)
        }
      }
      void poll()
    }
    document.addEventListener('visibilitychange', start)
    window.addEventListener('focus', start)
    start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', start)
      window.removeEventListener('focus', start)
    }
  }, [active, retry])
  const serverNow = sample ? sample.snapshot.serverNow + Math.max(0, now - sample.receivedAt) : 0
  const ownAccount = local.accountKey === accountKey
  const stoppedIds = new Set(ownAccount ? local.stoppedRecordingIds : [])
  const rows = (sample?.snapshot.items ?? []).map(item => {
    const display = recordingPresenceDisplay(item, serverNow)
    // Keep one server-owned row; only its running clock is supplied by actual local PCM.
    if (ownAccount && item.recordingId === local.recordingId && local.phase === 'recording' && display.state === 'recording') {
      display.elapsedMillis = local.elapsedMillis
    }
    return { item, display }
  }).filter(row => row.display.visible && !stoppedIds.has(row.item.recordingId))
  const labels = { recording: '录音中', paused: '已暂停', interrupted: '已中断', error: '录音异常', stopped: '已停止', stale: '状态待确认' }
  return <section aria-label={tr('设备录音状态')} style={{ marginTop: 16, minWidth: 0, padding: 12, boxSizing: 'border-box', border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{tr('设备录音状态')}</h3>
      <button type="button" data-arkme-feedback="neutral" onClick={() => setHistoryOpen(true)} style={{ border: 0, borderRadius: 4, padding: '4px 6px', background: 'transparent', color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 12 }}>{tr('录音记录')}</button>
    </div>
    {historyOpen && <ArkmeRecordingHistoryDialog onClose={() => setHistoryOpen(false)} />}
    {status !== 'ready' && <div role="status" style={{ color: theme.secondary, fontSize: 12, lineHeight: '20px', marginBottom: 8 }}>
      {tr(status === 'loading' ? '正在同步设备录音状态…' : status === 'disabled' ? '设备录音状态暂未启用' : '同步暂时失败，正在重试')}
      {(status === 'error' || status === 'disabled') && <button type="button" onClick={() => setRetry(value => value + 1)} style={{ marginLeft: 8, border: 0, background: 'transparent', color: theme.text, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>{tr('重试')}</button>}
    </div>}
    {status === 'ready' && rows.length === 0 && <p style={{ margin: 0, color: theme.secondary, fontSize: 12 }}>{tr('暂无设备上报录音状态')}</p>}
    {rows.length > 0 && <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflowY: 'auto' }}>
      {rows.map(({ item, display }, index) => {
        const Icon = item.clientType === 'mobile' ? DeviceMobile : item.clientType === 'web' ? Globe : Desktop
        const recording = display.state === 'recording'
        return <li key={item.recordingId} style={{ padding: '10px 0', display: 'flex', alignItems: 'flex-start', gap: 8, borderTop: index === 0 ? undefined : `1px solid ${theme.border}` }}>
          <Icon size={18} aria-hidden style={{ flexShrink: 0, marginTop: 2, color: theme.secondary }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span title={item.deviceName} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.deviceName}</span>
              <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: recording ? theme.danger : theme.secondary }}>
                {recording && <span aria-hidden data-arkme-recording-breath="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />}{tr(labels[display.state])}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4, marginTop: 4, color: theme.secondary, fontSize: 12 }}>
              <span>{tr(item.recordingMode === 'all_day' ? '全天候录音' : '长录音')}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{display.state === 'stale' && <>{tr('最后确认')} </>}{clock(display.elapsedMillis)}</span>
            </div>
          </div>
        </li>
      })}
    </ul>}
  </section>
}
