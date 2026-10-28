import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { ArkmeSourceItem, ArkmeTeam } from '../types.js'
import { canChooseTeamGroupIdentity, TEAM_GROUP_PENDING_TEXT, type TeamGroupContext, type TeamGroupPending, type TeamGroupIdentity } from '../team-group-contract.js'
import { TeamPublicCardDialog } from './TeamPublicCardDialog.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { callArkme } from './api.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeSelfRoleMenu, type SelfRoleMenuAction } from './ArkmeSelfRoleMenu.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

const errorText = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')
type ContextState = { scope: string; value?: TeamGroupContext; error?: string; refreshing?: boolean }

function useTeamGroupContext(accountKey: string, sourceRef: string, active = true) {
  const scope = JSON.stringify([accountKey, sourceRef])
  const [state, setState] = useState<ContextState>({ scope: '' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setState(current => ({ scope, ...(current.scope === scope && current.value ? { value: current.value } : {}), refreshing: true }))
    void callArkme<TeamGroupContext>('team.app.group.context', { expectedAccountKey: accountKey, sourceRef }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        if (!['ready','backend_pending'].includes(value.state) || !Array.isArray(value.teams)) throw new Error(tr('团队状态返回异常，请重试'))
        setState({ scope, value })
      }).catch(error => { if (!controller.signal.aborted) setState({ scope, error: errorText(error) }) })
    return () => controller.abort()
  }, [accountKey, sourceRef, active, revision, scope])
  const retry = useCallback(() => setRevision(value => value + 1), [])
  return { ...(state.scope === scope && active ? state : { scope }), retry }
}

export function TeamGroupPendingNotice({ children }: { children?: React.ReactNode }) {
  return <div role="status" style={styles.notice}><strong>{tr(TEAM_GROUP_PENDING_TEXT)}</strong>
    {children && <p style={{ ...styles.hint, margin: '6px 0 0' }}>{children}</p>}
  </div>
}

/** A separate selection from individual/Bot invitations; it never calls their mutation APIs. */
export function TeamGroupJoinPanel({ accountKey, source }: { accountKey: string; source: ArkmeSourceItem }) {
  useArkmeLocale()
  const context = useTeamGroupContext(accountKey, source.sourceRef)
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(false)
  const inFlight = useRef<AbortController>(), requestUid = useRef('')
  useEffect(() => () => inFlight.current?.abort(), [])
  const teams = context.value?.teams ?? [], team = teams.find(value => value.jotmoId === selected)
  const join = async () => {
    if (!team || inFlight.current || pending) return
    const controller = new AbortController(); inFlight.current = controller
    requestUid.current ||= crypto.randomUUID()
    setBusy(true); setError('')
    try {
      const result = await callArkme<TeamGroupPending>('team.app.group.join', {
        expectedAccountKey: accountKey, sourceRef: source.sourceRef, teamRef: team.teamRef, requestUid: requestUid.current,
      }, controller.signal)
      if (controller.signal.aborted) return
      if (result.state !== 'backend_pending') throw new Error(tr('团队入群状态返回异常，请重试'))
      setPending(true)
    } catch (e) { if (!controller.signal.aborted) setError(errorText(e)) }
    finally { if (inFlight.current === controller) inFlight.current = undefined; if (!controller.signal.aborted) setBusy(false) }
  }
  return <section aria-label={tr('添加团队成员')} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <p style={styles.hint}>{tr('团队作为一个成员加入「{v0}」，获授权的团队成员可从加入时起查看和参与群聊。', { v0: source.displayName })}</p>
      <p style={styles.hint}>{tr('个人历史消息不会自动共享；加入需要群聊与团队双方的权限校验。')}</p>
      {!context.value && !context.error && <p role="status">{tr('正在加载我的团队…')}</p>}
      {context.error && <p role="alert">{context.error} <button style={styles.link} onClick={context.retry}>{tr('重试')}</button></p>}
      {context.value && <>
        <div role="radiogroup" aria-label={tr('选择加入群聊的团队')}>{teams.map(value => <button type="button" role="radio" aria-checked={selected === value.jotmoId}
          key={value.jotmoId} disabled={busy} onClick={() => { setSelected(value.jotmoId); requestUid.current = ''; setError(''); setPending(false) }}
          style={{ ...styles.team, background: selected === value.jotmoId ? arkmeTheme.active : 'transparent' }}>
          <ArkmeTeamAvatar name={value.name} avatar={value.avatar} size={34} />
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}><strong style={styles.name}>{value.name}</strong><small style={styles.hint}>@{value.jotmoId}</small></span>
          <span aria-hidden style={{ color: selected === value.jotmoId ? arkmeTheme.accent : arkmeTheme.secondary }}>{selected === value.jotmoId ? '●' : '○'}</span>
        </button>)}</div>
        {teams.length === 0 && <p>{tr('你尚未加入团队')}</p>}
        <TeamGroupPendingNotice>{pending ? tr('已保留当前选择，尚未将团队加入群聊。') : tr('当前展示我的团队，入群资格将在接口接通后核验。')}</TeamGroupPendingNotice>
      </>}
      {error && <p role="alert" style={{ color: arkmeTheme.danger }}>{error}</p>}
    </div>
    <footer style={styles.footer}><button type="button" disabled={!team || busy || pending} style={{ ...styles.button, opacity: !team || busy || pending ? .5 : 1 }} onClick={() => { void join() }}>
      {tr(busy ? '正在检查…' : '将团队加入群聊')}
    </button></footer>
  </section>
}

