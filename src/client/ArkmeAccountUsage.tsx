import { pointsUnits, type ArkmeAiPointsAccount } from '../ai-points.js'
import { ArkmePointsConsumption } from './ArkmePointsConsumption.js'
import { tr, useArkmeLocale, arkmeIntlLocale, getArkmeLocale } from './locale.js'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeAccountRecordingUsage, ArkmeAccountStorageUsage, ArkmeAccountVoiceUsage } from '../account-usage.js'
import { callArkme } from './api.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { ArkmeStorageUsageBreakdown } from './ArkmeUsageBreakdown.js'

type ReadState<T> = { status: 'loading' | 'error'; unavailable?: boolean } | { status: 'ready'; value: T }
type UsageValue = ArkmeAccountRecordingUsage | ArkmeAccountStorageUsage | ArkmeAiPointsAccount | ArkmeAccountVoiceUsage
// Floor only the overview labels; keep the exact account values for billing and details.
function formatWholePoints(value: string): string {
  return (pointsUnits(value) / 10_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function useUsage<T extends UsageValue>(operation: 'account.usage.recording' | 'account.points.query' | 'account.usage.storage' | 'account.usage.voice', scope: string, revision: number): ReadState<T> {
  const [result, setResult] = useState<{ scope: string; revision: number; state: ReadState<T> }>()
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void callArkme<T>(operation, { expectedAccountScope: scope }, controller.signal).then(value => {
      if (active) setResult({ scope, revision, state: value.accountScope === scope ? { status: 'ready', value } : { status: 'error' } })
    }).catch((error: unknown) => {
      if (active) setResult({ scope, revision, state: { status: 'error', unavailable: operation === 'account.usage.recording' && typeof error === 'object' && error !== null && 'code' in error && error.code === 'arkme-code-3003' } })
    })
    return () => { active = false; controller.abort() }
  }, [operation, scope, revision])
  return result?.scope === scope && result.revision === revision ? result.state : { status: 'loading' }
}

