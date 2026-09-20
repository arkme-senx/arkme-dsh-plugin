import { tr, useArkmeLocale, arkmeIntlLocale, getArkmeLocale } from './locale.js'
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeAccountStorageUsage, ArkmeAccountTokenUsage, ArkmeAccountVoiceUsage } from '../account-usage.js'
import { callArkme } from './api.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { ArkmeBillingSettings, formatArkmeNanoCny, type ArkmeQuotaViewState } from './ArkmeBillingSettings.js'
import { ArkmeStorageUsageBreakdown, ArkmeTokenUsageBreakdown } from './ArkmeUsageBreakdown.js'

type ReadState<T> = { status: 'loading' | 'error' } | { status: 'ready'; value: T }
type UsageValue = ArkmeAccountStorageUsage | ArkmeAccountTokenUsage | ArkmeAccountVoiceUsage
function useUsage<T extends UsageValue>(operation: 'account.usage.tokens' | 'account.usage.storage' | 'account.usage.voice', scope: string, revision: number): ReadState<T> {
  const [result, setResult] = useState<{ scope: string; revision: number; state: ReadState<T> }>()
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void callArkme<T>(operation, { expectedAccountScope: scope }, controller.signal).then(value => {
      if (active) setResult({ scope, revision, state: value.accountScope === scope ? { status: 'ready', value } : { status: 'error' } })
    }).catch(() => {
      if (active) setResult({ scope, revision, state: { status: 'error' } })
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
  if (getArkmeLocale() === 'en') {
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60
    return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', rest || seconds === 0 ? `${rest}s` : ''].filter(Boolean).join(' ')
  }
  if (seconds === 0) return '0 秒'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = seconds % 60
  return [hours > 0 ? `${numberFormat.format(hours)} 小时` : '', minutes > 0 ? `${minutes} 分` : '', rest > 0 ? tr("{v0} 秒", { v0: rest }) : ''].filter(Boolean).join(' ')
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
function Pending({ status }: { status: 'loading' | 'error' }) {
  return <p className="arkme-usage-muted">{status === 'loading' ? tr("读取中…") : tr("暂时无法读取，请刷新重试")}</p>
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
  const tokens = useUsage<ArkmeAccountTokenUsage>('account.usage.tokens', accountScope, 0)
  const storage = useUsage<ArkmeAccountStorageUsage>('account.usage.storage', accountScope, 0)
  const voice = useUsage<ArkmeAccountVoiceUsage>('account.usage.voice', accountScope, 0)
  const status = (state: ReadState<unknown>) => state.status === 'loading' ? '读取中…' : '暂不可用'
  return <button type="button" className="arkme-usage-summary" aria-label={tr("查看用量与额度详情")} onClick={onOpenDetails}>
    <span className="arkme-usage-summary-heading"><strong>{tr("用量与额度")}</strong><span>{tr("详情 ›")}</span></span>
    <span className="arkme-usage-summary-rows" aria-live="polite">
      <UsageSummaryRow label={tr("月度 Token")} kind="tokens" pending={status(tokens)} measurement={tokens.status === 'ready' ? {
        used: tokens.value.used, total: tokens.value.used + tokens.value.remaining,
        totalText: formatCompactTokens(tokens.value.used + tokens.value.remaining),
        description: tr("本月已用 {v0} / 剩余 {v1} / 共 {v2} Token", { v0: numberFormat.format(tokens.value.used), v1: numberFormat.format(tokens.value.remaining), v2: numberFormat.format(tokens.value.used + tokens.value.remaining) }),
      } : undefined} />
      <UsageSummaryRow label={tr("云端存储")} kind="storage" pending={status(storage)} measurement={storage.status === 'ready' ? {
        used: storage.value.usedBytes, total: storage.value.totalBytes, totalText: formatUsageBytes(storage.value.totalBytes),
        description: tr("已用 {v0} / 剩余 {v1} / 共 {v2}", { v0: formatUsageBytes(storage.value.usedBytes), v1: formatUsageBytes(Math.max(0, storage.value.totalBytes - storage.value.usedBytes)), v2: formatUsageBytes(storage.value.totalBytes) }),
      } : undefined} />
      <UsageSummaryRow label={tr("语音转文字")} kind="voice-transcription" pending={status(voice)} measurement={voice.status === 'ready' ? {
        used: voice.value.usedSeconds, total: voice.value.usedSeconds + voice.value.remainingSeconds,
        totalText: formatUsageSeconds(voice.value.usedSeconds + voice.value.remainingSeconds),
        description: tr("本月已用 {v0} / 剩余 {v1} / 共 {v2}", { v0: formatUsageSeconds(voice.value.usedSeconds), v1: formatUsageSeconds(voice.value.remainingSeconds), v2: formatUsageSeconds(voice.value.usedSeconds + voice.value.remainingSeconds) }),
      } : undefined} />
      <UsageSummaryRow label={tr("录音转写")} kind="recording-transcription" pending={tr('暂未做限制')} description={tr("录音文件转写暂未做限制；用量统计待接入，灰轨不代表已用为零")} />
    </span>
  </button>
}

/** Read only while open; no polling or locally estimated quota values. */
interface UsageDetailsProps {
  accountScope: string
  onViewMembership: () => void
  onRefreshMembership: () => void
}
export function ArkmeAccountUsageDetails(props: UsageDetailsProps) {
  return <ArkmeBillingSettings key={props.accountScope} modal renderTrigger={({ quotaState, onOpen, onRefresh }) =>
    <UsageDetailsContent {...props} balance={quotaState} onRecharge={onOpen} onRefreshBalance={onRefresh} />
  } />
}
function UsageDetailsContent({ accountScope, onViewMembership, onRefreshMembership, balance, onRecharge, onRefreshBalance }: UsageDetailsProps & {
  balance: ArkmeQuotaViewState
  onRecharge: () => void
  onRefreshBalance: () => void
}) {
  useArkmeLocale()
  const [revision, setRevision] = useState(0)
  const [tokensOpen, setTokensOpen] = useState(false), [storageOpen, setStorageOpen] = useState(false)
  const tokensId = useId(), storageId = useId()
  const tokens = useUsage<ArkmeAccountTokenUsage>('account.usage.tokens', accountScope, revision)
  const storage = useUsage<ArkmeAccountStorageUsage>('account.usage.storage', accountScope, revision)
  const voice = useUsage<ArkmeAccountVoiceUsage>('account.usage.voice', accountScope, revision)
  const loading = tokens.status === 'loading' || storage.status === 'loading' || voice.status === 'loading' || balance.kind === 'loading'
  const tokenTotal = tokens.status === 'ready' ? tokens.value.used + tokens.value.remaining : 0
  const tokenLevel = tokens.status === 'ready' ? usageLevel(tokens.value.used, tokenTotal) : 'normal'
  const storageLevel = storage.status === 'ready' ? usageLevel(storage.value.usedBytes, storage.value.totalBytes) : 'normal'
  const voiceTotal = voice.status === 'ready' ? voice.value.usedSeconds + voice.value.remainingSeconds : 0
  const voiceLevel = voice.status === 'ready' ? usageLevel(voice.value.usedSeconds, voiceTotal) : 'normal'
  return <section className="arkme-account-usage" aria-label={tr("用量与额度")}>
    <header><h3>{tr("用量与额度")}</h3><button type="button" aria-label={tr("刷新用量与额度")} disabled={loading} onClick={() => {
      setRevision(value => value + 1); onRefreshMembership(); onRefreshBalance()
    }}><ArrowsClockwise size={13} aria-hidden />{loading ? tr("读取中") : tr("刷新")}</button></header>
    <div className="arkme-usage-metric" data-usage-level={tokenLevel} aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr("月度赠送 Token")}</strong><span className="arkme-usage-label-actions">
        {tokens.status === 'ready' && <span>{tr(tokenLevel === 'exhausted' ? '暂无可用额度' : tokenLevel === 'low' ? '余量较少' : '可用')}</span>}
        <button type="button" aria-expanded={tokensOpen} aria-controls={tokensId} onClick={() => setTokensOpen(value => !value)}>{tr(tokensOpen ? '收起 Token 明细' : '查看 Token 明细')} <span aria-hidden>{tokensOpen ? '⌄' : '›'}</span></button>
      </span></div>
      {tokens.status !== 'ready' ? <Pending status={tokens.status} /> : <>
        <p>{tr("已用")} {numberFormat.format(tokens.value.used)} {tr("/ 剩余")} {numberFormat.format(tokens.value.remaining)}</p>
        <UsageBar used={tokens.value.used} total={tokenTotal} label={tr("Token 额度已用比例")} />
        {tokenLevel !== 'normal' && <button type="button" className="arkme-usage-action" onClick={onViewMembership}>{tr("查看会员 Token 权益 ›")}</button>}
      </>}
      <small>{tr("月度额度与充值余额分开计量，不合并折算")}</small>
      {tokensOpen && <div id={tokensId}><ArkmeTokenUsageBreakdown key={accountScope} scope={accountScope} revision={revision} /></div>}
    </div>
    <div className="arkme-usage-metric" data-usage-kind="ai-balance" aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr("AI 充值余额")}</strong><button type="button" className="arkme-usage-action" onClick={onRecharge}>{tr("充值 ›")}</button></div>
      {balance.kind !== 'ready' ? <Pending status={balance.kind} /> : <>
        <p className="arkme-usage-balance-amount">{tr("可用")} <strong>{formatArkmeNanoCny(balance.quota.availableNanoCny)}</strong></p>
        {BigInt(balance.quota.reservedNanoCny) > 0n && <small>{tr("任务预占")} {formatArkmeNanoCny(balance.quota.reservedNanoCny)}{tr("，结算后释放未用部分")}</small>}
      </>}
      <small>{tr("用于按余额计费的 AI 功能，不代表月度 Token 用尽后自动接续")}</small>
    </div>
    <div className="arkme-usage-metric" data-usage-level={storageLevel} aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr("云端存储")}</strong><span className="arkme-usage-label-actions">
        {storage.status === 'ready' && <span>{storageLevel === 'exhausted' ? tr('空间已用满') : storageLevel === 'low' ? tr('空间不足 10%') : tr("剩余 {v0}", { v0: formatUsageBytes(Math.max(0, storage.value.totalBytes - storage.value.usedBytes)) })}</span>}
        <button type="button" aria-expanded={storageOpen} aria-controls={storageId} onClick={() => setStorageOpen(value => !value)}>{tr(storageOpen ? '收起空间构成' : '空间构成')} <span aria-hidden>{storageOpen ? '⌄' : '›'}</span></button>
      </span></div>
      {storage.status !== 'ready' ? <Pending status={storage.status} /> : <>
        <p>{tr("已用")} {formatUsageBytes(storage.value.usedBytes)} {tr("/ 共")} {formatUsageBytes(storage.value.totalBytes)}</p>
        <UsageBar used={storage.value.usedBytes} total={storage.value.totalBytes} label={tr("云端存储已用比例")} />
        {storageLevel !== 'normal' && <button type="button" className="arkme-usage-action" onClick={onViewMembership}>{tr("查看存储权益 ›")}</button>}
      </>}
      {storageOpen && <div id={storageId}>{storage.status === 'ready' ? <ArkmeStorageUsageBreakdown usage={storage.value} formatBytes={formatUsageBytes} /> : <Pending status={storage.status} />}</div>}
    </div>
    <div className="arkme-usage-metric" data-usage-kind="voice-transcription" data-usage-level={voiceLevel} aria-live="polite">
      <div className="arkme-usage-label"><strong>{tr("语音转文字")}</strong>{voice.status === 'ready' && <span>{voiceLevel === 'exhausted' ? '本月额度已用尽' : voiceLevel === 'low' ? '余量较少' : tr("每月 {v0}", { v0: formatUsageSeconds(voiceTotal) })}</span>}</div>
      {voice.status !== 'ready' ? <Pending status={voice.status} /> : <>
        <p>{tr("已用")} {formatUsageSeconds(voice.value.usedSeconds)} {tr("/ 剩余")} {formatUsageSeconds(voice.value.remainingSeconds)}</p>
        <UsageBar used={voice.value.usedSeconds} total={voiceTotal} label={tr("语音转文字已用比例")} />
        {voiceLevel !== 'normal' && <button type="button" className="arkme-usage-action" onClick={onViewMembership}>{tr("查看语音转文字权益 ›")}</button>}
      </>}
      <small>{tr("语音输入与快记语音的月度权益，不含下方录音文件转写")}</small>
    </div>
    <div className="arkme-usage-metric" data-usage-kind="recording-transcription">
      <div className="arkme-usage-label"><strong>{tr("录音转写")}</strong><span className="arkme-usage-unlimited">{tr("暂未做限制")}</span></div>
      <p className="arkme-usage-muted">{tr("用量统计待接入")}</p>
      <small>{tr("指录音板块的文件转写，不含 AI 总结")}</small>
    </div>
  </section>
}

export function ArkmeAccountUsageDialog({ accountScope, onViewMembership, onRefreshMembership, onClose, returnFocusRef }: {
  accountScope: string
  onViewMembership: () => void
  onRefreshMembership: () => void
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
    <ArkmeAccountUsageDetails accountScope={accountScope} onViewMembership={onViewMembership} onRefreshMembership={onRefreshMembership} />
  </dialog>, document.body)
}
