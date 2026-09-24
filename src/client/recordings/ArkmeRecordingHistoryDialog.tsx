import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { RecordingHistoryItem, RecordingHistoryPage } from '../../recording-history.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'

const buttonStyle = { border: 0, borderRadius: 6, padding: '6px 10px', background: 'transparent', color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }
function duration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}

/** Parent remounts by account/environment; pending requests are aborted on close. */
export function ArkmeRecordingHistoryDialog({ onClose }: { onClose: () => void }) {
  useArkmeLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [request, setRequest] = useState({ cursor: '', attempt: 0 })
  const [items, setItems] = useState<RecordingHistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setStatus('loading')
    void withArkmeReadDeadline(signal => callArkme<RecordingHistoryPage>('recordings.history', { cursor: request.cursor }, signal), controller.signal)
      .then(page => {
        if (!live) return
        setItems(previous => [...new Map([...previous, ...page.items].map(item => [item.recordingId, item])).values()]
          .sort((a, b) => b.startedAt - a.startedAt || b.recordingId.localeCompare(a.recordingId)))
        setNextCursor(page.nextCursor); setHasMore(page.hasMore); setStatus('ready')
      }, () => { if (live) setStatus('error') })
    return () => { live = false; controller.abort() }
  }, [request])
  const content = <dialog ref={dialog} aria-label={tr('最近录音记录')} aria-modal="true"
    onCancel={event => { event.preventDefault(); close.current() }}
    style={{ width: 'min(840px, calc(100vw - 40px))', maxHeight: 'min(640px, calc(100vh - 48px))', padding: 0, border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.base, color: theme.text, boxShadow: theme.shadow, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${theme.border}` }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{tr('最近录音记录')}</h2>
      <button type="button" data-arkme-feedback="neutral" aria-label={tr('关闭录音记录')} onClick={onClose} style={{ ...buttonStyle, width: 36, height: 36, padding: 0, flexShrink: 0, display: 'grid', placeItems: 'center' }}><X size={20} aria-hidden /></button>
    </div>
    <div style={{ padding: '0 20px 16px', maxHeight: 'min(540px, calc(100vh - 140px))', overflowY: 'auto' }}>
      <p style={{ fontSize: 12, color: theme.secondary }}>{tr('各设备同步的录音记录，按开始时间倒序')}</p>
      <table style={{ width: '100%', minWidth: 650, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left', fontSize: 13 }}>
        <thead><tr>{['开始时间', '录音设备', '录音模式', '累计时长', '状态'].map((label, index) => <th key={label} scope="col" style={{ position: 'sticky', top: 0, zIndex: 1, background: theme.base, padding: '12px 8px', width: [170, 200, 100, 100, 100][index], boxSizing: 'border-box', borderBottom: `1px solid ${theme.border}`, color: theme.secondary, fontWeight: 500 }}>{tr(label)}</th>)}</tr></thead>
        <tbody>{items.map(item => {
          const stale = item.state !== 'stopped' && item.freshness === 'stale'
          const state = stale ? 'stale' : item.state
          const labels = { recording: '录音中', paused: '已暂停', interrupted: '已中断', error: '录音异常', stopped: '已停止', stale: '状态待确认' }
          const cell = { padding: '14px 8px', borderBottom: `1px solid ${theme.border}`, verticalAlign: 'top' as const }
          const confirmation = item.state === 'stopped' ? tr('服务端确认停止') + '：' + new Date(item.stoppedAt).toLocaleString() : tr('最后确认') + '：' + new Date(item.lastConfirmedAt).toLocaleString()
          return <tr key={item.recordingId}>
            <td style={cell}><div>{new Date(item.startedAt).toLocaleDateString()}</div><div style={{ color: theme.secondary, marginTop: 4 }}>{new Date(item.startedAt).toLocaleTimeString()}</div></td>
            <td style={cell}><div title={item.deviceName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.deviceName}</div><div style={{ color: theme.secondary, marginTop: 4, fontSize: 12 }}>{item.platform}</div></td>
            <td style={cell}>{tr(item.recordingMode === 'all_day' ? '全天候录音' : '长录音')}</td>
            <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }} title={confirmation}>{duration(item.elapsedMillis)}{stale && <div style={{ fontSize: 11, marginTop: 4, color: theme.secondary }}>{tr('最后确认')}</div>}</td>
            <td style={cell} title={confirmation}><span style={{ display: 'inline-block', padding: '3px 6px', borderRadius: 4, background: theme.layer2, color: state === 'recording' ? theme.danger : theme.secondary }}>{tr(labels[state])}</span></td>
          </tr>
        })}</tbody>
      </table>
      <div style={{ paddingTop: 16, textAlign: 'center', color: theme.secondary, fontSize: 13 }}>
        {status === 'loading' && <span role="status">{tr('正在加载录音记录…')}</span>}
        {status === 'error' && <div role="alert">{tr('录音记录加载失败')} <button type="button" data-arkme-feedback="neutral" style={buttonStyle} onClick={() => setRequest(value => ({ ...value, attempt: value.attempt + 1 }))}>{tr('重试')}</button></div>}
        {status === 'ready' && items.length === 0 && !hasMore && <span>{tr('暂无录音记录')}</span>}
        {status === 'ready' && hasMore && <button type="button" data-arkme-feedback="neutral" style={buttonStyle} onClick={() => { setStatus('loading'); setRequest(value => ({ cursor: nextCursor, attempt: value.attempt + 1 })) }}>{tr('加载更多')}</button>}
      </div>
    </div>
  </dialog>
  return createPortal(content, document.body)
}
