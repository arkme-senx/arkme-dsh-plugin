import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { callArkme } from '../../api.js'
import { ArkmeUserAvatar } from '../../ArkmeAvatar.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../../locale.js'
import type { TeamCodexInvitation, TeamCodexState, TeamCodexTask } from '../../../team-codex-contract.js'
import type { ArkmeTeam } from '../../../types.js'
import { TeamCodexConversation, codexReadingKey, newCodexReadingState, type CodexReadingState } from './TeamCodexConversation.js'
import type { CodexConversationTarget } from './codex-conversation-target.js'
import { codexTaskViewKey, readPersonalCodexState, type CodexTeamScope, type CodexViewState, type CodexViewTask } from './personal-codex-state.js'
import { CodexDispatchEntry } from './CodexDispatchEntry.js'
import { CodexQueueDock, codexQueueAvailability as queueAvailability, codexQueueLabel as queueLabel, isCodexTaskLive as liveTask } from './CodexQueueDock.js'

const taskGroupKey = (task: CodexViewTask): string => {
  const key = task.cloud ? `${task.cloud.sourceId}:${task.projectKey}` : task.installationId ? `${task.installationId}:${task.projectKey}` : 'legacy'
  return task.viewTeam ? JSON.stringify([task.viewTeam.teamRef,key]) : key
}