/** A real team member may represent that team without adding the team to the group.
 * Writes remain pending until messages carry server-verified team attribution. */
type IdentityPickerProps = {
  accountKey: string; sourceRef: string; selfAvatarRef?: string | undefined; selfName?: string; disabled?: boolean; value?: TeamGroupIdentity | undefined; onSelect?(value:TeamGroupIdentity | undefined):void
}
export function TeamGroupIdentityPicker(props: IdentityPickerProps) {
  return <ScopedIdentityPicker key={JSON.stringify([props.accountKey, props.sourceRef])} {...props} />
}

function ScopedIdentityPicker({ accountKey, sourceRef, selfAvatarRef, selfName = '我', disabled = false, value, onSelect }: IdentityPickerProps) {
  useArkmeLocale()
  const [open,setOpen]=useState(false)
  const context=useTeamGroupContext(accountKey,sourceRef)
  const close=useCallback(()=>setOpen(false),[])
  useEffect(()=>{const refresh=()=>context.retry();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh)},[context.retry])
  useEffect(()=>{if(disabled)close()},[disabled,close])
  if(!value&&!canChooseTeamGroupIdentity(context.value)&&!context.error)return null
  const actions:SelfRoleMenuAction[]=[
    {id:'personal',label:tr('我'),description:tr('个人身份'),icon:<ArkmeUserAvatar avatarRef={selfAvatarRef} size={28} label={tr('我的头像')}/>,onSelect:()=>{onSelect?.(undefined);close()}},
    {type:'separator',id:'separator'},
    ...(context.value?.teams??[]).filter(team=>team.representation!==undefined).map(team=>({
      id:`team:${team.jotmoId}`,label:`${selfName} · ${team.name}`,description:tr('代表团队发言'),disabled:context.refreshing===true,
      icon:<span style={{position:'relative',display:'inline-flex'}}><ArkmeUserAvatar avatarRef={selfAvatarRef} size={28} label={tr('我的头像')}/><span aria-label={`${team.name}团队身份`} style={styles.teamBadge}><Users size={10} weight="fill"/></span></span>,
      onSelect:()=>{if(!context.refreshing&&team.representation){onSelect?.({team,selection:team.representation});close()}},
    })),
    ...(context.error?[{type:'label' as const,id:'error',text:tr('团队身份暂不可用，草稿已保留')}]:[]),
  ]
  return <ArkmeSelfRoleMenu open={open} onClose={close} selectedIds={[value?`team:${value.team.jotmoId}`:'personal']} showSelectionIndicator actions={actions} anchor={
    <button type="button" disabled={disabled} data-arkme-feedback="neutral" aria-label={value?`${selfName} · ${value.team.name}`:tr('群聊发言身份：我')}
      aria-haspopup="dialog" aria-expanded={open} style={styles.trigger} onPointerDown={event=>event.stopPropagation()} onClick={()=>{if(!open)context.retry();setOpen(v=>!v)}}>
      <span style={{position:'relative',display:'inline-flex'}}><ArkmeUserAvatar avatarRef={selfAvatarRef} size={20} label={tr('我的头像')}/>{value&&<span style={styles.teamBadge}><Users size={10} weight="fill"/></span>}</span>
      <span>{value?value.team.name:tr('我')}</span><CaretDown size={10}/>
    </button>
  }/>
}

const styles: Record<string, CSSProperties> = {
  teamBadge: { position: 'absolute', right: -2, bottom: -2, display: 'grid', placeItems: 'center', width: 14, height: 14, borderRadius: '50%', border: `2px solid ${arkmeTheme.base}`, background: arkmeTheme.accentSoft, color: arkmeTheme.accent },
  hint: { fontSize: 12, lineHeight: 1.7, color: arkmeTheme.secondary },
  notice: { borderRadius: 10, padding: 12, marginTop: 12, background: arkmeTheme.subtle, fontSize: 13, lineHeight: 1.7, overflowWrap: 'anywhere' },
  team: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 8px', border: 0, borderRadius: 8, color: arkmeTheme.text, cursor: 'pointer' },
  name: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 },
  link: { border: 0, background: 'transparent', color: arkmeTheme.accent, padding: 6, cursor: 'pointer' },
  footer: { padding: '12px 16px', borderTop: `1px solid ${arkmeTheme.borderSoft}`, display: 'flex', justifyContent: 'flex-end' },
  button: { border: 0, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', font: 'inherit' },
  trigger: { display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', flexShrink: 0, background: 'transparent', border: 0, borderRadius: 8, padding: '5px 6px', color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 12 },
}
