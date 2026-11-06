import {readTeamGroupJoinAttempts,retainTeamGroupJoinAttempt,teamGroupJoinAttemptKey} from './team-group-join-attempt.js'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { ArkmeSourceItem, ArkmeTeam } from '../types.js'
import { canChooseTeamGroupIdentity, TEAM_GROUP_PENDING_TEXT, type TeamGroupContext, type TeamGroupJoinContext, type TeamGroupCommandResult, type TeamGroupIdentity } from '../team-group-contract.js'
import { callArkme } from './api.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeSelfRoleMenu, type SelfRoleMenuAction } from './ArkmeSelfRoleMenu.js'
import { arkmeTheme } from './arkme-theme.js'
import { teamIdentityBadgeStyle, teamIdentityLinkStyle } from './team-identity-presentation.js'
import { tr, useArkmeLocale } from './locale.js'
import {invalidateTeamWorkspace} from './team-messaging-events.js'

const errorText = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')
type ContextState<T> = { scope: string; value?: T; error?: string; refreshing?: boolean }

function useTeamGroupContext<T extends TeamGroupContext|TeamGroupJoinContext=TeamGroupContext>(accountKey: string, sourceRef: string, active = true, mode:'identity'|'join'='identity') {
  const scope = JSON.stringify([accountKey, sourceRef])
  const [state, setState] = useState<ContextState<T>>({ scope: '' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setState(current => ({ scope, ...(current.scope === scope && current.value ? { value: current.value } : {}), refreshing: true }))
    void callArkme<T>(mode==='join'?'team.app.group.join-context':'team.app.group.context', { expectedAccountKey: accountKey, sourceRef }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        if (!['ready','backend_pending'].includes(value.state) || !Array.isArray(value.teams)||mode==='join'&&value.teams.some(t=>!t.key||!t.teamRef||!t.jotmoId)) throw new Error(tr('团队状态返回异常，请重试'))
        setState({ scope, value })
      }).catch(error => { if (!controller.signal.aborted) setState({ scope, error: errorText(error) }) })
    return () => controller.abort()
  }, [accountKey, sourceRef, active, revision, scope, mode])
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
  return <ScopedTeamGroupJoinPanel key={JSON.stringify([accountKey,source.sourceKey??source.conversationRef??source.sourceRef])} accountKey={accountKey} source={source}/>
}
function ScopedTeamGroupJoinPanel({ accountKey, source }: { accountKey: string; source: ArkmeSourceItem }) {
  useArkmeLocale()
  const context = useTeamGroupContext<TeamGroupJoinContext>(accountKey, source.sourceRef,true,'join')
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<TeamGroupCommandResult>()
  const pending=result?.state==='pending'||result?.state==='joined'&&result.accessStatus==='available'
  const attemptKey=teamGroupJoinAttemptKey(accountKey,source.sourceKey??source.conversationRef??source.sourceRef)
  const [storageError,setStorageError]=useState(false)
  const inFlight = useRef<AbortController>(), requestUid = useRef(''), expectedRevision=useRef<number>()
  useEffect(() => () => inFlight.current?.abort(), [])
  const teams = context.value?.teams ?? [], team = teams.find(value => value.jotmoId === selected)
  useEffect(()=>{
    if(!context.value||selected)return
    try {
      const attempts=readTeamGroupJoinAttempts(localStorage,attemptKey)
      const retained=context.value.teams.find(value=>attempts[value.key])
      if(retained) {
        const attempt=attempts[retained.key]!
        requestUid.current=attempt.requestUid;expectedRevision.current=attempt.expectedRevision;setSelected(retained.jotmoId)
      }
    } catch(e){setStorageError(true);setError(errorText(e))}
  },[context.value,attemptKey,selected])
  const choose=(value:TeamGroupJoinContext['teams'][number])=>{
    try {
      const retained=readTeamGroupJoinAttempts(localStorage,attemptKey)[value.key]
      requestUid.current=retained?.requestUid??'';expectedRevision.current=retained?.expectedRevision
      setSelected(value.jotmoId);setError('');setResult(undefined);setStorageError(false)
    } catch(e){setStorageError(true);setError(errorText(e))}
  }
  const acknowledge=()=>{
    if(team)retainTeamGroupJoinAttempt(localStorage,attemptKey,team.key,undefined)
    requestUid.current='';expectedRevision.current=undefined;context.retry()
    invalidateTeamWorkspace(accountKey,source.canonicalChatSourceKey)
  }
  const join = async () => {
    if (!team || team.joined || inFlight.current || pending || storageError) return
    const controller = new AbortController(); inFlight.current = controller
    setBusy(true); setError('')
    try {
      requestUid.current ||= crypto.randomUUID()
      expectedRevision.current ??= team.revision
      retainTeamGroupJoinAttempt(localStorage,attemptKey,team.key,{requestUid:requestUid.current,expectedRevision:expectedRevision.current})
      const next = await callArkme<TeamGroupCommandResult>('team.app.group.join', {
        expectedAccountKey: accountKey, sourceRef: source.sourceRef, teamRef: team.teamRef, requestUid: requestUid.current,expectedRevision:expectedRevision.current,
      }, controller.signal)
      if (controller.signal.aborted) return
      if (!['joined','pending','rejected','left','removed'].includes(next.state)||!['available','unavailable','unknown'].includes(next.accessStatus)) throw new Error(tr('团队入群状态返回异常，请重试'))
      setResult(next)
      if(next.state!=='pending'&&next.state!=='not_found'&&next.accessStatus!=='unknown')acknowledge()
    } catch (e) { if (!controller.signal.aborted) setError(errorText(e)) }
    finally { if (inFlight.current === controller) inFlight.current = undefined; if (!controller.signal.aborted) setBusy(false) }
  }
  const readStatus=async()=>{
    if(inFlight.current||!requestUid.current)return
    const controller=new AbortController();inFlight.current=controller
    setBusy(true);setError('')
    try {
      const next=await callArkme<TeamGroupCommandResult>('team.app.group.status',{expectedAccountKey:accountKey,requestUid:requestUid.current},controller.signal)
      if(controller.signal.aborted)return
      if(!['joined','pending','rejected','left','removed','not_found'].includes(next.state)||!['available','unavailable','unknown'].includes(next.accessStatus))throw new Error(tr('团队入群状态返回异常，请重试'))
      setResult(next)
      if(next.state!=='pending'&&next.state!=='not_found'&&next.accessStatus!=='unknown')acknowledge()
    } catch(e){if(!controller.signal.aborted)setError(errorText(e))}
    finally{if(inFlight.current===controller)inFlight.current=undefined;if(!controller.signal.aborted)setBusy(false)}
  }
  return <section aria-label={tr('添加团队成员')} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <p style={styles.hint}>{tr('团队作为一个成员加入「{v0}」，获授权的团队成员可从加入时起查看和参与群聊。', { v0: source.displayName })}</p>
      <p style={styles.hint}>{tr('个人历史消息不会自动共享；加入需要群聊与团队双方的权限校验。')}</p>
      {!context.value && !context.error && <p role="status">{tr('正在加载我的团队…')}</p>}
      {context.error && <p role="alert">{context.error} <button style={styles.link} onClick={context.retry}>{tr('重试')}</button></p>}
      {context.value?.state==='backend_pending' && <TeamGroupPendingNotice />}
      {context.value?.state==='ready' && <>
        <div role="radiogroup" aria-label={tr('选择加入群聊的团队')}>{teams.map(value => <button type="button" role="radio" aria-checked={selected === value.jotmoId}
          key={value.jotmoId} disabled={busy} onClick={() => choose(value)}
          style={{ ...styles.team, background: selected === value.jotmoId ? arkmeTheme.active : 'transparent' }}>
          <ArkmeTeamAvatar name={value.name} avatar={value.avatar} size={34} />
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}><strong style={styles.name}>{value.name}</strong><small style={styles.hint}>@{value.jotmoId}{value.joined?` · ${tr('已加入')}`:''}</small></span>
          <span aria-hidden style={{ color: selected === value.jotmoId ? arkmeTheme.accent : arkmeTheme.secondary }}>{selected === value.jotmoId ? '●' : '○'}</span>
        </button>)}</div>
        {teams.length === 0 && <p>{tr('你尚未加入团队')}</p>}
        {!result&&requestUid.current&&<p role="status">{tr('此前的入群申请已保留，可核对结果或重试原申请。')}<button type="button" style={styles.link} disabled={busy} onClick={()=>{void readStatus()}}>{tr('核对此前申请')}</button></p>}
        {result&&<div role="status" style={styles.notice}>{result.state==='not_found'?tr('暂未查到原申请，可重试同一申请。'):result.state==='pending'?tr('已提交入群申请，等待群管理员审批。'):result.accessStatus==='available'?tr('团队已加入群聊，可从团队工作区查看和参与。'):result.accessStatus==='unknown'?tr('申请结果已保存，当前访问资格暂时无法核验，请重试查询。'):tr('本次申请已处理，团队当前未加入群聊。')}
          {(result.state==='pending'||result.accessStatus==='unknown')&&<button type="button" style={styles.link} disabled={busy} onClick={()=>{void readStatus()}}>{tr('刷新结果')}</button>}
        </div>}
      </>}
      {error && <p role="alert" style={{ color: arkmeTheme.danger }}>{error}</p>}
    </div>
    <footer style={styles.footer}><button type="button" disabled={!team || team.joined || busy || pending || storageError} style={{ ...styles.button, opacity: !team || team.joined || busy || pending || storageError ? .5 : 1 }} onClick={() => { void join() }}>
      {tr(busy ? '正在检查…' : '将团队加入群聊')}
    </button></footer>
  </section>
}

