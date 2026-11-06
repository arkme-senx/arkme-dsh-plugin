import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { callArkme } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'
import type { LocalRecorderAudio, LocalRecorderDevice, LocalRecorderSnapshot, LocalRecorderRecordingPage } from '../../local-recorder/contract.js'
import type { PublicRecordingImportJob } from '../../recording-import-contract.js'
import { tr } from '../locale.js'

const button: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${arkmeTheme.border}`,
  background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' }
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`
const duration = (millis: number) => `${Math.floor(millis / 3600000).toString().padStart(2, '0')}:${Math.floor(millis / 60000 % 60).toString().padStart(2, '0')}:${Math.floor(millis / 1000 % 60).toString().padStart(2, '0')}`
const localDate = (stamp: number | null) => stamp === null ? '' : new Date(stamp - new Date(stamp).getTimezoneOffset() * 60000).toISOString().slice(0, 23)

export function LocalRecorderEntry({ style, accountKey, mediaPath, onShowImports }: {
  style?: CSSProperties | undefined; accountKey?: string | undefined; mediaPath: string; onShowImports(): void
}) {
  const [open, setOpen] = useState(false)
  return <><button type="button" style={style ?? button} aria-haspopup="dialog" aria-expanded={open}
    onClick={() => setOpen(true)}>{tr('本地设备')}</button>
    {open && <LocalRecorderPanel key={accountKey} mediaPath={mediaPath} onClose={() => setOpen(false)} onShowImports={onShowImports} />}</>
}

