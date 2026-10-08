import { X } from '@phosphor-icons/react/X'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeCancellationSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'

export function ArkmeAccountCancellation({ userId, disabled, onBusyChange, onComplete }: {
  userId: number
  disabled: boolean
  onBusyChange(busy: boolean): void
  onComplete(result: ArkmeCancellationSnapshot): void
}) {
  const [preview, setPreview] = useState<ArkmeCancellationSnapshot>()
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  const run = async (submit: boolean) => {
    if (busyRef.current || disabled || submit && confirmation !== '确认注销') return
    const current = generation.current
    busyRef.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      const result = submit
        ? await callArkme<ArkmeCancellationSnapshot>('auth.cancellation.submit', { expectedUserId: userId, expectedMode: preview!.mode })
        : await callArkme<ArkmeCancellationSnapshot>('auth.cancellation.preview', { expectedUserId: userId })
      if (generation.current !== current) return
      if (submit && (result.status === 'done' || result.status === 'waiting')) onComplete(result)
      else {
        setPreview(result); setConfirmation('')
        if (result.changed) setError(tr('注销方式已变化，请重新确认'))
      }
    } catch (caught) {
      if (generation.current === current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      busyRef.current = false
      if (generation.current === current) { setBusy(false); onBusyChange(false) }
    }
  }
  const close = () => { if (!busyRef.current) { setPreview(undefined); setError(''); setConfirmation('') } }
  return <>
    <button data-arkme-feedback="danger" type="button" disabled={disabled || busy} onClick={() => { void run(false) }}>
      {busy && preview === undefined ? tr('正在检查…') : tr('注销账号')}
    </button>
    {error && preview === undefined ? <p className="arkme-account-dialog-status is-error" role="alert">{error}</p> : null}
    {preview !== undefined ? <div className="arkme-account-dialog-backdrop" role="presentation">
      <section className="arkme-account-dialog arkme-cancellation-dialog" role="dialog" aria-modal="true" aria-label={tr('注销账号')}>
        <header>
          <h3>{tr('注销账号')}</h3>
          <button type="button" data-arkme-feedback="neutral" aria-label={tr('关闭')} disabled={busy} onClick={close}><X size={20} aria-hidden /></button>
        </header>
        <form className="arkme-account-form arkme-cancellation-form" onSubmit={event => { event.preventDefault(); void run(true) }}>
        <p className="arkme-cancellation-description">{tr(preview.mode === 'immediate' ? '无需等待，将立即注销。注销完成后无法恢复登录。' : '账号将在 15 天等待期结束后注销，期间继续登录可撤销注销。')}</p>
        {preview.mode === 'waiting' && preview.has_phone ? <p className="arkme-account-rule">{tr('申请成功、剩余 5 天及剩余 1 天时，将向绑定手机号发送短信提醒。')}</p> : null}
          <label>{tr('请输入“确认注销”')}<input autoFocus value={confirmation} disabled={busy} onChange={event => { setConfirmation(event.target.value) }} /></label>
          {error ? <p className="arkme-account-dialog-status is-error" role="alert">{error}</p> : null}
          <footer className="arkme-account-dialog-actions">
            <button type="button" disabled={busy} onClick={close}>{tr('取消')}</button>
            <button className="arkme-cancellation-confirm" type="submit" data-arkme-feedback="danger" disabled={busy || confirmation !== '确认注销'}>{tr(busy ? '正在处理…' : '确认注销')}</button>
          </footer>
        </form>
      </section>
    </div> : null}
  </>
}