/** Selection changes only the next publication. Rechecks never clear its draft. */
type IdentityPickerProps = {
  accountKey: string; sourceRef: string; selfAvatarRef?: string | undefined; disabled?: boolean
  value?: TeamGroupIdentity | undefined; onSelect?(value: TeamGroupIdentity | undefined): void
}
export function TeamGroupIdentityPicker(props: IdentityPickerProps) {
  return <ScopedIdentityPicker key={JSON.stringify([props.accountKey, props.sourceRef])} {...props} />
}

function ScopedIdentityPicker({ accountKey, sourceRef, selfAvatarRef, disabled = false, value, onSelect }: IdentityPickerProps) {
  useArkmeLocale()
  const [open, setOpen] = useState(false)
  const context = useTeamGroupContext(accountKey, sourceRef)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    const refresh = () => context.retry()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [context.retry])
  useEffect(() => { if (disabled) close() }, [disabled, close])
  const fixed=context.value?.fixedIdentity
  const selectRef=useRef(onSelect);selectRef.current=onSelect
  useEffect(()=>{if(fixed)selectRef.current?.(fixed)},[fixed])
  if (!value && !canChooseTeamGroupIdentity(context.value) && !context.error) return null
  const retry = context.error && <span role="status" style={styles.hint}>{tr('团队身份暂不可用')}
    <button type="button" style={styles.link} title={context.error} onClick={context.retry}>{tr('重试')}</button></span>
  if (!value && context.error) return retry
  const displayedIdentity = fixed ?? value
  const selectedLabel = displayedIdentity ? tr('我 · {v0}团队', { v0: displayedIdentity.team.name }) : tr('我')
  const avatar = <span style={{ position: 'relative', display: 'inline-flex' }}><ArkmeUserAvatar avatarRef={selfAvatarRef} size={20} label={tr('我的头像')} />
    {displayedIdentity && <span style={styles.teamBadge}><Users size={10} weight="fill" /></span>}
  </span>
  if(fixed||value?.selection.groupMembershipUid)return <><span aria-label={tr('群聊发言身份：{v0}', { v0: selectedLabel })}
    title={`${selectedLabel} · ${tr('从团队工作区参与群聊，固定代表该团队发言')}`} style={styles.trigger}>{avatar}<span>{tr('我')}</span></span>{retry}</>
  const actions: SelfRoleMenuAction[] = [
    { id: 'personal', label: tr('我'), description: tr('个人身份'), icon: <ArkmeUserAvatar avatarRef={selfAvatarRef} size={28} label={tr('我的头像')} />, onSelect: () => { onSelect?.(undefined); close() } },
    { type: 'separator', id: 'separator' },
    ...[...new Map((context.value?.teams ?? []).filter(team => team.representation !== undefined).map(team => [team.jotmoId, team])).values()].map(team => ({
      id: `team:${team.jotmoId}`, label: tr('我 · {v0}团队', { v0: team.name }), description: tr('代表团队发言'), disabled: context.refreshing === true,
      icon: <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, width: 28, height: 28 }}>
        <ArkmeUserAvatar avatarRef={selfAvatarRef} size={28} label={tr('我的头像')} />
        <span aria-label={tr('{v0}团队身份', { v0: team.name })} style={styles.teamBadge}><Users size={10} weight="fill" /></span>
      </span>,
      onSelect: () => { if (!context.refreshing && team.representation) { onSelect?.({ team, selection: team.representation }); close() } },
    })),
    ...(context.refreshing ? [{ type: 'label' as const, id: 'refreshing', text: tr('正在核验团队身份…') }] : []),
  ]
  return <>
    <ArkmeSelfRoleMenu open={open} onClose={close} selectedIds={[value ? `team:${value.team.jotmoId}` : 'personal']} showSelectionIndicator actions={actions} anchor={
      <button type="button" disabled={disabled} data-arkme-feedback="neutral" aria-label={tr('群聊发言身份：{v0}', { v0: selectedLabel })}
        title={value ? `${selectedLabel} · ${tr('代表团队发言')}` : tr('个人身份')} aria-haspopup="dialog" aria-expanded={open}
        style={styles.trigger} onPointerDown={event => event.stopPropagation()} onClick={() => { if (!open) context.retry(); setOpen(current => !current) }}>
        {avatar}<span>{tr('我')}</span><CaretDown size={10} />
      </button>
    } />
    {retry}
  </>
}

const styles: Record<string, CSSProperties> = {
  teamBadge: teamIdentityBadgeStyle,
  hint: { fontSize: 12, lineHeight: 1.7, color: arkmeTheme.secondary },
  notice: { borderRadius: 10, padding: 12, marginTop: 12, background: arkmeTheme.subtle, fontSize: 13, lineHeight: 1.7, overflowWrap: 'anywhere' },
  team: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 8px', border: 0, borderRadius: 8, color: arkmeTheme.text, cursor: 'pointer' },
  name: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 },
  link: teamIdentityLinkStyle,
  footer: { padding: '12px 16px', borderTop: `1px solid ${arkmeTheme.borderSoft}`, display: 'flex', justifyContent: 'flex-end' },
  button: { border: 0, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', font: 'inherit' },
  trigger: { display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', flexShrink: 0, background: 'transparent', border: 0, borderRadius: 8, padding: '5px 6px', color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 12 },
}