export function LocalRecorderPanel({ mediaPath, onClose, onShowImports }: { mediaPath: string; onClose(): void; onShowImports(): void }) {
  const [snapshot, setSnapshot] = useState<LocalRecorderSnapshot>()
  const [deviceId, setDeviceId] = useState(''), [recordingId, setRecordingId] = useState('')
  const [pending, setPending] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [prepared, setPrepared] = useState<{ recordingId: string; audio: LocalRecorderAudio }>()
  const [startAt, setStartAt] = useState(''), [ownership, setOwnership] = useState<'self' | 'other'>('self')
  const lifetime = useRef<AbortController | undefined>(undefined), audio = useRef<HTMLAudioElement>(null)
  const panel = useRef<HTMLElement>(null)
  const device = snapshot?.devices.find(row => row.id === deviceId) ?? snapshot?.devices[0]
  const recording = device?.recordings.find(row => row.id === recordingId)
  const mediaUrl = (ref: string, download = false) => `${mediaPath.replace(/\/media$/, '')}/recording/local-audio?ref=${encodeURIComponent(ref)}${download ? '&download=1' : ''}`
  const acceptSnapshot = (value: LocalRecorderSnapshot) => { setSnapshot(previous => ({ ...value, devices: value.devices.map(row => {
    const old = previous?.devices.find(item => item.id === row.id && item.updatedAtMillis === row.updatedAtMillis)
    return old && old.recordings.length > row.recordings.length ? { ...row, recordings: old.recordings } : row
  }) })) }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try { const value = await callArkme<LocalRecorderSnapshot>('recorders.local.snapshot', {}, controller.signal); if (!controller.signal.aborted) acceptSnapshot(value) }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '本地设备读取失败') }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 2000) }
    }
    void poll()
    const previousFocus = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, audio, a[href]')
        const first = nodes?.[0], last = nodes?.[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', escape)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('keydown', escape); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  useEffect(() => { setPrepared(undefined); setStartAt(localDate(recording?.startAtMillis ?? null)); setNotice('') }, [recording?.id])
  const action = async (name: string, run: () => Promise<void>) => {
    if (pending) return
    setPending(name); setError(''); setNotice('')
    try { await run() } catch (cause) { if (!lifetime.current?.signal.aborted) setError(cause instanceof Error ? cause.message : '设备操作未完成') }
    finally { if (!lifetime.current?.signal.aborted) setPending('') }
  }
  const selectDevice = (row: LocalRecorderDevice) => { setDeviceId(row.id); setRecordingId(''); setPrepared(undefined) }
  const prepare = async (download: boolean) => {
    if (!device || !recording) return
    const result = await callArkme<LocalRecorderAudio>('recorders.local.prepare', { deviceId: device.id, recordingId: recording.id }, lifetime.current?.signal)
    if (lifetime.current?.signal.aborted) return
    setPrepared({ recordingId: recording.id, audio: result })
    if (download) {
      const link = document.createElement('a'); link.href = mediaUrl(result.ref, true); link.download = result.fileName
      document.body.append(link); link.click(); link.remove()
      setNotice('已打开 WAV 文件另存为')
    } else {
      // A second user click on the audio controls is always available if autoplay is restricted.
      setTimeout(() => { void audio.current?.play().catch(() => undefined) }, 0)
    }
  }
  const syncing = device?.job?.state === 'syncing'
  return <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 1600, background: '#0006', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section ref={panel} role="dialog" aria-modal="true" aria-label={tr('本地设备')} style={{ width: 1040, minWidth: 0, maxWidth: 'calc(100vw - 40px)', height: 740, maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column',
      background: arkmeTheme.base, color: arkmeTheme.text, borderRadius: 16, boxShadow: '0 24px 80px #0004', overflow: 'hidden' }}>
      <header style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${arkmeTheme.border}` }}>
        <strong style={{ flex: 1, fontSize: 18 }}>{tr('本地设备')}</strong>
        <button type="button" style={button} disabled={Boolean(pending) || snapshot?.supported === false} onClick={() => { void action('discover', async () => acceptSnapshot(await callArkme<LocalRecorderSnapshot>('recorders.local.discover', {}, lifetime.current?.signal))) }}>{pending === 'discover' ? tr('正在查找…') : tr('查找设备')}</button>
        <button type="button" style={button} aria-label={tr('关闭本地设备')} onClick={onClose}>{tr('关闭')}</button>
      </header>
      {error && <p role="alert" style={{ margin: '12px 20px', color: '#c64040' }}>{error}</p>}
      {notice && <p role="status" style={{ margin: '12px 20px' }}>{tr(notice)} {notice.includes('导入') && <button type="button" style={button} onClick={() => { onClose(); onShowImports() }}>{tr('查看导入任务')}</button>}</p>}
      {snapshot?.supported === false && <p style={{ padding: '0 20px' }}>{tr(snapshot.reason ?? '当前环境不支持本地设备')}</p>}
      {snapshot?.supported === false && snapshot.devices.length === 0 ? null :
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', flex: 1, minHeight: 0 }}>
        <aside aria-label={tr('设备列表')} style={{ padding: 12, borderRight: `1px solid ${arkmeTheme.border}`, overflowY: 'auto' }}>
          {snapshot === undefined && <p role="status">{tr('正在读取本机设备…')}</p>}
          {snapshot?.devices.length === 0 && <p>{tr('插入录音器后，点击“查找设备”。已同步的录音可在设备拔出后播放。')}</p>}
          {snapshot?.devices.map(row => <button type="button" key={row.id} disabled={Boolean(pending)} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', marginBottom: 8,
            background: device?.id === row.id ? arkmeTheme.hover : arkmeTheme.base }} aria-pressed={device?.id === row.id} onClick={() => selectDevice(row)}>
            <strong style={{ display: 'block' }}>{row.name}</strong><small>{row.serialNumber ?? tr('USB 录音器')} · {tr(row.connected ? '已连接' : '离线')}</small>
          </button>)}
        </aside>
        <main style={{ padding: 20, minWidth: 0, overflowY: 'auto' }}>
          {!device && snapshot !== undefined && <div style={{ padding: '48px 20px', color: arkmeTheme.secondary }}>
            <h3 style={{ color: arkmeTheme.text }}>{tr('连接录音器')}</h3>
            <p>{tr('通过 USB 连接录音器，再点击右上方“查找设备”。')}</p>
            <p>{tr('选择设备后，可同步新增录音、离线播放、另存为 WAV，或导入即我。')}</p>
          </div>}
          {device && <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}><h3 style={{ flex: 1, margin: 0 }}>{device.name}</h3>
              <button type="button" style={button} disabled={Boolean(pending) || !device.connected && !syncing} onClick={() => { void action('sync', async () => acceptSnapshot(await callArkme<LocalRecorderSnapshot>(syncing ? 'recorders.local.stop' : 'recorders.local.sync', { deviceId: device.id }, lifetime.current?.signal))) }}>{tr(syncing ? '停止同步' : '同步新增录音')}</button></div>
            {device.storage?.status === 'ready' ? <div style={{ padding: 14, background: arkmeTheme.hover, borderRadius: 10 }}>
              <div>{tr('已用')} {bytes(device.storage.usedBytes)} / {bytes(device.storage.totalBytes)} · {tr('剩余')} {bytes(device.storage.remainingBytes)}</div>
              <progress aria-label={tr('录音器存储已用容量')} max={device.storage.totalBytes || 1} value={device.storage.usedBytes} style={{ width: '100%', marginTop: 8 }} />
              <small>{tr('预计剩余录音时长')} {duration(device.storage.remainingSeconds * 1000)}{!device.connected && ` · ${tr('上次连接时的数据')}`}</small>
            </div> : <p>{tr(device.storage?.status === 'unformatted' ? '存储尚未格式化，无法读取容量' : '当前固件未提供可用容量信息')}</p>}
            {device.job && <p role="status">{tr(device.job.detail)} · {device.job.blocks} {tr('个区块')}</p>}
            <h4>{tr('已同步到本机的录音')} · {device.recordingCount}</h4>
            {!device.recordings.length && <p>{tr(syncing ? '同步完成后显示录音列表' : '点击“同步新增录音”读取设备中的录音。')}</p>}
            <div role="list" aria-label={tr('本机录音列表')} style={{ display: 'grid', gap: 6 }}>
              {device.recordings.map(row => <button type="button" key={row.id} disabled={Boolean(pending)} aria-pressed={row.id === recordingId} style={{ ...button, textAlign: 'left', display: 'flex', gap: 10, background: row.id === recordingId ? arkmeTheme.hover : arkmeTheme.base }} onClick={() => setRecordingId(row.id)}>
                <span style={{ flex: 1 }}>{row.startAtMillis === null ? tr('时间待核对') : new Date(row.startAtMillis).toLocaleString()} · #{row.sessionId}</span>
                <span>{duration(row.durationMillis)}</span><small>{tr(row.complete ? '已下载' : '已下载部分')}</small>
              </button>)}
            </div>
            {device.recordings.length < device.recordingCount && <button type="button" style={button} disabled={Boolean(pending)} onClick={() => { void action('more', async () => {
              const page = await callArkme<LocalRecorderRecordingPage>('recorders.local.recordings', { deviceId: device.id, offset: device.recordings.length, revision: device.updatedAtMillis }, lifetime.current?.signal)
              if (!lifetime.current?.signal.aborted) setSnapshot(previous => previous && ({ ...previous, devices: previous.devices.map(row => row.id === device.id && row.updatedAtMillis === page.revision ? { ...row, recordings: [...row.recordings, ...page.items] } : row) }))
            }) }}>{tr('加载更多录音')}</button>}
            {recording && <section aria-label={tr('本地录音操作')} style={{ marginTop: 18, padding: 16, border: `1px solid ${arkmeTheme.border}`, borderRadius: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}><button type="button" style={button} disabled={Boolean(pending)} onClick={() => { void action('play', () => prepare(false)) }}>{tr(pending === 'play' ? '正在准备音频…' : '播放')}</button>
                <button type="button" style={button} disabled={Boolean(pending)} onClick={() => { void action('save', () => prepare(true)) }}>{tr('另存为 WAV')}</button></div>
              {prepared?.recordingId === recording.id && <audio ref={audio} controls preload="metadata" src={mediaUrl(prepared.audio.ref)} style={{ width: '100%', marginTop: 12 }} />}
              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <label>{tr('录音开始时间')} <input type="datetime-local" step="0.001" value={startAt} onChange={event => setStartAt(event.target.value)} style={{ ...button, padding: 6 }} /></label>
                <label>{tr('录音归属')} <select value={ownership} onChange={event => setOwnership(event.target.value as 'self' | 'other')} style={button}><option value="self">{tr('自己')}</option><option value="other">{tr('他人')}</option></select></label>
                <button type="button" style={button} disabled={Boolean(pending) || !startAt || !recording.complete} onClick={() => { void action('import', async () => {
                  await callArkme<PublicRecordingImportJob>('recorders.local.import', { deviceId: device.id, recordingId: recording.id, startAtMillis: new Date(startAt).getTime(), ownership }, lifetime.current?.signal)
                  if (!lifetime.current?.signal.aborted) setNotice('已加入即我录音导入队列')
                }) }}>{tr(pending === 'import' ? '正在导入…' : '导入即我')}</button>
              </div>
              {recording.startAtMillis === null && <p>{tr('设备未提供可恢复的录音时间，请核对开始时间后导入。')}</p>}
              {!recording.complete && <p>{tr('这条录音尚未结束或未同步完整，可先播放、另存为，完成同步后再导入。')}</p>}
            </section>}
          </>}
        </main>
      </div>}
    </section>
  </div>
}
