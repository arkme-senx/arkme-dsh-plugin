import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeTeam, ArkmeTeamPage } from '../../../types.js'
import { callArkme } from '../../api.js'
import { tr, useArkmeLocale } from '../../locale.js'
import { arkmeUi } from '../../ui-controller.js'
import { arkmeContactsTab } from './contacts-tab-store.js'
import { codexTargetScopeKey, type CodexConversationTarget } from './codex-conversation-target.js'
import { TeamCodexActivity } from './TeamCodexActivity.js'

/** Personal reading and team inspection have separate, account-scoped memories. */
export function CodexConversationSurface({ accountKey, userId, active }: { accountKey:string; userId:number; active:boolean }) {
  useArkmeLocale()
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const target = ui.codexTarget?.accountKey === accountKey ? ui.codexTarget : undefined
  const [teams,setTeams] = useState<ArkmeTeam[]>([])
  const [loaded,setLoaded] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [panels,setPanels] = useState<CodexConversationTarget[]>([])
  const [workspaceOpen,setWorkspaceOpen] = useState(false)
  const workspace = useRef<HTMLDivElement>(null)
  const workspaceTrigger = useRef<HTMLButtonElement>(null)
  const controller = useRef<AbortController>()
  const generation = useRef(0)
  const load = useCallback(async () => {
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    const version = ++generation.current
    setBusy(true)
    try {
      const items = new Map<string,ArkmeTeam>(); const cursors = new Set<string>()
      let cursor:string|undefined
      do {
        const page = await callArkme<ArkmeTeamPage>('team.list',{limit:50,...(cursor?{pageCursor:cursor}:{})},request.signal)
        if (request.signal.aborted || version !== generation.current) return
        for (const team of page.items) items.set(team.teamRef,team)
        if (page.hasMore && (!page.nextPageCursor || cursors.has(page.nextPageCursor))) throw new Error(tr('团队列表未完整加载，请重试'))
        cursor = page.hasMore ? page.nextPageCursor : undefined
        if (cursor) cursors.add(cursor)
      } while (cursor)
      const next = [...items.values()]
      setTeams(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
      setLoaded(true); setError('')
      setPanels(current => current.filter(panel => items.has(panel.team.teamRef)))
      const currentTarget = arkmeUi.getSnapshot().codexTarget
      if (currentTarget?.accountKey === accountKey && !items.has(currentTarget.team.teamRef)) arkmeUi.showCodex(null)
    } catch (failure) {
      if (!request.signal.aborted && version === generation.current) {
        setError(failure instanceof Error ? failure.message : tr('团队加载失败'))
        setTeams([]); setPanels([]); setLoaded(false)
      }
    } finally { if (!request.signal.aborted && version === generation.current) setBusy(false) }
  }, [accountKey])
  useEffect(() => {
    if (active) void load()
    return () => { generation.current++; controller.current?.abort() }
  }, [active,load])
  useEffect(() => {
    if (!active || !target || (loaded && !teams.some(team => team.teamRef === target.team.teamRef))) return
    setPanels(current => [...current.filter(panel=>codexTargetScopeKey(panel)!==codexTargetScopeKey(target)),target].slice(-6))
  }, [active,target,loaded,teams])
  useEffect(() => { if (!active) setWorkspaceOpen(false) },[active])
  useEffect(() => {
    if (!workspaceOpen || typeof document === 'undefined') return
    const outside = (event:PointerEvent) => { if (event.target instanceof Node && !workspace.current?.contains(event.target) && !workspaceTrigger.current?.contains(event.target)) setWorkspaceOpen(false) }
    const escape = (event:KeyboardEvent) => { if (event.key === 'Escape') { setWorkspaceOpen(false); workspaceTrigger.current?.focus() } }
    document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape)
    workspace.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape) }
  },[workspaceOpen])
  const manageTeam = (teamRef:string, view:'members'|'activity' = 'activity') => {
    setWorkspaceOpen(false)
    arkmeContactsTab.activateAccount(accountKey)
    arkmeUi.showContacts()
    arkmeContactsTab.select({kind:'team',teamRef,view})
  }
  const personal = () => arkmeUi.showCodex(null)
  const workspaceButton = <button type="button" ref={workspaceTrigger} className="arkme-codex-workspace-trigger" aria-haspopup="dialog" aria-expanded={workspaceOpen} onClick={()=>setWorkspaceOpen(!workspaceOpen)}>{tr('团队工作台')} <span aria-hidden>↗</span></button>
  return <section className="arkme-codex-surface" aria-label={tr('Codex 对话')}>
    {error && <p className="arkme-codex-scope-error" role="alert">{error} <button type="button" disabled={busy} onClick={()=>{void load()}}>{tr('重试')}</button></p>}
    <div className="arkme-codex-team-panel" hidden={!active || !!target}>
      <TeamCodexActivity conversation active={active && !target && loaded} teamRef="" personalTeams={teams} selfMember={String(userId)}
        headerActions={workspaceButton} onManage={()=>setWorkspaceOpen(true)}/>
    </div>
    {panels.map(panel => <div key={codexTargetScopeKey(panel)} className="arkme-codex-team-panel" hidden={!active || !target || codexTargetScopeKey(panel)!==codexTargetScopeKey(target) || !!error}>
      <TeamCodexActivity conversation active={active && !!target && codexTargetScopeKey(panel)===codexTargetScopeKey(target) && !error} teamRef={panel.team.teamRef} team={panel.team}
        target={panel} selfMember={String(userId)} scopeControl={<span>{panel.team.name}</span>} onManage={()=>manageTeam(panel.team.teamRef,panel.returnView ?? 'members')}
        headerActions={<><button type="button" onClick={personal}>{tr('回到我的任务')}</button><button type="button" onClick={()=>manageTeam(panel.team.teamRef,panel.returnView ?? 'members')}>{tr('返回团队')}</button></>}/>
    </div>)}
    {workspaceOpen && <div className="arkme-codex-team-workspace" ref={workspace} role="dialog" aria-label={tr('团队工作台')}>
      <header><strong>{tr('团队工作台')}</strong><button type="button" aria-label={tr('关闭')} onClick={()=>setWorkspaceOpen(false)}>×</button></header>
      <p>{tr('在团队中选择成员或管理同步，对话统一在这里查看。')}</p>
      {busy && <p role="status">{tr('加载中…')}</p>}
      {teams.map(team=><button className="arkme-codex-team-choice" type="button" key={team.teamRef} onClick={()=>manageTeam(team.teamRef,'members')}><strong>{team.name}</strong><small>@{team.jotmoId}</small><span aria-hidden>›</span></button>)}
      {loaded && !teams.length && <p>{tr('暂无可查看的团队，请先在联系人中创建或加入团队。')}</p>}
    </div>}
  </section>
}
