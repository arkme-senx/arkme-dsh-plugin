import { useEffect, useRef, useState } from 'react'
import type { ArkmeTeam } from '../../../types.js'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import { callArkme } from '../../api.js'
import { useArkmeLocale } from '../../locale.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { openTeamMessages, subscribeTeamMessageChanges } from '../../team-messaging-events.js'
import { DirectoryActionDialog } from './ContactDirectoryAddDialog.js'

/** Team membership lives next to the existing Team directory, independent of messages. */
export function TeamDirectoryActions({ accountKey, onChanged, onSelect }: {
  accountKey: string; onChanged(): void; onSelect(selection: ArkmeDirectorySelection): void
}) {
  useArkmeLocale()
  const [mode, setMode] = useState<'create' | 'join' | 'link'>()
  return <div className="arkme-team-directory-actions">
    <button type="button" onClick={() => { setMode('create') }}>{tr('创建团队')}</button>
    <button type="button" onClick={() => { setMode('join') }}>{tr('加入团队')}</button>
    <button type="button" onClick={() => { setMode('link') }}>{tr('通过链接发消息')}</button>
    {mode && <TeamMembershipForm key={`${accountKey}:${mode}`} mode={mode} accountKey={accountKey} onClose={() => { setMode(undefined) }} onChanged={onChanged} onSelect={onSelect} />}
  </div>
}
function TeamMembershipForm({ mode, accountKey, onClose, onChanged, onSelect }: {
  mode: 'create' | 'join' | 'link'; accountKey: string; onClose(): void; onChanged(): void; onSelect(selection: ArkmeDirectorySelection): void
}) {
  const [name, setName] = useState(''), [jotmoId, setJotmoId] = useState(''), [notice, setNotice] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const requestUid = useRef(crypto.randomUUID()), controller = useRef(new AbortController()), idRef = useRef('')
  idRef.current = jotmoId.trim()
  const stateLabel = (state: string) => state === 'pending' ? tr('申请已提交，等待团队所有者审批') : state === 'rejected' ? tr('加入申请未通过，可重新申请') : state === 'not_member' ? tr('当前已不是团队成员，可重新申请') : state === 'none' ? tr('尚未申请加入此团队') : tr('已加入团队')
  const check = async () => {
    const id = idRef.current
    if (!id) return
    try {
      const value = await callArkme<{ state: string }>('team.app.join.status', { jotmoId: id }, controller.current.signal)
      if (!controller.current.signal.aborted && id === idRef.current) setNotice(stateLabel(value.state))
    } catch (e) { if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : tr('操作失败，请重试')) }
  }
  useEffect(() => {
    const stop = subscribeTeamMessageChanges(account => { if (account === accountKey && mode === 'join') void check() })
    return () => { controller.current.abort(); stop() }
  }, [accountKey, mode])
  const submit = async () => {
    if (busy) return
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
    } catch (e) { if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : tr('操作失败，请重试')) }
    finally { if (!controller.current.signal.aborted) setBusy(false) }
  }
  return <DirectoryActionDialog title={tr(mode === 'create' ? '创建团队' : mode === 'link' ? '通过链接发消息' : '加入团队')} closeLabel={tr('关闭')} onClose={onClose}>
    <form className="arkme-team-membership-form" onSubmit={e => { e.preventDefault(); void submit() }}>
      <p>{tr(mode === 'create' ? '创建团队后，可以邀请成员共同使用团队功能。' : mode === 'link' ? '向团队发送消息，无需加入团队。' : '填写团队即我号，申请加入已有团队。')}</p>
      {mode === 'create' && <label>{tr('团队名称')}<input value={name} disabled={busy} onChange={e => { setName(e.target.value); requestUid.current = crypto.randomUUID() }} /></label>}
      <label>{tr(mode === 'link' ? '团队消息链接' : '团队即我号')}<input value={jotmoId} disabled={busy} onChange={e => { setJotmoId(e.target.value); requestUid.current = crypto.randomUUID(); setNotice('') }} /></label>
      {error && <p role="alert" className="team-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <div><button type="submit" disabled={busy || !jotmoId.trim() || (mode === 'create' && !name.trim())}>{tr(busy ? '处理中…' : mode === 'create' ? '创建团队' : mode === 'link' ? '打开对话' : '申请加入')}</button>
        {mode === 'join' && <button type="button" disabled={busy || !jotmoId.trim()} onClick={() => { void check() }}>{tr('查询申请状态')}</button>}</div>
    </form>
  </DirectoryActionDialog>
}
