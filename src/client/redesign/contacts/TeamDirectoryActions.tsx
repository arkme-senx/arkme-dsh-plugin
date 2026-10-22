import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { useEffect, useId, useRef, useState } from 'react'
import type { TeamJotmoIdAvailability } from '../../../team-app-contract.js'
import { ArkmeClientError } from '../../../sdk/index.js'
import type { ArkmeTeam } from '../../../types.js'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import { callArkme } from '../../api.js'
import { useArkmeLocale } from '../../locale.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { openTeamMessages, subscribeTeamMessageChanges } from '../../team-messaging-events.js'
import { ArkmeActionMenu } from '../../ArkmeDshMenu.js'
import { DirectoryActionDialog } from './ContactDirectoryAddDialog.js'
import { teamJoinLabel, teamJoinState, teamMembershipErrorText, teamMessageLinkRef, type TeamJoinState } from './team-membership-feedback.js'
import { retryArkmeRead } from '../../read-retry.js'
import { withArkmeReadDeadline } from '../../read-deadline.js'

/** Team membership lives next to the existing Team directory, independent of messages. */
export function TeamDirectoryActions({ accountKey, onChanged, onSelect }: {
  accountKey: string; onChanged(): void; onSelect(selection: ArkmeDirectorySelection): void
}) {
  useArkmeLocale()
  const [mode, setMode] = useState<'create' | 'join' | 'link'>()
  const [menuOpen, setMenuOpen] = useState(false)
  const choose = (next: 'create' | 'join' | 'link') => { setMenuOpen(false); setMode(next) }
  return <div className="arkme-team-directory-actions">
    <ArkmeActionMenu autoFocus open={menuOpen} label={tr('团队操作')} align="end" onClose={() => { setMenuOpen(false) }}
      anchor={<button type="button" className="arkme-team-directory-add" aria-label={tr('团队操作')}
        aria-haspopup="menu" aria-expanded={menuOpen} title={tr('团队操作')}
        onClick={() => { setMenuOpen(value => !value) }}><Plus size={18} /></button>}
      actions={[
        { id: 'create', label: tr('创建团队'), icon: <Plus size={18} />, onSelect: () => choose('create') },
        { id: 'join', label: tr('加入团队'), icon: <UsersThree size={18} />, onSelect: () => choose('join') },
        { id: 'link', label: tr('通过链接发消息'), icon: <LinkSimple size={18} />, onSelect: () => choose('link') },
      ]} />
    {mode && <TeamMembershipForm key={`${accountKey}:${mode}`} mode={mode} accountKey={accountKey} onClose={() => { setMode(undefined) }} onChanged={onChanged} onSelect={onSelect} />}
  </div>
}
function TeamMembershipForm({ mode, accountKey, onClose, onChanged, onSelect }: {
  mode: 'create' | 'join' | 'link'; accountKey: string; onClose(): void; onChanged(): void; onSelect(selection: ArkmeDirectorySelection): void
}) {
  const formId = useId(), inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(''), [jotmoId, setJotmoId] = useState('')
  const [joinResult, setJoinResult] = useState<{ id: string; state: TeamJoinState }>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [availability, setAvailability] = useState<{ id: string; available: boolean; hint: string; retry?: boolean }>()
  const [checkAttempt, setCheckAttempt] = useState(0)
  const id = jotmoId.trim()
  const formatHint = id && !/^[a-zA-Z0-9_]+$/.test(id) ? tr('仅支持字母、数字和下划线') : id && id.length < 6 ? tr('最少6位') : ''
  const nameTooLong = Array.from(name.trim()).length > 64
  const canCreate = name.trim() && !nameTooLong && !formatHint && availability?.id === id && availability.available
  useEffect(() => {
    if (mode !== 'create' || !id || formatHint) return
    const request = new AbortController()
    const timer = setTimeout(() => {
      void callArkme<TeamJotmoIdAvailability>('team.app.create.check', { jotmoId: id }, request.signal).then(result => {
        if (!request.signal.aborted) setAvailability({ id, available: result.available, hint: result.available ? tr('该即我号可用') : tr(result.reason === 'taken' ? '该即我号已被占用' : result.reason === 'invalid' ? '即我号格式不正确' : '该即我号不可用') })
      }, () => {
        if (!request.signal.aborted) setAvailability({ id, available: false, hint: tr('暂时无法校验即我号，请重试'), retry: true })
      })
    }, 600)
    return () => { clearTimeout(timer); request.abort() }
  }, [mode, id, formatHint, checkAttempt])
  const requestUid = useRef(crypto.randomUUID()), controller = useRef(new AbortController()), idRef = useRef('')
  const statusSequence = useRef(0), submitting = useRef(false), resultRef = useRef(joinResult)
  const attemptedId = useRef(''), statusAgain = useRef(false), statusRequest = useRef<AbortController>()
  idRef.current = jotmoId.trim()
  resultRef.current = joinResult
  const currentState = joinResult?.id === id ? joinResult.state : undefined
  const joinComplete = currentState === 'joined' || currentState === 'pending'
  const cancelStatus = () => {
    ++statusSequence.current; statusAgain.current = false
    statusRequest.current?.abort(); statusRequest.current = undefined
  }
  const check = async () => {
    const id = idRef.current
    if (mode !== 'join' || !id || attemptedId.current !== id || controller.current.signal.aborted) return
    // Follow the Team directory's coalescing recipe: preserve invalidations
    // during writes/reads and reconcile once the active operation settles.
    if (submitting.current || statusRequest.current) { statusAgain.current = true; return }
    statusAgain.current = false
    const request = new AbortController()
    statusRequest.current = request
    const sequence = ++statusSequence.current
    const signal = AbortSignal.any([controller.current.signal, request.signal])
    const isCurrent = () => !signal.aborted && sequence === statusSequence.current && id === idRef.current
    try {
      const value = await withArkmeReadDeadline(readSignal => retryArkmeRead(
        () => callArkme<{ state: string }>('team.app.join.status', { jotmoId: id, expectedAccountKey: accountKey }, readSignal),
        { signal: readSignal, retryDelays: [250, 750] },
      ), signal)
      if (!isCurrent()) return
      const state = teamJoinState(value.state)
      if (state) {
        const previousState = resultRef.current?.state
        resultRef.current = { id, state }; setJoinResult(resultRef.current); setError('')
        // A lost write response can be settled by this read. A later explicit
        // reapplication must not replay that application's rejected receipt.
        if (state !== 'none') requestUid.current = crypto.randomUUID()
        if (previousState !== state && (state === 'joined' || previousState === 'joined')) onChanged()
      } else setError(tr(teamMembershipErrorText(undefined, 'status')))
    } catch (e) { if (isCurrent()) setError(tr(teamMembershipErrorText(e, 'status'))) }
    finally {
      if (statusRequest.current === request) statusRequest.current = undefined
      if (isCurrent() && statusAgain.current) void check()
    }
  }
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    const stop = subscribeTeamMessageChanges((account, receiptOnly) => { if (account === accountKey && mode === 'join' && !receiptOnly) void check() })
    // Match the existing Team readers: events, returning to the page and a
    // visible-page fallback all perform scoped reads, never another join.
    const resume = () => { void check() }
    const timer = mode === 'join' && typeof document !== 'undefined' ? setInterval(() => {
      if (document.visibilityState === 'visible') void check()
    }, 60_000) : undefined
    if (mode === 'join' && typeof window !== 'undefined') {
      window.addEventListener('focus', resume); window.addEventListener('online', resume)
    }
    return () => {
      request.abort(); cancelStatus(); stop(); if (timer !== undefined) clearInterval(timer)
      if (mode === 'join' && typeof window !== 'undefined') {
        window.removeEventListener('focus', resume); window.removeEventListener('online', resume)
      }
    }
  }, [accountKey, mode])
  const submit = async () => {
    if (submitting.current || !id || (mode === 'join' && joinComplete) || (mode === 'create' && !canCreate)) return
    if (mode === 'link') {
      const publicRef = teamMessageLinkRef(id)
      if (!publicRef) { setError(tr('请粘贴完整的团队消息链接')); return }
      openTeamMessages({ kind: 'link', publicRef }); onClose(); return
    }
    const signal = controller.current.signal
    cancelStatus()
    submitting.current = true
    if (mode === 'join') attemptedId.current = id
    inputRef.current?.focus({ preventScroll: true })
    setBusy(true); setError('')
    try {
      if (mode === 'create') {
        const team = await callArkme<ArkmeTeam>('team.app.create', { name: name.trim(), jotmoId: jotmoId.trim(), requestUid: requestUid.current }, signal)
        if (signal.aborted) return
        onChanged(); onSelect({ kind: 'team', teamRef: team.teamRef }); onClose()
      } else {
        const value = await callArkme<{ state: string }>('team.app.join', { jotmoId: id, requestUid: requestUid.current }, signal)
        if (signal.aborted) return
        const state = teamJoinState(value.state)
        if (!state) { setError(tr('暂时无法确认加入结果，请重试')); return }
        resultRef.current = { id, state }; setJoinResult(resultRef.current)
        requestUid.current = crypto.randomUUID(); onChanged()
      }
    } catch (e) {
      if (!signal.aborted) {
        // These guards reject before a membership/application can be accepted.
        // Preserve the actionable prompt; only uncertain writes need recovery.
        if (mode === 'join' && e instanceof ArkmeClientError && ['social-phone-binding-required', 'team-invalid_request', 'arkme-code-1001'].includes(e.body.code)) {
          attemptedId.current = ''; statusAgain.current = false
        }
        setError(tr(teamMembershipErrorText(e, mode)))
        if (mode === 'create') { setAvailability(undefined); setCheckAttempt(v => v + 1) }
      }
    }
    finally {
      submitting.current = false
      if (!signal.aborted) { setBusy(false); if (statusAgain.current) void check() }
    }
  }
  return <DirectoryActionDialog appearance="form" busy={busy} title={tr(mode === 'create' ? '创建团队' : mode === 'link' ? '通过链接发消息' : '加入团队')} closeLabel={tr('关闭')} onClose={onClose}>
    <form onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault() }} onSubmit={e => { e.preventDefault(); void submit() }}>
      <p className="arkme-contact-remark-label">{tr(mode === 'create' ? '创建团队后，可以邀请成员共同使用团队功能。' : mode === 'link' ? '向团队发送消息，无需加入团队。' : '填写团队即我号，申请加入已有团队。')}</p>
      {mode === 'create' && <p><label className="arkme-contact-remark-label" htmlFor={`${formId}-name`}>{tr('团队名称')}</label>
        <input className="arkme-contact-remark-input" id={`${formId}-name`} value={name} readOnly={busy} aria-invalid={nameTooLong || undefined} onChange={e => { setName(e.target.value); setError(''); requestUid.current = crypto.randomUUID() }} /></p>}
      {mode === 'create' && nameTooLong && <p className="arkme-contact-remark-error" role="alert">{tr('团队名称最多64个字')}</p>}
      <p><label className="arkme-contact-remark-label" htmlFor={`${formId}-id`}>{tr(mode === 'link' ? '团队消息链接' : '团队即我号')}</label>
        <input ref={inputRef} className="arkme-contact-remark-input" id={`${formId}-id`} value={jotmoId} readOnly={busy} autoCapitalize="none" spellCheck={false} aria-describedby={error ? `${formId}-error` : mode === 'create' ? `${formId}-hint` : undefined} aria-invalid={(mode === 'link' && Boolean(error)) || (mode === 'create' && Boolean(formatHint || (availability?.id === id && !availability.available))) || undefined} onChange={e => { setJotmoId(e.target.value); requestUid.current = crypto.randomUUID(); cancelStatus(); attemptedId.current = ''; resultRef.current = undefined; setJoinResult(undefined); setError(''); setAvailability(undefined) }} /></p>
      {mode === 'create' && <p className="arkme-contact-remark-label" id={`${formId}-hint`} aria-live="polite">
        {formatHint || (availability?.id === id ? availability.hint : id ? tr('正在校验…') : tr('最少6位，支持字母、数字和下划线'))}
        {availability?.id === id && availability.retry && <button data-arkme-feedback="neutral" className="arkme-contact-remark-cancel" type="button" disabled={busy} onClick={() => { setAvailability(undefined); setCheckAttempt(v => v + 1) }}>{tr('重试')}</button>}
      </p>}
      {error && <p id={`${formId}-error`} role="alert" className="arkme-contact-remark-error">{error}</p>}
      {currentState && <p className="arkme-contact-remark-label" role="status">{tr(teamJoinLabel(currentState))}</p>}
      <footer className="arkme-contact-remark-footer">{mode === 'join' && joinComplete
        ? <button data-arkme-feedback="primary" className="arkme-contact-remark-confirm" type="button" onClick={onClose}>{tr('完成')}</button>
        : <><button data-arkme-feedback="neutral" className="arkme-contact-remark-cancel" type="button" disabled={busy} onClick={onClose}>{tr('取消')}</button>
          <button data-arkme-feedback="primary" className="arkme-contact-remark-confirm" type="submit" disabled={busy || !id || (mode === 'create' && !canCreate)}>{tr(busy ? '处理中…' : mode === 'create' ? '创建团队' : mode === 'link' ? '打开对话' : currentState === 'rejected' || currentState === 'not_member' ? '重新申请' : '申请加入')}</button></>}</footer>
    </form>
  </DirectoryActionDialog>
}