const errorText = (error: unknown): string => error instanceof Error ? tr(error.message) : tr('工作动态加载失败，请重试')
const time = (at: number): string => new Date(at).toLocaleString(arkmeIntlLocale(), { month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit' })
function status(task: TeamCodexTask): string {
  if (task.excluded || task.projectExcluded) return tr('已排除')
  if (task.status === 'pending') return tr('等待接入确认')
  if (task.status === 'expired') return tr('接入指令已过期')
  if (task.status === 'paused') return tr('已暂停')
  if (task.status === 'disconnected') return tr('已断开')
  return tr(task.state === 'working' ? '处理中' : task.state === 'interrupted' ? '已中断' : task.state === 'finished' ? '本轮结束' : '已连接')
}

const taskPriority = (task: TeamCodexTask): number => !liveTask(task) ? 0 : task.state==='working' ? 2 : queueAvailability(task)==='ready' && !!task.queue?.items.length ? 1 : 0

export function TeamCodexActivity({ teamRef, team, active = true, conversation = false, managementOnly = false, target, selfMember = '', scopeControl, headerActions, personalTeams, onManage, onOpenTask }: {
  teamRef: string; team?: Pick<ArkmeTeam, 'name' | 'jotmoId'>; active?: boolean; conversation?: boolean
  managementOnly?: boolean
  target?: CodexConversationTarget; selfMember?: string; scopeControl?: ReactNode; onManage?(): void
  headerActions?: ReactNode; personalTeams?: readonly CodexTeamScope[]
  onOpenTask?(task: TeamCodexTask, filters: {page:number;member:string;project:string}): void
}) {
  useArkmeLocale()
  const isPersonal = personalTeams !== undefined
  const [state, setState] = useState<CodexViewState>()
  const [unavailable,setUnavailable] = useState<string[]>([])
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [invitation, setInvitation] = useState<TeamCodexInvitation>()
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | undefined>(target?.task?.id)
  const [pickerOpen, setPickerOpen] = useState(false)
  const picker = useRef<HTMLDivElement>(null)
  const pickerTrigger = useRef<HTMLButtonElement>(null)
  const readings = useRef(new Map<string,CodexReadingState>())
  const [taskMenu,setTaskMenu] = useState(false)
  const [confirm, setConfirm] = useState<{ id:string; action:'disconnect'|'delete'; teamRef?:string }>()
  const [manage, setManage] = useState(false)
  const [cloudConfirm,setCloudConfirm]=useState(false)
  const [sourceName,setSourceName]=useState('本机 Codex')
  const validSourceName = sourceName.trim().length > 0 && new TextEncoder().encode(sourceName).length <= 128
    && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(sourceName)
  const [project, setProject] = useState(target?.project ?? '')
  const [member, setMember] = useState(target?.member ?? (conversation ? selfMember : ''))
  const [page, setPage] = useState(target?.page ?? 1)
  const [knownMembers, setKnownMembers] = useState<Record<string,string>>({...(selfMember ? {[selfMember]:tr('我')} : {}),...(target?.member && target.memberName ? {[target.member]:target.memberName} : {})})
  const [knownProjects, setKnownProjects] = useState<Record<string,{name:string;sourceId?:string;projectKey?:string}>>(() =>
    target?.project && target.task?.cloud ? {[target.project]:{name:target.task.projectName ?? '',sourceId:target.task.cloud.sourceId,projectKey:target.task.projectKey ?? 'unknown'}} : {})
  const selectedSource = knownProjects[project]?.sourceId ?? ''
  const selectedProject = selectedSource ? knownProjects[project]?.projectKey ?? '' : ''
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [limits, setLimits] = useState<Record<string,number>>({})
  const alive = useRef(true)
  const readEpoch = useRef(0)
  const reading = useRef(false)
  const retryAfter = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  useEffect(() => {
    if (!personalTeams) return
    const allowed = new Set(personalTeams.map(team=>team.teamRef))
    setState(current => current && ({...current,tasks:current.tasks.filter(task=>task.viewTeam && allowed.has(task.viewTeam.teamRef))}))
    for (const key of readings.current.keys()) {
      const [ref] = JSON.parse(key) as string[]
      if (!allowed.has(ref!)) readings.current.delete(key)
    }
  },[personalTeams])
  useEffect(() => {
    if (!target?.task) {
      if (target && member !== (target.member ?? '')) {
        setMember(target.member ?? ''); setPage(1); setProject(''); setExpanded(undefined); setState(undefined)
        setSearch(''); setPickerOpen(false); setTaskMenu(false)
      }
      return
    }
    setExpanded(target.task.id); setMember(target.member ?? ''); setPage(target.page ?? 1); setProject(target.project ?? '')
    setSearch(''); setPickerOpen(false); setTaskMenu(false)
    if (target.project && target.task.cloud) setKnownProjects(current => ({...current,[target.project!]:{name:target.task!.projectName ?? '',sourceId:target.task!.cloud!.sourceId,projectKey:target.task!.projectKey ?? 'unknown'}}))
  }, [target])
  useEffect(() => {
    if (!active) setPickerOpen(false)
  }, [active])
  useEffect(() => { setConfirm(undefined) }, [expanded,active])
  useEffect(() => {
    if (!pickerOpen || typeof document === 'undefined') return
    picker.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !picker.current?.contains(event.target)) setPickerOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPickerOpen(false); pickerTrigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [pickerOpen])
  const request = useCallback(async <T,>(operation: 'team.codex.state'|'team.codex.invite'|'team.codex.change', params: Record<string,unknown> = {}) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    try { return await callArkme<T>(operation,{ teamRef,...params },controller.signal) }
    finally { controllers.current.delete(controller) }
  }, [teamRef])
  const refresh = useCallback(async () => {
    if (reading.current) return
    const epoch = readEpoch.current
    reading.current = true
    const batch = new AbortController()
    controllers.current.add(batch)
    try {
      const personalResult = personalTeams ? await readPersonalCodexState(personalTeams,selfMember,page,
        ref=>request<TeamCodexState>('team.codex.state',{teamRef:ref,page,memberRef:selfMember}),batch.signal) : undefined
      const result = personalResult?.state ?? await request<TeamCodexState>('team.codex.state',{page,memberRef:member,sourceId:selectedSource,projectKey:selectedProject})
      if (alive.current && epoch === readEpoch.current) {
        setUnavailable(personalResult?.unavailable ?? [])
        setState(result); setReadError(''); retryAfter.current = result.cloud?.status==='offline'||result.cloud?.status==='blocked'?Date.now()+30_000:0
        if(result.cloud?.status==='blocked') {readings.current.clear();setExpanded(undefined)}
        if (!member.startsWith('usr_v1_')) setKnownMembers(current=>({...current,...Object.fromEntries(result.tasks.filter(t=>t.cloud).map(t=>[t.cloud!.ownerRef,t.member.displayName]))}))
        setKnownProjects(current=>({...current,...Object.fromEntries(result.tasks.filter(t=>t.cloud).map(t=>[`${t.cloud!.sourceId}:${t.projectKey}`,{
          name:`${t.member.displayName} · ${t.cloud!.sourceName} · ${t.projectName||tr('未归属项目')}`,sourceId:t.cloud!.sourceId,projectKey:t.projectKey??'unknown',
        }]))}))
        if(result.localOnly && result.cloud?.status==='blocked') {setKnownMembers({});setKnownProjects({})}
      }
    } catch (error) { if (alive.current && epoch === readEpoch.current) { setReadError(errorText(error)); retryAfter.current = Date.now()+30_000; readings.current.clear();setState(undefined);setExpanded(undefined) } }
    finally { controllers.current.delete(batch); reading.current = false }
  }, [request,page,member,selectedSource,selectedProject,personalTeams,selfMember])
  useEffect(() => {
    readEpoch.current++
    alive.current = true
    if (!active) return
    void refresh()
    const timer = setInterval(() => { if (Date.now() >= retryAfter.current && (typeof document === 'undefined' || !document.hidden)) void refresh() },isPersonal ? 5000 : 3000)
    return () => { alive.current=false; readEpoch.current++; clearInterval(timer); for (const c of controllers.current) c.abort() }
  }, [refresh, active,isPersonal])
  useEffect(() => {
    if (!(isPersonal || conversation && target && !target.task) || !active || !state || expanded && state.tasks.some(task=>codexTaskViewKey(task)===expanded)) return
    const recent = state.tasks.filter(task=>!project || taskGroupKey(task)===project).sort((a,b)=>taskPriority(b)-taskPriority(a)||b.updatedAt-a.updatedAt)[0]
    setExpanded(recent ? codexTaskViewKey(recent) : undefined)
  },[isPersonal,conversation,target,active,state,expanded,project])
  const invite = async () => {
    setBusy(true); setCopied(false)
    try {
      const result = await request<TeamCodexInvitation>('team.codex.invite')
      if (alive.current) { setInvitation(result); setError(''); await refresh() }
    } catch (error) { if (alive.current) setError(errorText(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  const change = async (id: string, action: string, projectKey?:string, mutationTeamRef = teamRef) => {
    setBusy(true)
    try {
      await request('team.codex.change',{ teamRef:mutationTeamRef,id,action,...(projectKey ? {projectKey} : {}),...(action==='enable-cloud'?{sourceName}: {}) })
      if (alive.current) { setError(''); setConfirm(undefined); if(action==='enable-cloud') setCloudConfirm(false); setInvitation(undefined); setCopied(false); await refresh() }
    } catch (error) { if (alive.current) setError(errorText(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  const copy = async () => {
    if (!invitation) return
    setBusy(true); setCopied(false)
    try {
      // Recheck identity/consent and renew expired invitations instead of copying a stale snapshot.
      const latest = await request<TeamCodexInvitation>('team.codex.invite')
      if (!alive.current) return
      setInvitation(latest); setError('')
      try { await navigator.clipboard.writeText(latest.instructions); if (alive.current) setCopied(true) }
      catch { if (alive.current) setError(tr('无法自动复制，请选中下方接入指令手动复制。')) }
    } catch (error) { if (alive.current) { setInvitation(undefined); setError(errorText(error)) } }
    finally { if (alive.current) setBusy(false) }
  }
  const installations=state?.installations ?? []
  const selected=state?.tasks.find(task=>codexTaskViewKey(task)===expanded)
  const selectedTeamRef=selected?.viewTeam?.teamRef ?? teamRef
  const ownSelected = !!selected && (selected.cloud ? !!selfMember && selected.cloud.ownerRef === selfMember
    : !!state?.self && selected.member.userRef === state.self.userRef)
  const readingKey=selected?codexReadingKey(selectedTeamRef,selected):''
  if (selected && !readings.current.has(readingKey)) {
    // Ephemeral account/team-scoped reading cache; never persisted in browser storage.
    if(readings.current.size>=20) readings.current.delete(readings.current.keys().next().value!)
    readings.current.set(readingKey,newCodexReadingState())
  }
  const connection=installations.find(item=>['pending','active','paused'].includes(item.status))
  const localStatus = !state ? tr('正在确认…') : connection?.status==='active' ? tr('已连接') : connection?.status==='paused' ? tr('已暂停') : connection?.configured ? tr('已配置，等待 Codex 真实事件') : tr('等待接入')
  const cloudStatus = !state ? tr('正在确认…') : !state.cloud || state.cloud.status==='unsupported' ? tr('仅本机采集')
    : state.cloud.status!=='ready' ? tr(state.cloud.message ?? '暂无法核验云端状态')
    : !state.cloud.uploadEnabled ? tr('未开启 · 仅查看云端记录')
    : state.cloud.blocked>0 ? tr('已开启 · 需处理 {count} 条',{count:state.cloud.blocked})
    : tr('已开启 · 待上传 {count} 条',{count:state.cloud.pending})
  const groups=new Map<string,{key:string;name:string;installationId?:string;projectKey?:string;excluded:boolean;tasks:CodexViewTask[]}>()
  for(const task of state?.tasks ?? []) {
    const key=taskGroupKey(task)
    let group=groups.get(key)
    if(!group) {
      group={key,name:isPersonal ? `${task.projectName||tr('未归属项目')} · ${task.cloud?.sourceName||tr('本机 Codex')} · ${task.viewTeam?.name??''}` : task.cloud?`${task.member.displayName} · ${task.cloud.sourceName} · ${task.projectName||tr('未归属项目')}`:task.installationId?(task.projectName||tr('未归属项目')):tr('旧版单任务记录'),
        ...(task.installationId?{installationId:task.installationId}:{}),...(task.projectKey?{projectKey:task.projectKey}:{}),
        excluded:task.projectExcluded===true,tasks:[]}
      groups.set(key,group)
    }
    group.tasks.push(task)
  }
  const visibleGroups=[...groups.values()].map(group=>({...group,tasks:group.tasks.filter(task=>
    (!project||group.key===project) && (!search.trim()||[task.title,task.projectName,task.branch,task.cwd].some(value=>value?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))))
    .sort((a,b)=>taskPriority(b)-taskPriority(a)||b.updatedAt-a.updatedAt)})).filter(group=>group.tasks.length)
  const confirmation=<>{confirm && <div className="arkme-team-codex-confirm" role="alert">
    <p>{tr(confirm.action==='delete' ? '停止同步并删除这项任务的本地记录？无法撤销，不会删除 Codex 原任务或已上传的云端记录。' : '断开后保留已有记录，后续需重新接入。确定断开？')}</p>
    <button type="button" disabled={busy} onClick={() => { void change(confirm.id,confirm.action,undefined,confirm.teamRef ?? teamRef) }}>{tr('确认')}</button><button type="button" onClick={() => setConfirm(undefined)}>{tr('取消')}</button>
  </div>}</>
  const taskInfo = selected && <div className="arkme-codex-task-info">
          {selected.branch && <p>{selected.branch}</p>}{selected.cwd && <p className="arkme-team-codex-path">{selected.cwd}</p>}
          {selected.cloud && <p>{selected.cloud.sourceName}</p>}
          {selected.viewTeam && <p>{selected.viewTeam.name} · @{selected.viewTeam.jotmoId}</p>}
          {ownSelected && !selected.cloud?.remote && <div className="arkme-team-codex-task-actions">
            {selected.installationId ? <>
              <button type="button" disabled={busy} onClick={()=>{void change(selected.id,selected.excluded?'include':'exclude',undefined,selectedTeamRef)}}>{tr(selected.excluded?'恢复此任务':'排除此任务')}</button>
              <button type="button" disabled={busy} onClick={()=>{void change(selected.installationId!,selected.projectExcluded?'include':'exclude',selected.projectKey,selectedTeamRef)}}>{tr(selected.projectExcluded?'恢复此项目':'排除此项目')}</button>
            </> : <>
              {selected.status==='active' && <button type="button" disabled={busy} onClick={()=>{void change(selected.id,'pause',undefined,selectedTeamRef)}}>{tr('暂停同步')}</button>}
              {selected.status==='paused' && <button type="button" disabled={busy} onClick={()=>{void change(selected.id,'resume',undefined,selectedTeamRef)}}>{tr('恢复同步')}</button>}
              {['active','paused','pending'].includes(selected.status) && <button type="button" disabled={busy} onClick={()=>setConfirm({id:selected.id,action:'disconnect',teamRef:selectedTeamRef})}>{tr('断开连接')}</button>}
            </>}
            <button type="button" disabled={busy} onClick={()=>setConfirm({id:selected.id,action:'delete',teamRef:selectedTeamRef})}>{tr('删除本地记录')}</button>
          </div>}
          <small>{tr('仅显示已同步的输入与回答，不包含工具过程。')}</small>
        </div>
  const taskList = <aside className="arkme-codex-task-sidebar" aria-label={tr('Codex 任务列表')}>
    {state && <div className="arkme-team-codex-filters">
      {!isPersonal && state.cloud && state.cloud.status!=='unsupported' && <select aria-label={tr('筛选成员')} value={member} onChange={event=>{setMember(event.target.value);setPage(1);setProject('');setExpanded(undefined);setState(undefined)}}>
        <option value="">{tr('全部成员')}</option>{Object.entries(knownMembers).map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select>}
      <select aria-label={tr('筛选项目')} value={project} onChange={event=>{setProject(event.target.value);if(!isPersonal)setPage(1);setExpanded(undefined)}}><option value="">{tr('全部项目')}</option>{Object.entries({...Object.fromEntries([...groups.values()].map(g=>[g.key,{name:g.name}])),...(!isPersonal?knownProjects:{})}).map(([key,value])=><option key={key} value={key}>{value.name}</option>)}</select>
      <input type="search" aria-label={tr('搜索任务或项目')} placeholder={tr('搜索任务或项目')} value={search} onChange={event=>setSearch(event.target.value)}/>
      {!state.localOnly && <small>{tr('搜索仅筛选当前页已加载的任务')}</small>}
    </div>}
    {!!state?.tasks.length && visibleGroups.length===0 && <p>{tr('没有匹配的任务')}</p>}
    {state?.tasks.length===0 && <p>{tr('没有匹配的任务')}</p>}
    {!state && <p role="status">{tr('正在加载工作动态…')}</p>}
    {visibleGroups.map(group=><section className="arkme-team-codex-project" key={group.key} aria-label={group.name}>
      <header className="arkme-team-codex-project-header">
        {!isPersonal && group.tasks[0]?.cloud && <ArkmeUserAvatar {...(group.tasks[0].member.avatarRef?{avatarRef:group.tasks[0].member.avatarRef}:{})} size={24} label={group.tasks[0].member.displayName}/>}
        <button type="button" className="arkme-team-codex-project-toggle" aria-expanded={!collapsed.has(group.key)} onClick={()=>setCollapsed(current=>{const next=new Set(current);next.has(group.key)?next.delete(group.key):next.add(group.key);return next})}>
          <span aria-hidden>{collapsed.has(group.key)?'▸':'▾'}</span><span className="arkme-codex-project-label"><strong>{group.tasks[0]?.projectName || tr('未归属项目')}</strong><small title={group.name}>{isPersonal ? `${group.tasks[0]?.cloud?.sourceName || tr('本机 Codex')} · ${group.tasks[0]?.viewTeam?.name ?? ''}` : group.tasks[0]?.member.displayName}{!isPersonal && group.tasks[0]?.cloud && ` · ${group.tasks[0].cloud.sourceName}`}</small></span><small>{group.tasks.length}</small>{group.excluded && <small>{tr('已排除')}</small>}
        </button>
      </header>
      {!collapsed.has(group.key) && group.tasks.slice(0,limits[group.key]??20).map(task => <article className="arkme-team-codex-task" key={codexTaskViewKey(task)}>
        <button type="button" className="arkme-team-codex-task-toggle" aria-pressed={expanded===codexTaskViewKey(task)} onClick={() => {
          if (onOpenTask) onOpenTask(task,{page,member,project})
          else { setExpanded(codexTaskViewKey(task)); if (expanded!==codexTaskViewKey(task)) setTaskMenu(false); setPickerOpen(false); pickerTrigger.current?.focus() }
        }}>
          <span className="arkme-codex-state-dot" data-working={liveTask(task)&&task.state==='working'} aria-hidden="true"/><span className="arkme-team-codex-task-title"><strong>{task.title}</strong><small>{status(task)}{liveTask(task) && !!task.queue?.items.length && ` · ${queueLabel(task)}`}</small></span><time title={time(task.updatedAt)}>{new Date(task.updatedAt).toLocaleTimeString(arkmeIntlLocale(),{hour:'2-digit',minute:'2-digit'})}</time>
        </button>
        {onOpenTask && <button type="button" className="arkme-codex-overview-actions" aria-label={tr('管理任务：{title}',{title:task.title})} aria-expanded={expanded===task.id && taskMenu}
          onClick={()=>{setExpanded(task.id);setTaskMenu(expanded===task.id ? !taskMenu : true)}}>⋯</button>}
        {onOpenTask && expanded===task.id && taskMenu && <div className="arkme-codex-overview-task-info">{taskInfo}{confirm?.id===task.id && confirmation}</div>}
      </article>)}
      {!collapsed.has(group.key) && group.tasks.length>(limits[group.key]??20) && <button type="button" onClick={()=>setLimits(current=>({...current,[group.key]:(current[group.key]??20)+20}))}>{tr('显示更多任务')}</button>}
    </section>)}
    {state?.cloud && !state.localOnly && <div className="arkme-team-codex-filters">
      <button type="button" disabled={page===1} onClick={()=>{setPage(page-1);setExpanded(undefined);if(isPersonal)setProject('')}}>{tr('上一页')}</button>
      <small>{tr('第 {page} 页',{page})}</small>
      <button type="button" disabled={!state.cloud.hasMore || page>=10000} onClick={()=>{setPage(page+1);setExpanded(undefined);if(isPersonal)setProject('')}}>{tr('下一页')}</button>
    </div>}
  </aside>
  return <section className="arkme-team-codex" data-codex-view={managementOnly ? 'management' : conversation ? 'conversation' : onOpenTask ? 'overview' : 'legacy'} aria-label={tr(managementOnly ? 'Codex 同步管理' : conversation ? 'Codex 对话阅读区' : '工作动态')}>
    {conversation && <header className="arkme-codex-unified-header">
      <strong className="arkme-codex-identity">Codex</strong>
      <div className="arkme-codex-centered-selector" ref={picker}>
        <button type="button" ref={pickerTrigger} className="arkme-codex-task-trigger" aria-label={tr('切换 Codex 任务')} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>
          {selected && <span className="arkme-codex-state-dot" data-working={liveTask(selected)&&selected.state==='working'} aria-hidden/>}
          <strong title={selected?.title}>{selected?.title ?? tr('选择任务')}</strong>
          {selected && <span className="arkme-team-codex-status" data-state={selected.state}>{status(selected)}</span>}<span aria-hidden>⌄</span>
        </button>
        {pickerOpen && <div className="arkme-codex-task-picker" role="dialog" aria-label={tr('切换 Codex 任务')}>{taskList}</div>}
      </div>
      <div className="arkme-codex-header-actions">{headerActions}<button type="button" className="arkme-codex-info-trigger" aria-label={tr('任务信息与操作')} aria-expanded={taskMenu} onClick={()=>setTaskMenu(!taskMenu)}>⋯</button></div>
      <div className="arkme-codex-context">{scopeControl}{selected && <>
        {!isPersonal && <ArkmeUserAvatar {...(selected.member.avatarRef?{avatarRef:selected.member.avatarRef}:{})} {...(selected.member.avatarFallback?{fallback:selected.member.avatarFallback}:{})} size={20} label={selected.member.displayName}/>}
        <span title={`${selected.member.displayName} · ${selected.projectName || tr('未归属项目')}`}>{!isPersonal && `${selected.member.displayName} · `}{selected.projectName || tr('未归属项目')}{isPersonal && ` · ${selected.cloud?.sourceName || tr('本机 Codex')}`}</span>
      </>}</div>
    </header>}
    {!conversation && <><div className="arkme-codex-toolbar">
    <div className="arkme-team-codex-owner">
      {state?.self && <ArkmeUserAvatar {...(state.self.avatarRef ? { avatarRef:state.self.avatarRef } : {})} {...(state.self.avatarFallback ? { fallback:state.self.avatarFallback } : {})} size={36} label={state.self.displayName} />}
      <div><strong>{state?.self?.displayName ?? tr('我的 Codex')}</strong><small>{!state ? tr('正在确认…') : tr(state.localOnly===false?'团队云端工作动态':'本机试用 · 仅自己可见')}</small></div>
      {(!connection || connection.status==='pending') && <button type="button" disabled={busy || !state?.self} onClick={() => { void invite() }}>{tr('接入本机 Codex')}</button>}
      {installations.length>0 && <button type="button" aria-expanded={manage} onClick={()=>setManage(!manage)}>{tr('管理连接')}</button>}
    </div>
    {managementOnly && <p className="arkme-team-codex-binding">{tr('团队：{name} · @{id}',{name:team?.name ?? '',id:team?.jotmoId ?? ''})}</p>}
    <p className="arkme-team-codex-scope" role="status">{tr('本机接入：{status}',{status:localStatus})}</p>
    <p className="arkme-team-codex-scope" role="status">{tr('云端上传：{status}',{status:cloudStatus})}
      {state?.cloud?.status==='ready' && state.cloud.uploadEnabled && state.cloud.blocked>0 && ` · ${tr('待上传 {count} 条',{count:state.cloud.pending})}`}
      {state?.cloud?.status==='ready' && state.cloud.message && ` · ${tr(state.cloud.message)}`}
    </p>
    </div>
    {state?.cloud && state.cloud.status!=='unsupported' && !state.cloud.uploadEnabled && !cloudConfirm && <button type="button" disabled={busy} onClick={()=>{setSourceName(state.cloud?.sourceName ?? tr('本机 Codex'));setCloudConfirm(true)}}>{tr('开启云端同步')}</button>}
    {cloudConfirm && <div className="arkme-team-codex-confirm" role="alert">
      <p>{tr('将账号「{account}」在团队「{team}」下未暂停、未排除的本地记录及后续输入输出上传，团队成员可见。排队请求暂不上云。', {account:state?.self ? `${state.self.displayName} · @${state.self.jotmoId ?? ''}` : tr('当前账号'),team:team ? `${team.name} · @${team.jotmoId}` : tr('当前团队')})}</p>
      <label className="arkme-codex-source-name">{tr('来源名称')}<input value={sourceName} disabled={busy} maxLength={128} aria-invalid={!validSourceName} onChange={event=>setSourceName(event.target.value)} /></label>
      <p>{tr('真实接入后登记来源，方便同账号在其他电脑显示 Codex 入口；不自动读取电脑名称。已有来源保留原名称。')}</p>
      {!validSourceName && <p role="alert">{tr('来源名称需为 1–128 字节，且不能包含控制字符')}</p>}
      <button type="button" disabled={busy || !validSourceName} onClick={()=>{void change('cloud','enable-cloud')}}>{tr('确认开启云端同步')}</button>
      <button type="button" onClick={()=>setCloudConfirm(false)}>{tr('取消')}</button>
    </div>}
    {manage && <div className="arkme-team-codex-management">
      {connection?.status==='active' && <button type="button" disabled={busy} onClick={()=>{void change(connection.id,'pause')}}>{tr('暂停同步')}</button>}
      {connection?.status==='paused' && <button type="button" disabled={busy} onClick={()=>{void change(connection.id,'resume')}}>{tr('恢复同步')}</button>}
      {connection?.status==='active' && <button type="button" disabled={busy} onClick={()=>{void invite()}}>{tr('查看接入指令')}</button>}
      {state?.cloud?.uploadEnabled && <button type="button" disabled={busy} onClick={()=>{void change('cloud','disable-cloud')}}>{tr('停止云端上传（保留本机采集）')}</button>}
      <p>{tr('采集本机新输入、每轮回答，以及已接入对话的当前排队请求；不补采历史，暂不包含远程和云端任务。')}</p>
      <p>{tr('队列为只读兼容预览；尚未产生接入事件的新对话，要在首次开始执行后才能关联。')}</p>
      <p>{tr('仅在 Arkme 确认开启云端上传后，指定团队中未暂停、未排除的已有记录及后续输入输出才会上传，团队成员可见。排队请求、Token 用量暂不上传；删除本地记录不会删除云端副本。')}</p>
      {installations.map(item=><div className="arkme-team-codex-device" key={item.id}>
        <span>{item.name==='Codex'?tr('本机 Codex'):item.name} · {tr(item.status==='active'?'已连接':item.status==='paused'?'已暂停':item.status==='pending'?'等待接入确认':item.status==='expired'?'接入指令已过期':'已断开')}</span>
        {['pending','active','paused'].includes(item.status) && <button type="button" disabled={busy} onClick={()=>setConfirm({id:item.id,action:'disconnect'})}>{tr('断开连接')}</button>}
      </div>)}
      {installations.some(item=>item.id===confirm?.id) && confirmation}
    </div>}
    {(error || readError) && <p className="arkme-team-codex-error" role="alert">{error || readError} <button type="button" onClick={() => { setError(''); void refresh() }}>{tr('重试')}</button></p>}
    {invitation && <section className="arkme-team-codex-invite" aria-label={tr('Codex 接入指令')}>
      <header><strong>{tr('接入我的 Codex')}</strong><button type="button" onClick={() => setInvitation(undefined)}>{tr('收起')}</button></header>
      {invitation.context && <div className="arkme-team-codex-binding">
        <span>{tr('账号：{name} · @{id}',{name:invitation.context.account.name,id:invitation.context.account.jotmoId})}</span>
        <span>{tr('团队：{name} · @{id}',{name:invitation.context.team.name,id:invitation.context.team.jotmoId})}</span>
      </div>}
      <p>{tr('任意 Codex 对话粘贴一次，后续本机各项目、任务自动采集（排除项除外）。')}</p>
      <p>{tr('每位成员、每台采集电脑需自行生成指令，请勿转发。仅查看云端记录无需接入采集。')}</p>
      <textarea readOnly rows={5} value={invitation.instructions} aria-label={tr('Codex 接入指令')} onFocus={event => event.currentTarget.select()} />
      <footer><small>{connection?.configured?tr('已配置；请在 Codex 检查 Hooks 信任状态'):tr('首次接入有效至 {time}',{ time:time(invitation.expiresAt) })}</small><button type="button" disabled={busy} onClick={() => { void copy() }}>{tr(copied ? '已复制' : '复制接入指令')}</button></footer>
      <details><summary>{tr('接入说明')}</summary><p>{tr('需本机安装 Python 3；保持 Arkme 运行并登录绑定账号。先审查脚本，再在 Codex 确认信任 Hooks；已有会话可能需要恢复或重启。收到真实事件才显示本机已连接。')}</p><p>{tr('只采集接入后的新输入、最终回答和中断状态，不读取此前历史。首次指令有效期不影响已完成的接入；云端上传授权需在 Arkme 单独确认。')}</p></details>
    </section>}
    </>}
    {conversation && (error || readError) && <p className="arkme-team-codex-error" role="alert">{error || readError} <button type="button" onClick={() => { setError(''); void refresh() }}>{tr('重试')}</button></p>}
    {conversation && unavailable.length>0 && <p className="arkme-codex-inline-notice" role="status">{tr('部分来源暂不可用：{teams}，当前仅显示可读取的记录。',{teams:unavailable.join('、')})} <button type="button" onClick={()=>{void refresh()}}>{tr('重试')}</button></p>}
    {conversation && taskMenu && taskInfo}
    {!state && !error && !readError && <p role="status">{tr('正在加载工作动态…')}</p>}
    {!managementOnly && !conversation && state?.tasks.length===0 && <div className="arkme-team-codex-empty"><strong>{tr('把正在做的事留在团队里')}</strong><p>{tr(state.localOnly ? '接入本机后，新的工作动态会显示在这里。' : '开启上传后，指定团队成员可跨电脑查看；仅查看云端记录无需接入本机 Codex。')}</p></div>}
    {!managementOnly && <div className="arkme-codex-workspace" data-has-selection={Boolean(selected)}>
    {!conversation && taskList}
    {!onOpenTask && <section className="arkme-codex-conversation" aria-label={tr('Codex 对话阅读区')}>
      {selected ? <>
        {!conversation && <header className="arkme-codex-conversation-header">
          <button type="button" className="arkme-codex-back" aria-label={tr('返回任务列表')} onClick={()=>setExpanded(undefined)}>←</button>
          <div className="arkme-codex-conversation-title"><strong title={selected.title}>{selected.title}</strong><small>{selected.member.displayName} · {selected.projectName || tr('未归属项目')}{selected.cloud && ` · ${selected.cloud.sourceName}`}</small></div>
          <span className="arkme-team-codex-status" data-state={selected.state}>{status(selected)}</span>
          <button type="button" aria-label={tr('任务信息与操作')} aria-expanded={taskMenu} onClick={()=>setTaskMenu(!taskMenu)}>⋯</button>
        </header>}
        {!conversation && taskMenu && taskInfo}
        {confirm?.id===selected.id && confirmation}
        {selected.cloudBlocked && <p className="arkme-codex-inline-notice">{tr('此会话曾关联不同账号或团队，暂不上传云端。')}</p>}
        {selected.projectExcluded && <p className="arkme-codex-inline-notice">{tr('此项目已排除；恢复单项任务不会恢复项目同步。')}</p>}
        {active && <TeamCodexConversation key={readingKey} teamRef={selectedTeamRef} task={selected} reading={readings.current.get(readingKey)!} inputName={selected.member.displayName}/>}
        <CodexQueueDock key={`queue:${readingKey}`} task={selected}/>
        {conversation && active && <CodexDispatchEntry
          scopeKey={JSON.stringify([selfMember, state?.self?.userRef, selectedTeamRef, readingKey])}
          mode={(selected.cloud ? !!selfMember && selected.cloud.ownerRef === selfMember
            : !!state?.self && selected.member.userRef === state.self.userRef)
            ? selected.cloud?.remote ? 'remote' : 'local' : 'readonly'}/>}
      </> : <div className="arkme-codex-reader-empty"><strong>Codex</strong><p>{tr(isPersonal && state?.tasks.length===0 ? '暂无自己的同步任务' : '选择一项任务，继续阅读对话')}</p><small>{tr(isPersonal ? '这里展示自己已同步的任务。接入与同事任务请前往团队工作台。' : '按成员和项目查看已同步的输入与回答')}</small>{conversation && <p>{(!isPersonal || !!state?.tasks.length) && <button type="button" onClick={() => setPickerOpen(true)}>{tr('选择任务')}</button>}<button type="button" onClick={onManage}>{tr(isPersonal ? '团队工作台' : target?.fromTeam ? '返回团队' : '团队与同步管理')}</button></p>}</div>}
    </section>}
    </div>}
  </section>
}