const numberFormat = new Intl.NumberFormat(arkmeIntlLocale(), { maximumFractionDigits: 0 })
export function formatCompactTokens(count: number): string {
  if (getArkmeLocale() === 'en') return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count)
  if (count < 10000) return numberFormat.format(count)
  if (count < 100000000) return `${count % 10000 === 0 ? '' : '约 '}${numberFormat.format(count / 10000)} 万`
  return `${count % 1000000 === 0 ? '' : '约 '}${new Intl.NumberFormat(arkmeIntlLocale(), { maximumFractionDigits: 2 }).format(count / 100000000)} 亿`
}
export function formatUsageBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const index = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${new Intl.NumberFormat(arkmeIntlLocale(), { maximumFractionDigits: 2 }).format(bytes / 1024 ** index)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`
}
export function formatUsageSeconds(seconds: number): string {
  seconds = Math.round(seconds)
  if (getArkmeLocale() === 'en') {
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = Math.round(seconds % 60 * 1000) / 1000
    return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', rest || seconds === 0 ? `${rest}s` : ''].filter(Boolean).join(' ')
  }
  if (seconds === 0) return '0 秒'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = Math.round(seconds % 60 * 1000) / 1000
  return [hours > 0 ? `${numberFormat.format(hours)} 小时` : '', minutes > 0 ? `${minutes} 分` : '', rest > 0 ? tr("{v0} 秒", { v0: rest }) : ''].filter(Boolean).join(' ')
}
function formatRecordingQuotaMinutes(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  if (minutes === 0) return getArkmeLocale() === 'en' ? '0m' : '0 分'
  return formatUsageSeconds(minutes * 60)
}

export function usageLevel(used: number, total: number): 'normal' | 'low' | 'exhausted' {
  return total <= used ? 'exhausted' : (total - used) / total <= 0.1 ? 'low' : 'normal'
}
function UsageBar({ used, total, label, description }: { used: number; total: number; label: string; description?: string | undefined }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : 100
  return <span className="arkme-usage-track" role="progressbar" aria-label={label} aria-valuetext={description} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    <span style={{ width: `${percent}%` }} />
  </span>
}
function Pending({ status, onRetry }: { status: 'loading' | 'error'; onRetry: () => void }) {
  return <p className="arkme-usage-muted">{status === 'loading' ? tr("读取中…") : <>{tr('暂时无法读取')} <button type="button" onClick={onRetry}>{tr('重试')}</button></>}</p>
}

function UsageSummaryRow({ label, kind, measurement, pending, description }: {
  label: string
  kind: string
  measurement?: { used: number; total: number; totalText: string; description: string } | undefined
  pending?: string
  description?: string
}) {
  const level = measurement ? usageLevel(measurement.used, measurement.total) : 'normal'
  const tooltip = measurement ? `${measurement.description}${level === 'exhausted' ? '；额度已用尽' : level === 'low' ? '；剩余额度不足 10%' : ''}` : description ?? pending
  return <span className="arkme-usage-summary-row" data-usage-kind={kind} data-usage-level={level} title={tooltip}>
    <span className="arkme-usage-summary-label">{label}</span>
    {measurement ? <UsageBar used={measurement.used} total={measurement.total} label={tr("{v0}已用比例", { v0: label })} description={tooltip} />
      : <span className="arkme-usage-track is-placeholder" aria-hidden="true" />}
    <strong className="arkme-usage-summary-total">{measurement?.totalText ?? pending}</strong>
  </span>
}

/** Four compact rows; only authoritative measured quantities get progress values. */
export function ArkmeAccountUsage({ accountScope, onOpenDetails }: { accountScope: string; onOpenDetails: () => void }) {
  useArkmeLocale()
  const points = useUsage<ArkmeAiPointsAccount>('account.points.query', accountScope, 0)
  const storage = useUsage<ArkmeAccountStorageUsage>('account.usage.storage', accountScope, 0)
  const voice = useUsage<ArkmeAccountVoiceUsage>('account.usage.voice', accountScope, 0)
  const recording = useUsage<ArkmeAccountRecordingUsage>('account.usage.recording', accountScope, 0)
  const status = (state: ReadState<unknown>) => state.status === 'loading' ? '读取中…' : '暂不可用'
  return <button type="button" className="arkme-usage-summary" aria-label={tr("查看用量与额度详情")} onClick={onOpenDetails}>
    <span className="arkme-usage-summary-heading"><strong>{tr("用量与额度")}</strong><span>{tr("详情 ›")}</span></span>
    <span className="arkme-usage-summary-rows" aria-live="polite">
      <span className="arkme-usage-summary-row" data-usage-kind="ai-points">
        <span className="arkme-usage-summary-label">{tr('AI 额度')}</span>
        <strong className="arkme-usage-summary-total">{points.status === 'ready' ? `${formatWholePoints(points.value.availablePoints)} ${tr('积分')}` : status(points)}</strong>
      </span>
      <UsageSummaryRow label={tr("云端存储")} kind="storage" pending={status(storage)} measurement={storage.status === 'ready' ? {
        used: storage.value.usedBytes, total: storage.value.totalBytes, totalText: formatUsageBytes(storage.value.totalBytes),
        description: tr("已用 {v0} / 剩余 {v1} / 共 {v2}", { v0: formatUsageBytes(storage.value.usedBytes), v1: formatUsageBytes(Math.max(0, storage.value.totalBytes - storage.value.usedBytes)), v2: formatUsageBytes(storage.value.totalBytes) }),
      } : undefined} />
      <UsageSummaryRow label={tr("语音转文字")} kind="voice-transcription" pending={status(voice)} measurement={voice.status === 'ready' ? {
        used: voice.value.usedSeconds, total: voice.value.usedSeconds + voice.value.remainingSeconds,
        totalText: formatUsageSeconds(voice.value.usedSeconds + voice.value.remainingSeconds),
        description: tr("本月已用 {v0} / 剩余 {v1} / 共 {v2}", { v0: formatUsageSeconds(voice.value.usedSeconds), v1: formatUsageSeconds(voice.value.remainingSeconds), v2: formatUsageSeconds(voice.value.usedSeconds + voice.value.remainingSeconds) }),
      } : undefined} />
      <UsageSummaryRow label={tr("录音转写")} kind="recording-transcription" pending={tr(recording.status !== 'ready' && recording.unavailable ? '统计尚未启用' : status(recording))} measurement={recording.status === 'ready' && recording.value.totalSeconds !== null && recording.value.remainingSeconds !== null ? {
        used: recording.value.usedSeconds, total: recording.value.totalSeconds, totalText: formatUsageSeconds(recording.value.totalSeconds),
        description: tr("本月已用 {v0} / 剩余 {v1} / 共 {v2}", { v0: formatRecordingQuotaMinutes(recording.value.usedSeconds), v1: formatRecordingQuotaMinutes(recording.value.remainingSeconds), v2: formatUsageSeconds(recording.value.totalSeconds) }),
      } : undefined} />
    </span>
  </button>
}

/** Read only while open; no polling or locally estimated quota values. */
interface UsageDetailsProps {
  accountScope: string
  onViewMembership: () => void
}
export function ArkmeAccountUsageDetails(props: UsageDetailsProps) {
  const [creditsRevision, setCreditsRevision] = useState(0)
  const onCreditsChanged = useCallback(() => setCreditsRevision(value => value + 1), [])
  return <ArkmeBillingSettings key={props.accountScope} active={false} modal onCreditsChanged={onCreditsChanged} renderTrigger={({ onOpen }) =>
    <UsageDetailsContent {...props} creditsRevision={creditsRevision} onRecharge={onOpen} />
  } />
}
function UsageDetailsContent({ accountScope, onViewMembership, onRecharge, creditsRevision }: UsageDetailsProps & {
  onRecharge: () => void
  creditsRevision: number
}) {
  useArkmeLocale()
  const [revision, setRevision] = useState(0)
  const [pointsOpen, setPointsOpen] = useState(false), [storageOpen, setStorageOpen] = useState(false)
  const pointsId = useId(), storageId = useId()
  const points = useUsage<ArkmeAiPointsAccount>('account.points.query', accountScope, revision + creditsRevision)
  const storage = useUsage<ArkmeAccountStorageUsage>('account.usage.storage', accountScope, revision)
  const voice = useUsage<ArkmeAccountVoiceUsage>('account.usage.voice', accountScope, revision)
  const recording = useUsage<ArkmeAccountRecordingUsage>('account.usage.recording', accountScope, revision)
  const [recordingOpen, setRecordingOpen] = useState(false)
  const recordingId = useId()
  const retry = () => setRevision(value => value + 1)
  const storageLevel = storage.status === 'ready' ? usageLevel(storage.value.usedBytes, storage.value.totalBytes) : 'normal'
  const voiceTotal = voice.status === 'ready' ? voice.value.usedSeconds + voice.value.remainingSeconds : 0
  const voiceLevel = voice.status === 'ready' ? usageLevel(voice.value.usedSeconds, voiceTotal) : 'normal'
  return <section className="arkme-account-usage" aria-label={tr("用量与额度")}>
    <header><h3>{tr("用量与额度")}</h3></header>
    <div className="arkme-usage-metric" data-usage-kind="ai-points" aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr('AI 额度')}</strong><button type="button" className="arkme-usage-action" onClick={onRecharge}>{tr('充值 ›')}</button></div>
      {points.status !== 'ready' ? <Pending status={points.status} onRetry={retry} /> : <>
        <p className="arkme-usage-points-balance"><span>{tr('可用')} <strong>{formatWholePoints(points.value.availablePoints)}</strong> {tr('积分')}</span><span className="arkme-usage-points-sources">{tr('赠送 {v0} · 充值 {v1}', { v0: formatWholePoints(points.value.grantedPoints), v1: formatWholePoints(points.value.purchasedPoints) })}</span></p>
        {points.value.grants.some(grant => grant.expiresAt > 0) && <small>{tr('赠送积分到期时间')} {new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(Math.min(...points.value.grants.filter(grant => grant.expiresAt > 0).map(grant => grant.expiresAt - 1)))}</small>}
      </>}
      <button type="button" className="arkme-points-disclosure" aria-expanded={pointsOpen} aria-controls={pointsId} onClick={() => setPointsOpen(value => !value)}>{tr('消费记录')} <span aria-hidden>{pointsOpen ? '⌄' : '›'}</span></button>
      {pointsOpen && <div id={pointsId}><ArkmePointsConsumption key={accountScope} scope={accountScope} revision={revision + creditsRevision} /></div>}
    </div>
    <div className="arkme-usage-metric" data-usage-level={storageLevel} aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr("云端存储")}</strong><span className="arkme-usage-label-actions">
        {storage.status === 'ready' && <span>{storageLevel === 'exhausted' ? tr('空间已用满') : storageLevel === 'low' ? tr('空间不足 10%') : tr("剩余 {v0}", { v0: formatUsageBytes(Math.max(0, storage.value.totalBytes - storage.value.usedBytes)) })}</span>}
        <button type="button" aria-expanded={storageOpen} aria-controls={storageId} onClick={() => setStorageOpen(value => !value)}>{tr(storageOpen ? '收起空间构成' : '空间构成')} <span aria-hidden>{storageOpen ? '⌄' : '›'}</span></button>
      </span></div>
      {storage.status !== 'ready' ? <Pending status={storage.status} onRetry={retry} /> : <>
        <p>{tr("已用")} {formatUsageBytes(storage.value.usedBytes)} {tr("/ 共")} {formatUsageBytes(storage.value.totalBytes)}</p>
        <UsageBar used={storage.value.usedBytes} total={storage.value.totalBytes} label={tr("云端存储已用比例")} />
        {storageLevel !== 'normal' && <button type="button" className="arkme-usage-action" onClick={onViewMembership}>{tr("查看存储权益 ›")}</button>}
      </>}
      {storageOpen && <div id={storageId}>{storage.status === 'ready' ? <ArkmeStorageUsageBreakdown usage={storage.value} formatBytes={formatUsageBytes} /> : <Pending status={storage.status} onRetry={retry} />}</div>}
    </div>
    <div className="arkme-usage-metric" data-usage-kind="voice-transcription" data-usage-level={voiceLevel} aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr("语音转文字")}</strong>{voice.status === 'ready' && <span>{voiceLevel === 'exhausted' ? '本月额度已用尽' : voiceLevel === 'low' ? '余量较少' : tr("每月 {v0}", { v0: formatUsageSeconds(voiceTotal) })}</span>}</div>
      {voice.status !== 'ready' ? <Pending status={voice.status} onRetry={retry} /> : <>
        <p>{tr("已用")} {formatUsageSeconds(voice.value.usedSeconds)} {tr("/ 剩余")} {formatUsageSeconds(voice.value.remainingSeconds)}</p>
        <UsageBar used={voice.value.usedSeconds} total={voiceTotal} label={tr("语音转文字已用比例")} />
        {voiceLevel !== 'normal' && <button type="button" className="arkme-usage-action" onClick={onViewMembership}>{tr("查看语音转文字权益 ›")}</button>}
      </>}
      <small>{tr("语音输入与快记语音的月度权益，不含下方录音文件转写")}</small>
    </div>
    <div className="arkme-usage-metric" data-usage-kind="recording-transcription" aria-live="polite"
      data-usage-level={recording.status === 'ready' && recording.value.totalSeconds !== null ? usageLevel(recording.value.usedSeconds, recording.value.totalSeconds) : 'normal'}>
      <div className="arkme-usage-label"><strong>{tr("录音转写")}</strong>{recording.status === 'ready' && <span className="arkme-usage-label-actions">
        {recording.value.totalSeconds !== null && <span>{tr("每月 {v0}", { v0: formatUsageSeconds(recording.value.totalSeconds) })}</span>}
        <button type="button" aria-expanded={recordingOpen} aria-controls={recordingId} onClick={() => setRecordingOpen(value => !value)}>{tr(recordingOpen ? '收起来源明细' : '来源明细')} <span aria-hidden>{recordingOpen ? '⌄' : '›'}</span></button>
      </span>}</div>
      {recording.status !== 'ready' ? recording.unavailable ? <p className="arkme-usage-muted">{tr("录音转写统计尚未启用")}</p> : <Pending status={recording.status} onRetry={retry} /> : <>
        <p>{tr("已用")} {formatRecordingQuotaMinutes(recording.value.usedSeconds)}{recording.value.remainingSeconds !== null && <> {tr("/ 剩余")} {formatRecordingQuotaMinutes(recording.value.remainingSeconds)}</>}</p>
        {recording.value.totalSeconds !== null && <UsageBar used={recording.value.usedSeconds} total={recording.value.totalSeconds} label={tr("录音转写已用比例")} />}
        {recording.value.pendingChildCount > 0 && <small>{tr("还有 {v0} 段录音待结算，当前用量仅含已结算部分", { v0: recording.value.pendingChildCount })}</small>}
        {recordingOpen && <div id={recordingId} className="arkme-usage-breakdown arkme-recording-breakdown">
          <table><caption>{tr("录音来源用量明细")}</caption><thead><tr>{['来源', '录音总时长', '人声时长'].map(label => <th scope="col" key={label}>{tr(label)}</th>)}</tr></thead>
            <tbody>{recording.value.breakdown.map(row => <tr key={row.recordingKind}>
              <th scope="row">{tr(({ 1: '长录音', 2: '全天候录音', 3: '文件上传' } as const)[row.recordingKind])}</th>
              <td>{row.recordingDurationMillis == null ? '—' : formatUsageSeconds(row.recordingDurationMillis / 1000)}</td>
              <td>{formatUsageSeconds(row.speechDurationMillis / 1000)}</td>
            </tr>)}</tbody></table>
        </div>}
      </>}
      <small>{tr("录音按人声时长计量，录音静音时长不计量")}</small>
    </div>
  </section>
}

export function ArkmeAccountUsageDialog({ accountScope, onViewMembership, onClose, returnFocusRef }: {
  accountScope: string
  onViewMembership: () => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement>
}) {
  useArkmeLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
      queueMicrotask(() => returnFocusRef?.current?.focus({ preventScroll: true }))
    }
  }, [returnFocusRef])
  return createPortal(<dialog ref={dialog} className="arkme-usage-dialog" aria-label={tr("用量与额度详情")} data-arkme-notification-blocking-overlay="true"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <button type="button" autoFocus className="arkme-usage-close" aria-label={tr("关闭用量与额度详情")} onClick={onClose}><X size={18} aria-hidden /></button>
    <ArkmeAccountUsageDetails accountScope={accountScope} onViewMembership={onViewMembership} />
  </dialog>, document.body)
}
