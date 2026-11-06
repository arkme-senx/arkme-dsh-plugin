import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Flag } from '@phosphor-icons/react/dist/icons/Flag'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArkmeWorldFeedItem } from '../types.js'
import { WORLD_REPORT_REASONS } from '../world-report-contract.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { ArkmeClientError, callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

export { WORLD_REPORT_REASONS } from '../world-report-contract.js'
const button: CSSProperties = { minHeight: 36, padding: '7px 16px', border: `1px solid ${c.border}`, borderRadius: 9, background: c.base, color: c.text, cursor: 'pointer' }

export function WorldReportDialog({ item, userId, onClose, onSubmitted }: { item: ArkmeWorldFeedItem; userId: number; onClose(): void; onSubmitted(): void }) {
  useArkmeLocale()
  const [ready, setReady] = useState(false)
  const [type, setType] = useState<number>(), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const identity = useRef<{ payload: string; uid: string }>()
  const active = useRef<AbortController>(), mounted = useRef(true), running = useRef(false), closeButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose), submittedRef = useRef(onSubmitted)
  closeRef.current = onClose; submittedRef.current = onSubmitted
  const valid = !!type && reason.trim().length > 0 && [...reason].length <= 500 && !busy && ready
  function acknowledge(requestUid:string) {
    void callArkme('world.report',{action:'acknowledge',recordRef:item.recordRef,expectedUserId:userId,requestUid}).catch(()=>{})
  }
  async function restorePending() {
    setReady(false); setError('')
    try {
      const result = await callArkme<import('../world-report-contract.js').WorldReportResult>('world.report', {action:'pending', recordRef:item.recordRef, expectedUserId:userId})
      if (!mounted.current) return
      if (result.pending) {
        const pending = result.pending
        if(result.submitted===true){submittedRef.current();acknowledge(pending.requestUid);return}
        setType(pending.reportType); setReason(pending.reason); setUncertain(true)
        identity.current = {payload:JSON.stringify([pending.reportType,pending.reason]),uid:pending.requestUid}
      }
      setReady(true)
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : tr('举报恢复信息暂不可用'))
    }
  }
  useEffect(() => {
    mounted.current = true
    void restorePending()
    if (typeof document === 'undefined') return () => { mounted.current = false; active.current?.abort() }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    closeButton.current?.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running.current) { e.preventDefault(); closeRef.current() } }
    document.addEventListener('keydown', escape)
    return () => { mounted.current = false; active.current?.abort(); document.removeEventListener('keydown', escape); trigger?.focus({ preventScroll: true }) }
  }, [])
  async function submit() {
    if (!valid || running.current) return
    const payload = JSON.stringify([type, reason.trim()])
    if (!identity.current || identity.current.payload !== payload) identity.current = { payload, uid: crypto.randomUUID() }
    const requestUid = identity.current.uid
    const controller = new AbortController(); active.current = controller; running.current = true; setBusy(true); setError('')
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const result = await callArkme<{ submitted: boolean }>('world.report', { action:'submit', confirmed:true, recordRef: item.recordRef, expectedUserId: userId, reportType: type, reason: reason.trim(), requestUid }, controller.signal)
      if (!mounted.current) return
      if (controller.signal.aborted) throw new Error('unconfirmed report')
      if (result.submitted !== true) throw new Error(tr('举报提交结果尚未确认，请勿重复提交'))
      submittedRef.current()
      acknowledge(requestUid)
    } catch (caught) {
      if (!mounted.current) return
      const unknown = !(caught instanceof ArkmeClientError && caught.body.code === 'world-report-rejected')
      if (!unknown) identity.current = undefined
      setUncertain(unknown)
      setError(unknown ? tr('举报提交结果尚未确认，请核对上次提交') : caught instanceof Error ? tr(caught.message) : tr('举报提交失败，请稍后重试'))
    } finally {
      clearTimeout(timer); running.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const dialog = <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 10300, display: 'grid', placeItems: 'center', padding: 16, background: 'var(--dsw-alias-bg-mask-1,rgba(19,22,26,.34))' }} onMouseDown={e => { if (e.currentTarget === e.target && !running.current) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="world-report-title" style={{ position: 'relative', width: 'min(420px,100%)', boxSizing: 'border-box', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', padding: 22, border: `1px solid ${c.border}`, borderRadius: 14, background: c.base, color: c.text, boxShadow: c.shadow }}>
      <ArkmeCloseButton ref={closeButton} type="button" aria-label={tr('关闭举报')} disabled={busy} onClick={onClose} style={{ position: 'absolute', right: 14, top: 14 }} />
      <h2 id="world-report-title" style={{ margin: '0 36px 12px 0', fontSize: 18 }}>{tr('举报反馈')}</h2>
      <p style={{ margin: '0 0 16px', padding: 10, borderRadius: 9, background: c.layer1, color: c.secondary, fontSize: 12, lineHeight: '18px', maxHeight: 54, overflow: 'hidden', overflowWrap: 'anywhere' }}>{item.authorName} · {item.headline || item.textContent || tr('声音或媒体内容')}</p>
      <fieldset disabled={busy || uncertain || !ready} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, marginBottom: 10 }}>{tr('请选择你要举报的类型')}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {WORLD_REPORT_REASONS.map((label, i) => <label key={label} style={{ ...button, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', fontSize: 13, ...(type === i + 1 ? { borderColor: c.info, background: c.infoSoft } : {}) }}>
            <input type="radio" name="world-report-type" value={i + 1} checked={type === i + 1} onChange={() => { setType(i + 1); setError('') }} />{tr(label)}
          </label>)}
        </div>
        <label style={{ display: 'block', marginTop: 18, fontSize: 13 }}>{tr('问题说明（必填）')}
          <textarea aria-label={tr('举报补充说明')} value={reason} placeholder={tr('请描述你遇到的问题')} onChange={e => { setReason([...e.currentTarget.value].slice(0, 500).join('')); setError('') }} style={{ boxSizing: 'border-box', width: '100%', minHeight: 92, marginTop: 8, padding: 10, resize: 'vertical', border: `1px solid ${c.border}`, borderRadius: 9, background: c.input, color: c.text, font: 'inherit' }} />
        </label>
        <div style={{ textAlign: 'right', color: c.tertiary, fontSize: 11 }}>{[...reason].length}/500</div>
      </fieldset>
      {error && <p role="alert" style={{ color: c.danger, background: c.dangerSoft, padding: 10, borderRadius: 8, fontSize: 12, lineHeight: '18px' }}>{error}</p>}
      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button type="button" disabled={busy} onClick={onClose} style={button}>{tr('取消')}</button>
        <button type="button" aria-label={tr(uncertain ? '核对上次提交' : '提交举报')} disabled={busy || ready && !valid} onClick={() => { void (ready ? submit() : restorePending()) }} style={{ ...button, borderColor: 'transparent', background: c.primaryAction, color: c.onPrimaryAction, opacity: valid ? 1 : .45 }}>{busy ? tr('提交中…') : !ready ? tr('重试') : uncertain ? tr('核对上次提交') : tr('提交')}</button>
      </footer>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export function WorldReportActions({ item }: { item: ArkmeWorldFeedItem }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const [menu, setMenu] = useState(false), [dialog, setDialog] = useState(false), [notice, setNotice] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  useEffect(() => { setMenu(false); setDialog(false); setNotice(false) }, [account, item.recordRef])
  if (!account || !auth?.userId || !item.authorRef && !item.teamAuthor) return null
  return <div style={{ display: 'inline-flex' }}>
    <ArkmeActionMenu label={tr('世界内容操作')} open={menu} align="end" onClose={() => setMenu(false)} actions={[
      { id: 'report', label: tr('举报'), icon: <Flag size={18} />, onSelect: () => { setMenu(false); setDialog(true) } },
    ]} anchor={<button ref={anchor} type="button" aria-label={tr('更多动态操作')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(v => !v)} style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: c.secondary, cursor: 'pointer' }}><DotsThree size={20} /></button>} />
    {dialog && <WorldReportDialog key={`${account}:${item.recordRef}`} item={item} userId={auth.userId} onClose={() => setDialog(false)} onSubmitted={() => { setDialog(false); setNotice(true) }} />}
    {notice && (typeof document === 'undefined' ? <span role="status">{tr('举报已提交')}</span> : <Toast text={tr('举报已提交')} anchor={anchor.current} onDone={() => setNotice(false)} />)}
  </div>
}
