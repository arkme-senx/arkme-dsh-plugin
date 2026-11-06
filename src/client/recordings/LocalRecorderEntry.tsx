import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { callArkme } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'
import type { LocalRecorderAudio, LocalRecorderDevice, LocalRecorderSnapshot, LocalRecorderRecordingPage, LocalRecorderRecording } from '../../local-recorder/contract.js'
import type { PublicRecordingImportJob } from '../../recording-import-contract.js'
import { tr } from '../locale.js'
import recorderCss from './local-recorder.css?inline'

const button: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' }
const bytes = (value: number) => value < 1000000 ? `${(value / 1000).toFixed(1)} KB` : `${(value / 1000000).toFixed(1)} MB`
const duration = (millis: number) => `${Math.floor(millis / 3600000).toString().padStart(2, '0')}:${Math.floor(millis / 60000 % 60).toString().padStart(2, '0')}:${Math.floor(millis / 1000 % 60).toString().padStart(2, '0')}`
const elapsed = (millis: number) => millis < 1000 ? tr('不足 1 秒') : `${Math.floor(millis / 1000)} ${tr('秒')}`
const localDate = (stamp: number | null) => stamp === null ? '' : new Date(stamp - new Date(stamp).getTimezoneOffset() * 60000).toISOString().slice(0, 23)
const date = (stamp: number | null, full = false) => stamp === null ? tr('时间待核对') : new Date(stamp).toLocaleString(undefined, { year: 'numeric', month: full ? 'long' : '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const voltage = (value: number | null | undefined) => value == null ? tr('未知') : `${(value / 1000).toFixed(3)} V`
const firmware = (value: number | null | undefined) => value == null ? tr('未知') : `V${(value >>> 16) & 255}.${value >>> 8 & 255}.${value & 255}`
const stopReason = (row: LocalRecorderRecording, syncing: boolean, scanComplete: boolean) => {
  if (!row.complete) return tr(syncing ? '尚在读取' : scanComplete ? '未完整关闭' : '待完整同步')
  const reason = row.info?.stopReason
  return reason == null ? tr('未知') : tr(['正常结束', '插入 USB', '低电量', '存储已满', '内部错误', 'VAD 静音结束', 'VAD 模式变更', 'App 手动暂停'][reason] ?? `未知原因 ${reason}`)
}
function Glyph({ name, size = 18 }: { name: 'wave' | 'clock' | 'drive' | 'alert' | 'sync' | 'play' | 'pause' | 'down'; size?: number }) {
  const paths = { wave: 'M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4', clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', drive: 'M5 4h14l3 11v5H2v-5L5 4Zm-3 11h20M6 17v1m4-1v1', alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v1', sync: 'M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5m-3 8a9 9 0 0 0 15 3l3-3m0 5v-5h-5', play: 'm8 4 12 8-12 8V4Z', pause: 'M8 4v16M16 4v16', down: 'M12 3v14m-6-6 6 6 6-6M3 20h18' }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

export function LocalRecorderEntry({ style, accountKey, mediaPath, onShowImports }: { style?: CSSProperties | undefined; accountKey?: string | undefined; mediaPath: string; onShowImports(): void }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" style={style ?? button} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{tr('本地设备')}</button>
    {open && <LocalRecorderPanel key={accountKey} mediaPath={mediaPath} onClose={() => setOpen(false)} onShowImports={onShowImports} />}</>
}
export function LocalRecorderPanel({ mediaPath, onClose, onShowImports }: { mediaPath: string; onClose(): void; onShowImports(): void }) {
  const [snapshot, setSnapshot] = useState<LocalRecorderSnapshot>()
  const [deviceId, setDeviceId] = useState(''), [recordingId, setRecordingId] = useState('')
  const [pending, setPending] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [prepared, setPrepared] = useState<{ recordingId: string; audio: LocalRecorderAudio }>()
  const [startAt, setStartAt] = useState(''), [ownership, setOwnership] = useState<'self' | 'other'>('self'), [importOpen, setImportOpen] = useState(false)
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [sidebarWidth, setSidebarWidth] = useState(320), [now, setNow] = useState(Date.now())
  const lifetime = useRef<AbortController | undefined>(undefined), audio = useRef<HTMLAudioElement>(null), panel = useRef<HTMLElement>(null)
  const selected = useRef(''), startDirty = useRef(false), drag = useRef<{ x: number; width: number } | undefined>(undefined)
  const device = snapshot?.devices.find(row => row.id === deviceId) ?? snapshot?.devices[0]
  const recording = device?.recordings.find(row => row.id === recordingId)
  selected.current = recording?.id ?? ''
  const syncing = device?.job?.state === 'syncing', transfer = device?.job?.transfer
  const progress = transfer?.totalBlocks ? Math.max(0, Math.min(1, transfer.scannedBlocks / transfer.totalBlocks)) : null
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
    const clock = setInterval(() => setNow(Date.now()), 1000)
    const previousFocus = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, summary, [role="separator"], a[href]')
        const visible = nodes ? [...nodes].filter(node => node.getClientRects().length) : []
        const first = visible[0], last = visible.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const move = (event: PointerEvent) => { if (drag.current) setSidebarWidth(Math.max(280, Math.min(380, drag.current.width + event.clientX - drag.current.x))) }
    const stopDrag = () => { drag.current = undefined }
    window.addEventListener('keydown', escape); window.addEventListener('pointermove', move); window.addEventListener('pointerup', stopDrag)
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock); window.removeEventListener('keydown', escape); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stopDrag); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  useEffect(() => { if (!recordingId && device?.recordings[0]) setRecordingId(device.recordings[0].id) }, [device?.id, device?.recordings, recordingId])
  useEffect(() => { startDirty.current = false; setPrepared(undefined); setStartAt(localDate(recording?.startAtMillis ?? null)); setOwnership('self'); setNotice(''); setImportOpen(false); setPosition(0); setPlaying(false) }, [recording?.id])
  useEffect(() => { if (!startDirty.current) setStartAt(localDate(recording?.startAtMillis ?? null)) }, [recording?.id, recording?.startAtMillis])
  const action = async (name: string, run: () => Promise<void>) => {
    if (pending) return
    setPending(name); setError(''); setNotice('')
    try { await run() } catch (cause) { if (!lifetime.current?.signal.aborted) setError(cause instanceof Error ? cause.message : '设备操作未完成') }
    finally { if (!lifetime.current?.signal.aborted) setPending('') }
  }
  const selectDevice = (id: string) => { setDeviceId(id); setRecordingId(''); setPrepared(undefined) }
  const discover = () => { void action('discover', async () => acceptSnapshot(await callArkme<LocalRecorderSnapshot>('recorders.local.discover', {}, lifetime.current?.signal))) }
  const sync = () => { if (device) void action('sync', async () => acceptSnapshot(await callArkme<LocalRecorderSnapshot>(syncing ? 'recorders.local.stop' : 'recorders.local.sync', { deviceId: device.id }, lifetime.current?.signal))) }
  const prepare = async (download: boolean) => {
    if (!device || !recording) return
    const result = await callArkme<LocalRecorderAudio>('recorders.local.prepare', { deviceId: device.id, recordingId: recording.id }, lifetime.current?.signal)
    if (lifetime.current?.signal.aborted || selected.current !== recording.id) return
    setPrepared({ recordingId: recording.id, audio: result })
    if (download) {
      const link = document.createElement('a'); link.href = mediaUrl(result.ref, true); link.download = result.fileName
      document.body.append(link); link.click(); link.remove(); setNotice('已打开 WAV 文件另存为')
    } else setTimeout(() => { if (!lifetime.current?.signal.aborted && selected.current === recording.id) void audio.current?.play().catch(() => undefined) }, 0)
  }
  const play = () => {
    const newerAudio = recording?.info && prepared && recording.info.cachedDurationMillis > prepared.audio.durationMillis
    if (prepared?.recordingId === recording?.id && audio.current && (playing || !newerAudio)) {
      if (playing) audio.current.pause(); else void audio.current.play().catch(() => setError('播放未启动，请再点击一次播放'))
    } else void action('play', () => prepare(false))
  }
  const playMillis = prepared?.recordingId === recording?.id ? prepared?.audio.durationMillis ?? 0 : recording?.info?.cachedDurationMillis ?? recording?.durationMillis ?? 0
  const storage = device?.storage, usage = storage?.totalBytes ? Math.min(1, storage.usedBytes / storage.totalBytes) : 0
  const storageColor = usage >= 0.98 ? arkmeTheme.danger : usage >= 0.9 ? arkmeTheme.warning : '#1683ff'
  const endTime = recording?.info?.endAtMillis ?? (recording?.startAtMillis != null ? recording.startAtMillis + (recording.info?.cachedDurationMillis ?? recording.durationMillis) : null)
  const info = recording?.info
  const syncButton = <button type="button" className="arkme-rec-button" disabled={Boolean(pending) || !device?.connected && !syncing} onClick={sync}>{tr(syncing ? '停止同步' : '同步新增录音')}</button>
  return <div role="presentation" className="arkme-rec-overlay">
    <style>{recorderCss}</style>
    <section ref={panel} role="dialog" aria-modal="true" aria-label={tr('本地设备')} className="arkme-rec-panel" style={{ '--rec-sidebar': `${sidebarWidth}px` } as CSSProperties}>
      <header className="arkme-rec-header"><Glyph name="wave" size={21} /><strong>Arkme Recorder</strong>
        <span className="arkme-rec-header-status" role="status">{syncing && <><Glyph name="down" />{tr('后台读取')} {progress === null ? '…' : `${Math.floor(progress * 100)}%`}</>}</span>
        <button type="button" className="arkme-rec-button" disabled={Boolean(pending) || snapshot?.supported === false} onClick={discover}>{tr(pending === 'discover' ? '正在查找…' : '查找设备')}</button>
        <button type="button" className="arkme-rec-button" aria-label={tr('关闭本地设备')} onClick={onClose}>{tr('关闭')}</button>
      </header>
      {(error || notice || snapshot?.supported === false) && <div className="arkme-rec-messages">
        {error && <p role="alert" className="arkme-rec-error">{error}</p>}
        {notice && <p role="status">{tr(notice)} {notice.includes('导入') && <button type="button" className="arkme-rec-link" onClick={() => { onClose(); onShowImports() }}>{tr('查看导入任务')}</button>}</p>}
        {snapshot?.supported === false && <p>{tr(snapshot.reason ?? '当前环境不支持本地设备')}</p>}
      </div>}
      <div className="arkme-rec-body">
        <aside className="arkme-rec-sidebar" aria-label={tr('设备与录音列表')}>
          <div className="arkme-rec-sidebar-top">
            <div className={`arkme-rec-device ${device?.connected ? 'is-connected' : ''}`}>
              <span className={`arkme-rec-dot ${device?.connected ? 'is-online' : ''}`} /><Glyph name="wave" size={22} />
              <label><span className="arkme-rec-visually-hidden">{tr('选择录音器')}</span>
                <select aria-label={tr('选择录音器')} value={device?.id ?? ''} disabled={!snapshot?.devices.length || Boolean(pending)} onChange={event => selectDevice(event.target.value)}>
                  {!snapshot?.devices.length && <option value="">{tr('等待连接录音器')}</option>}
                  {snapshot?.devices.map(row => <option key={row.id} value={row.id}>{tr('录音器')} · {row.serialNumber ?? row.name}</option>)}
                </select><small>{device ? `${tr(device.connected ? '已连接' : '离线缓存')} · ${device.recordingCount} ${tr('条录音')}` : tr('通过 USB 连接录音器')}</small>
              </label>
            </div>
            {device && <section className="arkme-rec-storage" aria-label={tr('录音器存储')}>
              <div><strong>{tr('存储')}</strong><small>{storage?.status === 'ready' ? `${tr('剩余')} ${bytes(storage.audioRemainingBytes ?? storage.remainingBytes)}` : tr('容量未知')}</small></div>
              {storage?.status === 'ready' ? <><div className="arkme-rec-capacity-row" title={`${tr('可录音区已用')} ${bytes(storage.usedBytes)} / ${bytes(storage.totalBytes)}`}>
                <small>{tr(storage.physicalBytes === undefined ? '可录音总量' : '总量')} {bytes(storage.physicalBytes ?? storage.totalBytes)}</small>
                <progress aria-label={tr('录音器存储已用容量')} max={1} value={usage} style={{ accentColor: storageColor, color: storageColor }} /><small style={{ color: storageColor }}>{Math.round(usage * 100)}%</small></div>
                {!device.connected && <small>{tr('上次连接时的数据')}</small>}</> : <small>{tr(storage?.status === 'unformatted' ? '存储尚未格式化，无法读取容量' : '当前固件未提供可用容量信息')}</small>}
            </section>}
            {device && <section className={`arkme-rec-sync ${syncing ? 'is-syncing' : ''}`} aria-label={tr('同步状态')}>
              <div className="arkme-rec-sync-title"><Glyph name="sync" /><strong>{tr(syncing ? '正在同步新增录音' : device.job ? '最近一次读取' : '同步录音')}</strong></div>
              {syncing && <progress aria-label={tr('录音同步进度')} max={1} {...(progress === null ? {} : { value: progress })} />}
              {device.job ? <><p role="status">{tr(device.job.detail)}{transfer?.totalBlocks != null ? ` · ${transfer.scannedBlocks}/${transfer.totalBlocks} ${tr('区块')}` : ` · ${device.job.blocks} ${tr('个区块')}`}</p>
                {transfer && <dl><dt>{tr('同步总耗时')}</dt><dd>{elapsed(syncing ? Math.max(transfer.elapsedMillis, now - transfer.startedAtMillis) : transfer.elapsedMillis)}</dd>
                  <dt>{tr('设备读取耗时')}</dt><dd>{elapsed(transfer.readMillis)}</dd><dt>{tr('设备读取量')}</dt><dd>{bytes(transfer.readBytes)}</dd></dl>}</> : <p>{tr('读取新增录音，已下载内容会保留在本机。')}</p>}
              {syncButton}
            </section>}
          </div>
          <div className="arkme-rec-list-heading"><span>{tr('当前录音器')} · {device?.recordingCount ?? 0}</span>{syncing && <span className="arkme-rec-blue">{tr('同步中')} {progress === null ? '' : `${Math.floor(progress * 100)}%`}</span>}</div>
          <div className="arkme-rec-list" role="list" aria-label={tr('本机录音列表')}>
            {snapshot === undefined && <p role="status">{tr('正在读取本机设备…')}</p>}
            {snapshot && !device && <p>{tr('插入录音器后，点击“查找设备”。')}</p>}
            {device && !device.recordings.length && <p>{tr(syncing ? '正在建立录音索引，录音会逐步出现在这里。' : '点击“同步新增录音”读取录音列表。')}</p>}
            {device?.recordings.map(row => <button type="button" key={row.id} data-recording-id={row.id} disabled={Boolean(pending)} aria-pressed={row.id === recordingId} className={`arkme-rec-row ${row.id === recordingId ? 'is-selected' : ''}`} onClick={() => setRecordingId(row.id)}>
              <span className="arkme-rec-row-date">{date(row.startAtMillis)}</span><span className="arkme-rec-row-duration">{duration(row.durationMillis)}</span>
              <span className={row.complete ? 'arkme-rec-ready' : 'arkme-rec-partial'} title={tr(row.complete ? '可播放' : '已缓存部分')}><Glyph name={row.complete ? 'play' : 'down'} size={15} /></span>
            </button>)}
            {device && device.recordings.length < device.recordingCount && <button type="button" className="arkme-rec-link" disabled={Boolean(pending)} onClick={() => { void action('more', async () => {
              const page = await callArkme<LocalRecorderRecordingPage>('recorders.local.recordings', { deviceId: device.id, offset: device.recordings.length, revision: device.updatedAtMillis }, lifetime.current?.signal)
              if (!lifetime.current?.signal.aborted) setSnapshot(previous => previous && ({ ...previous, devices: previous.devices.map(row => row.id === device.id && row.updatedAtMillis === page.revision ? { ...row, recordings: [...row.recordings, ...page.items] } : row) }))
            }) }}>{tr('加载更多录音')}</button>}
          </div>
        </aside>
        <div role="separator" aria-label={tr('调整录音列表宽度')} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={380} aria-valuenow={sidebarWidth} tabIndex={0} className="arkme-rec-resize" onPointerDown={event => { event.preventDefault(); drag.current = { x: event.clientX, width: sidebarWidth } }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setSidebarWidth(width => Math.max(280, Math.min(380, width + (event.key === 'ArrowLeft' ? -16 : 16)))) } }} />
        <main className="arkme-rec-detail" aria-label={tr('录音详情')}>
          {!recording ? <div className="arkme-rec-empty"><Glyph name="wave" size={44} /><h2>{tr(!device ? '连接录音器' : device.recordings.length ? '选择一条录音' : syncing ? '正在读取录音' : '准备读取录音')}</h2>
            <p>{tr(!device ? '通过 USB 连接录音器，再点击右上方“查找设备”。' : device.recordings.length ? '在左侧选择录音，查看详情并播放。' : syncing ? '已读取的录音会逐步显示在左侧列表。' : '点击“同步新增录音”读取设备中的录音。')}</p>{device && !syncing && syncButton}</div> : <>
            <div className="arkme-rec-recording-title"><h2>{date(recording.startAtMillis, true)}</h2><p>{tr('录音会话')} #{recording.sessionId}{!device?.connected && <span> · {tr('离线缓存')}</span>}</p></div>
            <div className="arkme-rec-metrics"><Metric title="时长" value={duration(recording.durationMillis)} icon="clock" /><Metric title="音频数据量" value={info ? bytes(info.audioBytes) : '—'} icon="drive" /><Metric title="结束原因" value={stopReason(recording, Boolean(syncing), device?.job?.state === 'completed')} icon="alert" /></div>
            <section className="arkme-rec-audio-section" aria-label={tr('音频文件')}><h3>{tr('音频文件')} · 1 {tr('个')}</h3><div className="arkme-rec-audio-card">
              <div className="arkme-rec-file-heading"><span className="arkme-rec-file-icon"><Glyph name="wave" size={27} /></span><div><strong>{tr('完整录音文件')}</strong><p>{date(recording.startAtMillis)}{recording.complete ? ' – ' : ` · ${tr('已缓存至')} `}{endTime === null ? tr('时间待核对') : new Date(endTime).toLocaleTimeString(undefined, { hour12: false })}</p><small>{tr('时长')} {duration(playMillis)} · {tr(prepared?.recordingId === recording.id ? (recording.info && prepared.audio.durationMillis < recording.info.cachedDurationMillis ? '有新增音频，播放时更新' : '音频已就绪') : recording.complete ? '已缓存，点击播放准备音频' : '已缓存部分，可先试听')}</small></div>
                <button type="button" className="arkme-rec-button arkme-rec-primary" disabled={Boolean(pending)} onClick={play}>{tr(pending === 'play' ? '正在准备音频…' : playing ? '暂停' : '播放')}</button></div>
              {prepared?.recordingId === recording.id && <audio ref={audio} preload="metadata" src={mediaUrl(prepared.audio.ref)} onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError('本地音频暂不可用，请重新准备后重试')} />}
              <div className="arkme-rec-player"><button type="button" className="arkme-rec-play-toggle" aria-label={tr(playing ? '暂停录音' : '播放录音')} disabled={Boolean(pending)} onClick={play}><Glyph name={playing ? 'pause' : 'play'} size={17} /></button>
                <input type="range" aria-label={tr('播放进度')} min={0} max={Math.max(1, playMillis / 1000)} step={0.1} value={Math.min(position, playMillis / 1000)} disabled={!prepared} onChange={event => { const value = Number(event.target.value); if (audio.current) audio.current.currentTime = value; setPosition(value) }} /></div>
              <div className="arkme-rec-time-row"><span>{duration(position * 1000)}</span><span>{duration(playMillis)}</span></div>
              <div className="arkme-rec-file-actions"><button type="button" className="arkme-rec-button" disabled={Boolean(pending)} onClick={() => { void action('save', () => prepare(true)) }}>{tr('另存为 WAV')}</button>
                <button type="button" className="arkme-rec-button" disabled={Boolean(pending) || !recording.complete} onClick={() => setImportOpen(open => !open)}>{tr('导入即我')}</button></div>
              {!recording.complete && <p className="arkme-rec-hint">{tr('这条录音尚未结束或未同步完整，可先播放、另存为，完成同步后再导入。')}</p>}
              {importOpen && <div className="arkme-rec-import" role="group" aria-label={tr('确认导入即我')}><label>{tr('录音开始时间')}<input type="datetime-local" step="0.001" value={startAt} onChange={event => { startDirty.current = true; setStartAt(event.target.value) }} /></label>
                <label>{tr('录音归属')}<select value={ownership} onChange={event => setOwnership(event.target.value as 'self' | 'other')}><option value="self">{tr('自己')}</option><option value="other">{tr('他人')}</option></select></label>
                <p>{tr('确认时间与归属后，音频将进入当前即我账号的导入队列。')}</p>
                <button type="button" className="arkme-rec-button arkme-rec-primary" disabled={Boolean(pending) || !startAt || !recording.complete} onClick={() => { void action('import', async () => {
                  await callArkme<PublicRecordingImportJob>('recorders.local.import', { deviceId: device!.id, recordingId: recording.id, startAtMillis: new Date(startAt).getTime(), ownership }, lifetime.current?.signal)
                  if (!lifetime.current?.signal.aborted) { setNotice('已加入即我录音导入队列'); setImportOpen(false) }
                }) }}>{tr(pending === 'import' ? '正在导入…' : '确认导入')}</button></div>}
            </div></section>
            <section className="arkme-rec-info-section" aria-label={tr('录音信息')}><h3>{tr('录音信息')}</h3><dl className="arkme-rec-info"><dt>{tr('开始电压')}</dt><dd>{voltage(info?.batteryStartMV)}</dd><dt>{tr('结束电压')}</dt><dd>{voltage(info?.batteryEndMV)}</dd>
              <dt>{tr('固件版本')}</dt><dd>{firmware(info?.firmwareVersion)}</dd><dt>{tr('录制增益')}</dt><dd>{info?.gainStartDb == null ? tr('未知') : `${tr('起始')} ${info.gainStartDb >= 0 ? '+' : ''}${info.gainStartDb.toFixed(1)} dB`}{Boolean(info?.gainChanges) && ` · ${info!.gainChanges} ${tr('次调整')}`}</dd>
              <dt>{tr('VAD 状态')}</dt><dd>{tr(info?.vadEnabled == null ? '未知' : info.vadEnabled ? '已开启' : '已关闭')}</dd><dt>{tr('VAD 阈值')}</dt><dd>{info?.vadEnabled === false ? tr('未启用') : info?.vadThreshold ?? tr('未知')}</dd>
              <dt>{tr('物理区块')}</dt><dd>{info ? `${info.blockCount} ${tr('个')}` : tr('未知')}</dd><dt>{tr('数据检查')}</dt><dd>{tr(info?.crcVerified ? '已缓存区块 CRC 校验通过' : '待同步校验')}</dd></dl></section>
            {transfer && <section className="arkme-rec-performance"><h3>{tr('本次设备读取性能')}</h3><dl className="arkme-rec-info"><dt>{tr('设备读取量')}</dt><dd>{bytes(transfer.readBytes)}</dd><dt>{tr('设备读取耗时')}</dt><dd>{elapsed(transfer.readMillis)}</dd><dt>{tr('平均读取速度')}</dt><dd>{transfer.readMillis > 0 ? `${bytes(transfer.readBytes * 1000 / transfer.readMillis)}/s` : '—'}</dd></dl></section>}
          </>}
        </main>
      </div>
    </section>
  </div>
}
function Metric({ title, value, icon }: { title: string; value: string; icon: 'clock' | 'drive' | 'alert' }) {
  return <div className="arkme-rec-metric"><div><Glyph name={icon} size={16} /><span>{tr(title)}</span></div><strong>{value}</strong></div>
}
