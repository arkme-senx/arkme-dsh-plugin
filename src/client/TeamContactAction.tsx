import { useEffect, useRef, useState } from 'react'
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { useResource } from './use-resource.js'
import { chooseContactTeam, contactTeamError, openTeamContact, rememberContactTeam, teamContactTeams, type TeamContactContext } from './team-contact.js'
import { openConfirmedTeamContact } from './team-entry-navigation.js'
import { tr } from './locale.js'

/** Contact and switch identity in the existing card, without opening another dialog. */
export function TeamContactAction({ context, disabled = false, onOpened, onBusyChange }: {
  context: TeamContactContext; disabled?: boolean; onOpened?(): void; onBusyChange?(busy: boolean): void;
}) {
  const { snapshot, refresh } = useResource(teamContactTeams, context.accountKey || undefined, context.accountKey)
  const [chosen, setChosen] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<AbortController>(), request = useRef<{ key: string; uid: string }>()
  const key = JSON.stringify([context.accountKey, context.person.recipient])
  const currentKey = useRef(key); currentKey.current = key
  const team = chooseContactTeam(snapshot.value ?? [], context.accountKey, chosen)
  useEffect(() => {
    setChosen(''); setError(''); setBusy(false); request.current = undefined
    return () => { pending.current?.abort(); pending.current = undefined }
  }, [key])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  const open = async () => {
    if (!team || disabled || pending.current || snapshot.error) return
    const controller = new AbortController(); pending.current = controller
    const selection = JSON.stringify([key, team.jotmoId])
    if (request.current?.key !== selection) request.current = { key: selection, uid: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      const conversation = await openTeamContact(context, team, request.current.uid, controller.signal)
      if (controller.signal.aborted || currentKey.current !== key) return
      if (!openConfirmedTeamContact(context.accountKey, conversation)) throw new Error(tr('登录账号已变化，请重新打开此窗口'))
      rememberContactTeam(context.accountKey, team)
      onOpened?.()
    } catch (reason) { if (!controller.signal.aborted && currentKey.current === key) setError(contactTeamError(reason, team)) }
    finally { if (pending.current === controller) { pending.current = undefined; if (!controller.signal.aborted) setBusy(false) } }
  }
  if (snapshot.error) return <div className="arkme-team-contact-action"><button type="button" className="arkme-person-button" disabled={disabled || snapshot.refreshing} onClick={refresh}>{tr('重试读取团队')}</button><small role="alert">{tr('暂时无法读取团队')}</small></div>
  if (!snapshot.value) return <span role="status" className="arkme-team-contact-loading">{tr('正在加载团队…')}</span>
  if (!team) return null
  return <div className="arkme-team-contact-action" data-team-contact-selected={team.jotmoId}>
    <div className="arkme-team-contact-row">
      <button type="button" className="arkme-person-button" data-arkme-feedback="neutral" disabled={disabled || busy}
        aria-label={tr('以 {team} 联系', { team: team.name })} title={tr('以 {team} 联系', { team: team.name })} aria-busy={busy || undefined} onClick={() => { void open() }}><UsersIcon size={18} aria-hidden/><span>{busy ? tr('正在打开…') : tr('以 {team} 联系', { team: team.name })}</span></button>
      {snapshot.value.length > 1 && <span className="arkme-team-contact-switch"><CaretDownIcon size={16} aria-hidden/>
        <select aria-label={tr('切换联系团队')} value={team.jotmoId} disabled={disabled || busy} onChange={event => { setChosen(event.currentTarget.value); setError('') }}>
          {snapshot.value.map(value => <option key={value.jotmoId} value={value.jotmoId}>{value.name}</option>)}
        </select></span>}
    </div>
    {error && <small role="alert">{error}</small>}
  </div>
}
