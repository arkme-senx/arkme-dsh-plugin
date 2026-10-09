import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { useEffect, useRef, useState } from 'react'
import type { TeamJotmoIdAvailability } from '../../../team-app-contract.js'
import type { ArkmeTeam } from '../../../types.js'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import { callArkme } from '../../api.js'
import { useArkmeLocale } from '../../locale.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { openTeamMessages, subscribeTeamMessageChanges } from '../../team-messaging-events.js'
import { ArkmeActionMenu } from '../../ArkmeDshMenu.js'
import { DirectoryActionDialog } from './ContactDirectoryAddDialog.js'

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
  const [name, setName] = useState(''), [jotmoId, setJotmoId] = useState(''), [notice, setNotice] = useState('')
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
  idRef.current = jotmoId.trim()
  const stateLabel = (state: string) => state === 'pending' ? tr('申请已提交，等待团队所有者审批') : state === 'rejected' ? tr('加入申请未通过，可重新申请') : state === 'not_member' ? tr('当前已不是团队成员，可重新申请') : state === 'none' ? tr('尚未申请加入此团队') : tr('已加入团队')
  const check = async () => {
    const id = idRef.current
    if (!id) return
    try {
      const value = await callArkme<{ state: string }>('team.app.join.status', { jotmoId: id }, controller.current.signal)
      if (!controller.current.signal.aborted && id === idRef.current) setNotice(stateLabel(value.state))
    } catch (e) { if (!controller.current.signal.aborted && id === idRef.current) setError(e instanceof Error ? e.message : tr('操作失败，请重试')) }
  }
  useEffect(() => {
    const stop = subscribeTeamMessageChanges(account => { if (account === accountKey && mode === 'join') void check() })
    return () => { controller.current.abort(); stop() }
  }, [accountKey, mode])
  const submit = async () => {
    if (busy || (mode === 'create' && !canCreate)) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'link') {
        const url = new URL(jotmoId.trim())
        const publicRef = url.searchParams.get('channel') ?? ''
        if (url.protocol !== 'https:' || url.pathname !== '/team-message' || url.username || url.password || url.hash || url.searchParams.getAll('channel').length !== 1 || !/^[a-f0-9]{32}$/.test(publicRef)) throw new Error(tr('请粘贴完整的团队消息链接'))
        openTeamMessages({ kind: 'link', publicRef }); onClose(); return
      }
      if (mode === 'create') {
        const team = await callArkme<ArkmeTeam>('team.app.create', { name: name.trim(), jotmoId: jotmoId.trim(), requestUid: requestUid.current }, controller.current.signal)
        if (controller.current.signal.aborted) return
        onChanged(); onSelect({ kind: 'team', teamRef: team.teamRef }); onClose()
      } else {
        const value = await callArkme<{ state: string }>('team.app.join', { jotmoId: jotmoId.trim(), requestUid: requestUid.current }, controller.current.signal)
        if (controller.current.signal.aborted) return
        setNotice(stateLabel(value.state)); requestUid.current = crypto.randomUUID(); onChanged()
      }
    } catch (e) {
      if (!controller.current.signal.aborted) {
        setError(e instanceof Error ? tr(e.message) : tr('操作失败，请重试'))
        if (mode === 'create') { setAvailability(undefined); setCheckAttempt(v => v + 1) }
      }
    }
    finally { if (!controller.current.signal.aborted) setBusy(false) }
  }
  return <DirectoryActionDialog title={tr(mode === 'create' ? '创建团队' : mode === 'link' ? '通过链接发消息' : '加入团队')} closeLabel={tr('关闭')} onClose={onClose}>
    <form className="arkme-team-membership-form" onSubmit={e => { e.preventDefault(); void submit() }}>
      <p>{tr(mode === 'create' ? '创建团队后，可以邀请成员共同使用团队功能。' : mode === 'link' ? '向团队发送消息，无需加入团队。' : '填写团队即我号，申请加入已有团队。')}</p>
      {mode === 'create' && <label>{tr('团队名称')}<input value={name} disabled={busy} aria-invalid={nameTooLong || undefined} onChange={e => { setName(e.target.value); setError(''); requestUid.current = crypto.randomUUID() }} /></label>}
      {mode === 'create' && nameTooLong && <p role="alert">{tr('团队名称最多64个字')}</p>}
      <label>{tr(mode === 'link' ? '团队消息链接' : '团队即我号')}<input value={jotmoId} disabled={busy} autoCapitalize="none" spellCheck={false} aria-describedby={mode === 'create' ? 'team-create-id-hint' : undefined} aria-invalid={mode === 'create' && Boolean(formatHint || (availability?.id === id && !availability.available)) || undefined} onChange={e => { setJotmoId(e.target.value); requestUid.current = crypto.randomUUID(); setNotice(''); setError(''); setAvailability(undefined) }} /></label>
      {mode === 'create' && <p id="team-create-id-hint" aria-live="polite">
        {formatHint || (availability?.id === id ? availability.hint : id ? tr('正在校验…') : tr('最少6位，支持字母、数字和下划线'))}
        {availability?.id === id && availability.retry && <button type="button" disabled={busy} onClick={() => { setAvailability(undefined); setCheckAttempt(v => v + 1) }}>{tr('重试')}</button>}
      </p>}
      {error && <p role="alert" className="team-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <div><button type="submit" disabled={busy || !jotmoId.trim() || (mode === 'create' && !canCreate)}>{tr(busy ? '处理中…' : mode === 'create' ? '创建团队' : mode === 'link' ? '打开对话' : '申请加入')}</button>
        {mode === 'join' && <button type="button" disabled={busy || !jotmoId.trim()} onClick={() => { void check() }}>{tr('查询申请状态')}</button>}</div>
    </form>
  </DirectoryActionDialog>
}
