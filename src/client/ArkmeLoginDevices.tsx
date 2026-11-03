import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Desktop } from '@phosphor-icons/react/dist/icons/Desktop'
import { DeviceMobile } from '@phosphor-icons/react/dist/icons/DeviceMobile'
import { Devices } from '@phosphor-icons/react/dist/icons/Devices'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { ShieldCheck } from '@phosphor-icons/react/dist/icons/ShieldCheck'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import type { LoginDevice, LoginDevicePage, LoginEventPage, DeviceConfirmation, DeviceOperation, DeviceNotifications, LoginDeviceRequest, LoginDeviceResult } from '../login-devices-contract.js'
import { callArkme } from './api.js'
import { tr, arkmeIntlLocale, useArkmeLocale } from './locale.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import './login-devices.css'

const request = <T extends LoginDeviceResult>(input: LoginDeviceRequest, signal?: AbortSignal) => callArkme<T>('account.devices', input, signal)
const date = (at: number | null) => at ? new Date(at).toLocaleString(arkmeIntlLocale()) : tr('活跃时间暂不可用')
const mobile = (d: LoginDevice) => d.platform === 'ios' || d.platform === 'android'
const computer = (d: LoginDevice) => ['macos', 'windows', 'linux'].includes(d.platform)
function DeviceIcon({ device }: { device: LoginDevice }) { return <span className="device-icon">{mobile(device) ? <DeviceMobile size={25} /> : computer(device) ? <Desktop size={25} /> : <Devices size={25} />}</span> }
function Dialog({ label, onClose, children, className = '', returnFocusRef }: { label: string; onClose: () => void; children: ReactNode; className?: string; returnFocusRef?: RefObject<HTMLElement> }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, element = ref.current
    element?.showModal()
    return () => { element?.close(); queueMicrotask(() => { const target = previous?.isConnected && previous !== document.body ? previous : returnFocusRef?.current; target?.focus({ preventScroll: true }) }) }
  }, [returnFocusRef])
  return createPortal(<dialog ref={ref} className={`device-dialog ${className}`} aria-label={label} data-arkme-notification-blocking-overlay="true"
    onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose() }} onKeyDown={e => { e.stopPropagation() }}
    onClick={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose() }}>{children}</dialog>, document.body)
}
export function LoginDeviceEntry({ accountScope, onOpen }: { accountScope: string; onOpen: () => void }) {
  const [summary, setSummary] = useState<LoginDevicePage>()
  useEffect(() => { const controller = new AbortController(); void request<LoginDevicePage>({ action: 'list', accountScope }, controller.signal).then(value => { if (!controller.signal.aborted && value.accountScope === accountScope) setSummary(value) }).catch(() => undefined); return () => controller.abort() }, [accountScope])
  return <button type="button" className="device-profile-entry" onClick={onOpen}><Devices size={19} /><span><strong>{summary?.accountScope === accountScope && summary.countComplete ? tr('已在{count}台设备上登录', { count: summary.total }) : tr('登录设备管理')}</strong></span><CaretRight size={15} /></button>
}
function Notifications({ accountScope, device }: { accountScope: string; device: LoginDevice }) {
  const [value, setValue] = useState<DeviceNotifications>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const controller = useRef<AbortController>(), writing = useRef(false)
  useEffect(() => { const c = new AbortController(); controller.current = c; setValue(undefined); setError(''); if (device.notificationsSupported) void request<DeviceNotifications>({ action: 'notifications', accountScope, ref: device.ref }, c.signal).then(v => { if (!c.signal.aborted) setValue(v) }).catch(() => { if (!c.signal.aborted) setError(tr('暂时无法确认设置，请刷新后重试。')) }); return () => c.abort() }, [accountScope, device.ref, device.notificationsSupported, revision])
  const toggle = async (kind: 'messages' | 'calls') => {
    if (!value?.supported || writing.current) return
    writing.current = true
    setBusy(true); setError('')
    const next = { ...value, [kind]: !value[kind] }, signal = controller.current?.signal
    try { const result = await request<DeviceNotifications>({ action: 'set-notifications', accountScope, ref: device.ref, messages: next.messages, calls: next.calls, revision: value.revision, requestId: crypto.randomUUID() }, signal); if (!signal?.aborted) setValue(result) }
    catch { if (!signal?.aborted) { setError(tr('设置结果待确认，请重新核实。')); setValue(undefined) } }
    finally { writing.current = false; if (!signal?.aborted) setBusy(false) }
  }
  return <div className="device-notifications"><p>{tr('仅控制这台手机的多端提醒，不改变手机系统权限。')}</p>
    {!device.notificationsSupported ? <p>{tr('这台设备暂不支持通知设置。')}</p> : error ? <p role="status">{error} <button onClick={() => setRevision(v => v + 1)}>{tr('重新核实')}</button></p> : !value ? <p role="status">{tr('读取中…')}</p> : !value.supported ? <p>{tr('这台设备暂不支持通知设置。')}</p> : (['messages', 'calls'] as const).map(kind => <div className="device-setting" key={kind}><span>{tr(kind === 'messages' ? '消息通知' : '音视频通话通知')}</span><button type="button" className="device-switch" role="switch" aria-label={tr(kind === 'messages' ? '消息通知' : '音视频通话通知')} aria-checked={value[kind]} disabled={busy} onClick={() => void toggle(kind)}><span /></button></div>)}
  </div>
}
export function ArkmeLoginDevices({ accountScope, onClose, returnFocusRef }: { accountScope: string; onClose: () => void; returnFocusRef: RefObject<HTMLElement> }) {
  useArkmeLocale()
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const [page, setPage] = useState<'list' | 'trusted' | 'events'>('list'), [cursor, setCursor] = useState<string>(), [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ page: string; cursor: string | undefined; value: LoginDevicePage | LoginEventPage }>()
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [editing, setEditing] = useState(false), [expanded, setExpanded] = useState<string>()
  const [confirmation, setConfirmation] = useState<DeviceConfirmation>(), [pending, setPending] = useState<DeviceOperation>(), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('')
  const busyRef = useRef(false)
  const alive = useRef(true), writeController = useRef(new AbortController()), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { alive.current = true; const controller = new AbortController(); writeController.current = controller; return () => { alive.current = false; controller.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailed(false)
    void request<LoginDevicePage | LoginEventPage>({ action: page, accountScope, ...(cursor ? { cursor } : {}) }, controller.signal)
      .then(value => { if (!controller.signal.aborted && value.accountScope === accountScope) setResult(previous => {
        if (page === 'events' && cursor && previous?.page === page && previous.value.accountScope === accountScope && previous.value.cursor === cursor && 'coverageStart' in previous.value && 'coverageStart' in value) {
          value = { ...value, items: [...new Map([...previous.value.items, ...value.items].map(event => [event.id, event])).values()], coverageStart: Math.max(previous.value.coverageStart, value.coverageStart) }
        }
        return { page, cursor, value }
      }) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accountScope, page, cursor, refresh])
  const value = result?.page === page && result.value.accountScope === accountScope && (result.cursor === cursor || page === 'events') ? result.value : undefined
  const devices = value && 'total' in value ? value : undefined, events = value && 'coverageStart' in value ? value : undefined
  const title = tr(page === 'trusted' ? '常用设备管理' : page === 'events' ? '登录日志' : '登录设备管理')
  const navigate = (next: typeof page) => { setPage(next); setCursor(undefined); setEditing(false); setExpanded(undefined); setFeedback('') }
  const reload = () => { setCursor(undefined); setRefresh(v => v + 1) }
  const prepare = async (device: LoginDevice, kind: 'logout' | 'forget') => {
    if (busyRef.current || pending) return
    busyRef.current = true
    setBusy(true); setFeedback('')
    try { const p = await request<DeviceConfirmation>({ action: 'prepare', accountScope, ref: device.ref, kind }, writeController.current.signal); if (alive.current) setConfirmation(p) }
    catch (e) { if (alive.current) setFeedback(e instanceof Error ? e.message : tr('操作未成功，请刷新后重试。')) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  const applyResult = (operation: DeviceOperation) => {
    if (operation.state === 'unknown') { setPending(operation); setFeedback(tr('请求结果待确认，请重新核实。')); return }
    setPending(undefined); setConfirmation(undefined)
    setFeedback(tr(operation.kind === 'forget' ? '已移除常用设备，下次登录需要重新验证。' : operation.cleanup === 'complete' ? '设备已退出登录。' : '登录权限已撤销；设备再次联网时完成退出。'))
    reload(); queueMicrotask(() => heading.current?.focus())
  }
  const submit = async (reconcile = false) => {
    const ticket = reconcile ? pending?.ticket : confirmation?.ticket
    if (!ticket || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try { const op = await request<DeviceOperation>({ action: reconcile ? 'operation' : 'confirm', accountScope, ticket }, writeController.current.signal); if (alive.current) applyResult(op) }
    catch (e) { if (alive.current) { setFeedback(e instanceof Error ? e.message : tr('请求结果待确认，请重新核实。')); if (e && typeof e === 'object' && 'code' in e && ['login-devices-invalid', 'login-devices-account-changed', 'auth-http-409'].includes(String(e.code))) { setConfirmation(undefined); reload() }
      else if (!reconcile && confirmation) setPending({ accountScope, ticket, kind: confirmation.kind, state: 'unknown', cleanup: 'pending' }) } }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  return <Dialog label={title} onClose={() => { if (!busy) onClose() }} returnFocusRef={returnFocusRef}>
    <header className="device-header">
      {page !== 'list' && <button className="device-icon-button" aria-label={tr('返回登录设备管理')} disabled={busy} onClick={() => navigate('list')}><CaretLeft size={20} /></button>}
      <div className="device-heading"><h2 ref={heading} tabIndex={-1}>{title}</h2>{page === 'list' && <p>{tr('查看登录状态，管理你的账号安全')}</p>}</div>
      {page === 'trusted' && <button className="device-text-button" onClick={() => setEditing(v => !v)}>{tr(editing ? '完成' : '编辑')}</button>}
      {page === 'list' && <button className="device-icon-button" aria-label={tr('刷新设备列表')} disabled={loading || busy} onClick={reload}><ArrowClockwise size={20} className={loading ? 'spinning' : ''} /></button>}
      <button className="device-icon-button" aria-label={tr('关闭设备管理')} disabled={busy} onClick={onClose}><X size={20} /></button>
    </header>
    <div className="device-content" aria-busy={loading}>
      {feedback && <div role="status" className="device-feedback">{feedback}</div>}
      {pending && <div className="device-pending"><WarningCircle size={18} /><span>{tr('请求结果待确认，请重新核实。')}</span><button disabled={busy} onClick={() => void submit(true)}>{tr('重新核实')}</button></div>}
      {failed && <div className="device-feedback" role="status">{tr('暂时无法刷新，请检查网络后重试。')}{devices && <span> {tr('上次读取：{time}', { time: date(devices.observedAt) })}</span>} <button onClick={reload}>{tr('重新加载')}</button></div>}
      {!value && <div className="device-empty"><Devices size={36} /><h3>{tr(loading ? '读取中…' : '暂时无法读取设备列表')}</h3>{!loading && <p>{tr('这不代表你的设备已退出登录。')}</p>}</div>}
      {devices && <>
        {page === 'list' && devices.countComplete && <div className="device-summary"><span>{tr('{count} 台设备已登录', { count: devices.total })}</span></div>}
        {page === 'trusted' && <p className="device-explanation">{tr('这些设备已通过登录验证。移除后，下次登录需要重新验证；不会退出当前登录，也不会删除聊天记录。')}</p>}
        {devices.items.length === 0 && <div className="device-empty"><Devices size={36} /><h3>{tr('暂无可显示的设备')}</h3></div>}
        {(page === 'trusted' ? ['all'] : ['computer', 'phone', 'other']).map(group => {
          const rows = devices.items.filter(d => group === 'all' || (group === 'phone' ? mobile(d) : group === 'computer' ? computer(d) : !mobile(d) && !computer(d))).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.id.localeCompare(b.id))
          return rows.length > 0 && <section className="device-section" key={group}>{group !== 'all' && <h3>{tr(group === 'phone' ? '手机与平板' : group === 'computer' ? '电脑' : '其他设备')}</h3>}<div className="device-card">{rows.map(d => <div className="device-row-wrap" key={d.id}>
            <div className="device-row"><DeviceIcon device={d} /><div className="device-info"><div className="device-name"><strong>{d.name}</strong>{page === 'list' && <span className={`device-status ${d.presence === 'online' ? 'online' : ''}`}>{tr(d.presence === 'online' ? '在线' : d.presence === 'offline' ? '离线' : '状态待确认')}</span>}</div><small>{d.lastActiveAt ? tr('上次活跃：{time}', { time: date(d.lastActiveAt) }) : tr('活跃时间暂不可用')}</small></div>
            {page === 'trusted' && editing ? <button className="device-text-button danger" disabled={busy || !!pending || !d.canForget} onClick={() => void prepare(d, 'forget')}>{tr('移除')}</button> : d.isCurrent ? <span className="device-current">{tr('本机')}</span> : page === 'list' && <button className="device-text-button" disabled={busy || !!pending || !d.canLogout} onClick={() => void prepare(d, 'logout')}>{tr('退出登录')}</button>}</div>
            {page === 'list' && mobile(d) && <><button className="device-expand" aria-expanded={expanded === d.ref} onClick={() => setExpanded(expanded === d.ref ? undefined : d.ref)}>{tr('通知设置')} <CaretDown size={14} style={{ transform: expanded === d.ref ? 'rotate(180deg)' : undefined }} /></button>{expanded === d.ref && <Notifications accountScope={accountScope} device={d} />}</>}
          </div>)}</div></section>
        })}
      </>}
      {events && <><div className="device-log-toolbar"><p>{tr('最近 30 天')}</p><span>{tr('时间按本机时区显示')}</span></div><div className="device-card">{events.items.map(e => <div className="device-log-row" key={e.id}><span className="device-log-dot" /><div><small>{date(e.at)}</small><strong>{e.name}</strong><span>{tr(({ password: '密码登录', phone_code: '验证码登录', email_code: '验证码登录', app_scan: '即我扫码登录', oauth: '授权登录' } as Record<string, string>)[e.method] ?? '账号验证')}</span></div><span className="device-log-result">{tr(e.kind === 'login' ? '登录成功' : e.kind === 'forget' ? '已取消信任' : '已退出')}</span></div>)}</div>{events.items.length === 0 && <p>{tr('暂无登录日志')}</p>}{events.coverageStart > 0 && <p className="device-footnote">{tr('完整记录起点：{time}', { time: date(events.coverageStart) })}</p>}</>}
      {value?.cursor && <button className="device-text-button" disabled={loading} onClick={() => { if (value.cursor === cursor) setRefresh(v => v + 1); else setCursor(value.cursor) }}>{tr(page === 'events' ? '加载更多' : '下一页')}</button>}
      {cursor && <button className="device-text-button" disabled={loading} onClick={() => setCursor(undefined)}>{tr('返回第一页')}</button>}
      {page === 'list' && <section className="device-section"><h3>{tr('登录设置')}</h3><div className="device-card device-links"><button onClick={() => navigate('trusted')}><ShieldCheck size={22} /><span><strong>{tr('常用设备管理')}</strong><small>{tr('管理已记住的设备，下次登录更安心')}</small></span><CaretRight size={17} /></button><button onClick={() => navigate('events')}><ClockCounterClockwise size={22} /><span><strong>{tr('登录日志')}</strong><small>{tr('查看近期登录与退出记录')}</small></span><CaretRight size={17} /></button></div></section>}
    </div>
    <footer className="device-footer"><span>{tr(page === 'list' ? '仅展示当前账号的设备' : '登录安全 · 即我')}</span></footer>
    {confirmation && <Dialog label={tr(confirmation.kind === 'logout' ? '退出设备登录确认' : '移除常用设备确认')} className="device-confirm" returnFocusRef={heading} onClose={() => { if (!busy) setConfirmation(undefined) }}>
      <span className="confirm-symbol"><WarningCircle size={28} /></span><h2>{tr(confirmation.kind === 'logout' ? '退出这台设备的登录？' : '移除这台常用设备？')}</h2><p className="confirm-target">{confirmation.name}</p><p>{tr(confirmation.kind === 'logout' ? '此设备将无法继续访问你的账号，需要重新登录。离线设备再次联网时完成退出，云端聊天记录会保留。' : '此设备下次登录需要重新进行安全验证。当前登录不会退出，聊天记录会保留。')}</p>
      {feedback && <p role="status">{feedback}</p>}<div className="confirm-actions"><button autoFocus disabled={busy} onClick={() => setConfirmation(undefined)}>{tr('取消')}</button><button disabled={busy} className="danger-primary" onClick={() => void submit(!!pending)}>{tr(busy ? '正在处理…' : pending ? '重新核实' : confirmation.kind === 'logout' ? '确认退出' : '确认移除')}</button></div>
    </Dialog>}
  </Dialog>
}
