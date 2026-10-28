import { TeamCodexImageCloud } from './team-codex-image-cloud.js'
import type { DatabaseSync } from 'node:sqlite'
import type { ArkmeTeam, ArkmeTeamMember } from './types.js'
import type { TeamCodexEvent, TeamCodexEventPage, TeamCodexInvitation, TeamCodexState, TeamCodexTask } from './team-codex-contract.js'
import { ArkmePluginError } from './services/service.js'
import { DEFAULT_CODEX_SOURCE_NAME, TeamCodexCloudJournal, validCodexSourceName } from './team-codex-cloud-journal.js'
import { codexTurnTiming } from './team-codex-timing.js'
import { TeamCodexQueueCloud } from './team-codex-queue-cloud.js'
import { supportsCodexCloudQueue, parseCodexCloudQueue } from './team-codex-queue-wire.js'
import { syncCodexContent, uploadCodexObject, readCodexContent } from './team-codex-content.js'

export interface TeamCodexCloudPort {
  post<T>(owner: number, path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T>
  bytes?(owner:number,path:string,body:Uint8Array|Record<string,unknown>,headers:Record<string,string>,signal:AbortSignal):Promise<Uint8Array|Record<string,unknown>>
  selectedTeam(teamRef: string, signal: AbortSignal): Promise<ArkmeTeam>
}
type CloudState = NonNullable<TeamCodexState['cloud']>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const decimal = (value: unknown): string => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof text === 'string' && /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : ''
}
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const str = (v: unknown): string => typeof v === 'string' ? v : ''
const validId = (v: unknown): string => typeof v === 'string' && uuid.test(v) && v !== '00000000-0000-0000-0000-000000000000' ? v : ''
const invalid = (): never => { throw new ArkmePluginError('team-codex-response', '团队云端返回的数据不完整，请稍后重试', true, 502) }
const eligible = (tasks: readonly TeamCodexTask[]) => tasks.filter(t => t.status === 'active' && !t.excluded && !t.projectExcluded && !t.cloudBlocked)

export class TeamCodexCloud {
  private readonly contentCache:import('./team-codex-content.js').CodexContentCache=new Map()
  readonly journal: TeamCodexCloudJournal
  private readonly images:TeamCodexImageCloud
  private readonly queues: TeamCodexQueueCloud
  private readonly queueCapabilities = new Map<number, {supported:boolean;until:number}>()
  private readonly queueRetries = new Map<string, {attempts:number;at:number}>()
  private readonly lastReads = new Map<string, {tasks:TeamCodexTask[];hasMore:boolean;nextCursor:string|undefined}>()
  private controller = new AbortController()
  private readonly destinations = new Map<string, { id: string; until: number }>()
  private readonly failures = new Map<string, { state: CloudState; retryAt: number; attempts: number }>()
  private syncing = false
  private confirming = false
  private readonly settingsCursors=new Map<string,string>()
  constructor(private readonly db: DatabaseSync, private readonly port: TeamCodexCloudPort, private readonly currentUser: () => Promise<number | undefined>, private readonly now = Date.now,
    private readonly onConnectionEvidence: (owner:number) => void = () => undefined) {
    this.journal = new TeamCodexCloudJournal(db)
    this.queues = new TeamCodexQueueCloud(db,this.journal)
    this.images = new TeamCodexImageCloud(db,port)
    db.exec(`CREATE TABLE IF NOT EXISTS codex_cloud_consent (owner INTEGER NOT NULL, local_team TEXT NOT NULL,
      team TEXT NOT NULL, enabled INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(owner,local_team))`)
    const columns=new Set((db.prepare('PRAGMA table_info(codex_cloud_sources)').all() as {name:string}[]).map(c=>c.name))
    if (!columns.has('settings_mode')) db.exec("ALTER TABLE codex_cloud_sources ADD COLUMN settings_mode TEXT NOT NULL DEFAULT ''")
    if (!columns.has('settings_version')) db.exec('ALTER TABLE codex_cloud_sources ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('settings_ack')) db.exec('ALTER TABLE codex_cloud_sources ADD COLUMN settings_ack INTEGER NOT NULL DEFAULT 0')
    if(!columns.has('settings_at'))db.exec('ALTER TABLE codex_cloud_sources ADD COLUMN settings_at INTEGER NOT NULL DEFAULT 0')
    if (!(db.prepare('PRAGMA table_info(codex_cloud_consent)').all() as {name:string}[]).some(column => column.name === 'source_name')) {
      db.exec("ALTER TABLE codex_cloud_consent ADD COLUMN source_name TEXT NOT NULL DEFAULT '本机 Codex'")
    }
  }
  private consent(owner: number, team: string): {team:string;enabled:number;source_name:string}|undefined {
    return this.db.prepare('SELECT team,enabled,source_name FROM codex_cloud_consent WHERE owner=? AND local_team=?').get(owner, team) as {team:string;enabled:number;source_name:string}|undefined
  }
  async enable(owner: number, localTeam: string, sourceName = DEFAULT_CODEX_SOURCE_NAME): Promise<void> {
    if (!validCodexSourceName(sourceName)) throw new ArkmePluginError('INVALID_PARAMETER', '来源名称需为 1–128 字节，且不能包含控制字符', false, 400)
    const signal = this.controller.signal
    const team = await this.destination(owner, localTeam, signal)
    await this.guard(owner, signal)
    this.db.prepare('INSERT INTO codex_cloud_consent(owner,local_team,team,enabled,at,source_name) VALUES(?,?,?,1,?,?) ON CONFLICT(owner,local_team) DO UPDATE SET enabled=1,at=excluded.at,source_name=excluded.source_name WHERE team=excluded.team').run(owner, localTeam, team, this.now(),sourceName.trim())
    if (this.consent(owner, localTeam)?.team !== team) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '云端目标已变化，未开启上传', false, 409)
    this.journal.retryConfirmations(owner,localTeam)
  }
  disable(owner:number,team:string):void {
    this.fence()
    this.db.prepare('UPDATE codex_cloud_consent SET enabled=0 WHERE owner=? AND local_team=?').run(owner,team)
  }
  /** Read-only onboarding check: cloud capability is not the member's upload consent. */
  async invitationStatus(owner: number, localTeam: string): Promise<NonNullable<TeamCodexInvitation['context']>['cloudUpload']> {
    const signal = this.controller.signal
    try {
      const team = await this.destination(owner, localTeam, signal)
      const consent = this.consent(owner, localTeam)
      if (consent && consent.team !== team) return 'unavailable'
      return consent?.enabled === 1 ? 'enabled' : 'disabled'
    } catch {
      await this.guard(owner, signal)
      return 'unavailable'
    }
  }
  fence(): void {
    this.contentCache.clear()
    this.controller.abort()
    this.controller = new AbortController()
    this.destinations.clear()
    this.failures.clear()
    this.queueCapabilities.clear()
    this.queueRetries.clear()
    this.lastReads.clear();this.settingsCursors.clear()
  }
  private async guard(owner: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (await this.currentUser() !== owner) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '账号已切换，云端同步已停止', false, 409)
    signal.throwIfAborted()
  }
  private async post<T>(owner: number, path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    await this.guard(owner, signal)
    const result = await this.port.post<T>(owner, path, body, signal)
    await this.guard(owner, signal)
    return result
  }

  /** Metadata only. Callers supply only source IDs with accepted local Hook evidence. */
  async confirmSources(owner: number, localTeam: string, verifiedLocalSources: readonly string[]): Promise<void> {
    const consent = this.consent(owner,localTeam)
    if (!consent || this.confirming) return
    const signal = this.controller.signal
    this.confirming = true
    try {
      await this.guard(owner,signal)
      let sent = 0
      for (const localSource of new Set(consent.enabled?verifiedLocalSources:[])) {
        // Use the stored destination and UUID, never infer a replacement binding on retry.
        const source = this.journal.source(owner,localTeam,consent.team,localSource,consent.source_name)
        if (!this.journal.confirmationDue(source.id,this.now())) continue
        if (sent++ >= 20) break
        try {
          const data = obj(await this.post(owner,'/api/v1/team-codex/sources/confirm',{
            expected_owner_ref:String(owner),team_ref:source.team,source_id:source.id,source_name:source.name,
          },signal))
          if (typeof data.owner_ref !== 'string' || !decimal(data.owner_ref) || !validId(data.source_id)) return invalid()
          if (data.owner_ref !== String(owner) || data.source_id !== source.id) {
            throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH','来源确认身份不一致，已停止重试',false,409)
          }
          this.journal.confirmSource(source.id,this.now())
          this.onConnectionEvidence(owner)
        } catch (error) {
          signal.throwIfAborted()
          const code = error instanceof ArkmePluginError ? error.code : ''
          const blocked = ['TEAM_FORBIDDEN','ACCOUNT_OR_DESTINATION_MISMATCH','INVALID_PARAMETER','PAYLOAD_TOO_LARGE'].includes(code) ? code : ''
          this.journal.failConfirmation(source.id,this.now(),blocked)
        }
      }
      // Minimal control confirmations survive disabled content upload and restarts.
      const key=JSON.stringify([owner,localTeam]),after=this.settingsCursors.get(key)??''
      const hasInstallations=!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='codex_installations'").get()
      const desired=!consent.enabled?"'disabled'":hasInstallations?"CASE WHEN i.status='paused' THEN 'paused' ELSE 'enabled' END":"'enabled'"
      const query=`SELECT s.*,${desired} desired_mode FROM codex_cloud_sources s ${hasInstallations?'LEFT JOIN codex_installations i ON i.id=s.local_source AND i.user_id=s.owner':''}
        WHERE s.owner=? AND s.local_team=? AND (s.settings_ack<s.settings_version OR s.settings_mode<>${desired})`
      let sources=this.db.prepare(query+' AND s.id>? ORDER BY s.id LIMIT 20').all(owner,localTeam,after)
      if(!sources.length)sources=this.db.prepare(query+' ORDER BY s.id LIMIT 20').all(owner,localTeam)
      this.settingsCursors.set(key,String(sources.at(-1)?.id??''))
      for(const row of sources){
        const mode=String(row.desired_mode)
        if(row.settings_mode!==mode)this.db.prepare('UPDATE codex_cloud_sources SET settings_mode=?,settings_version=settings_version+1,settings_at=? WHERE id=?').run(mode,this.now(),String(row.id))
        const current=this.db.prepare('SELECT settings_mode,settings_version,settings_ack,settings_at FROM codex_cloud_sources WHERE id=?').get(String(row.id))!
        if(Number(current.settings_ack)>=Number(current.settings_version))continue
        try{
          const result=obj(await this.post(owner,'/api/v1/team-codex/sources/settings/update',{source_id:String(row.id),settings:{version:Number(current.settings_version),mode:String(current.settings_mode),observed_at:Number(current.settings_at)}},signal))
          if(['saved','unchanged'].includes(str(result.status))&&result.version===current.settings_version)this.db.prepare('UPDATE codex_cloud_sources SET settings_ack=MAX(settings_ack,?) WHERE id=?').run(Number(current.settings_version),String(row.id))
        }catch{signal.throwIfAborted()}
      }
    } finally { this.confirming = false }
  }

  /** Account history, independent of current team permissions, tasks or collection consent. */
  async connectionStatus(owner: number): Promise<boolean> {
    const data = obj(await this.post(owner,'/api/v1/team-codex/connection/status',{},this.controller.signal))
    if (data.owner_ref !== String(owner) || typeof data.has_connected_codex !== 'boolean'
      || (data.has_connected_codex
        ? !Number.isSafeInteger(data.first_connected_at) || Number(data.first_connected_at) <= 0
        : data.first_connected_at !== null)) return invalid()
    if (data.has_connected_codex) this.onConnectionEvidence(owner)
    this.queueCapabilities.set(owner,{supported:supportsCodexCloudQueue(data),until:this.now()+300_000})
    return data.has_connected_codex
  }
  private async destination(owner: number, localTeam: string, signal: AbortSignal): Promise<string> {
    await this.guard(owner, signal)
    const key = `${owner}:${localTeam}`, cached = this.destinations.get(key)
    if (cached && cached.until > this.now()) return cached.id
    const selected = await this.port.selectedTeam(localTeam, signal)
    await this.guard(owner, signal)
    if (selected.teamRef !== localTeam || !selected.jotmoId) return invalid()
    const result = obj(await this.post(owner, '/api/v1/team/list-mine', {}, signal))
    if (!Array.isArray(result.teams)) return invalid()
    const teams = result.teams.map(obj).filter(t => t.jotmo_id === selected.jotmoId)
    const id = teams.length === 1 ? decimal(teams[0]!.team_id) : ''
    if (!id) throw new ArkmePluginError('TEAM_FORBIDDEN', '当前账号没有指定团队的云端访问权限', false, 403)
    this.destinations.set(key, { id, until: this.now() + 60_000 })
    return id
  }
  private failure(owner: number, team: string, error: unknown): CloudState {
    const key = `${owner}:${team}`
    const code = error instanceof ArkmePluginError ? error.code : error instanceof Error ? error.message : ''
    const blocked = ['TEAM_FORBIDDEN', 'ACCOUNT_OR_DESTINATION_MISMATCH', 'INVALID_PARAMETER', 'PAYLOAD_TOO_LARGE', 'login-required', 'auth-http-401', 'auth-http-403'].includes(code)
    const attempts = (this.failures.get(key)?.attempts ?? 0) + 1
    const state: CloudState = { status: blocked ? 'blocked' : 'offline', pending: 0, blocked: 0, page: 1,
      message: blocked ? '云端同步已停止，请检查账号、团队权限或上传数据。' : '云端暂不可用，本地记录已保留，将自动重试。' }
    this.failures.set(key, { state, attempts, retryAt: this.now() + (blocked ? 60_000 : Math.min(60_000, 5000 * 2 ** Math.min(attempts - 1, 4))) })
    this.destinations.delete(key)
    return state
  }
  async sync(owner: number, localTeam: string, tasks: readonly TeamCodexTask[], readEvents: (task: TeamCodexTask) => TeamCodexEvent[]): Promise<void> {
    const consent = this.consent(owner, localTeam)
    if (!consent?.enabled) return
    if (this.syncing || (this.failures.get(`${owner}:${localTeam}`)?.retryAt ?? 0) > this.now()) return
    const signal = this.controller.signal
    this.syncing = true
    try {
      const destination = await this.destination(owner, localTeam, signal)
      if (destination !== consent.team) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '已停止向变化后的团队上传', false, 409)
      const active = eligible(tasks)
      this.journal.reconcile(owner, localTeam, destination, active, readEvents,consent.source_name)
      const eligibleIds=new Set(active.map(t=>t.id))
      // Drain acknowledged backlog in bounded bursts, instead of waiting five seconds per batch.
      // No-progress/partial failure never spins or suppresses the normal retry backoff.
      for(let round=0;round<4;round++) {
        const batch=this.journal.batch(owner,localTeam,eligibleIds)
        if(!batch)break
        const before=this.journal.counts(owner,localTeam,eligibleIds).pending
        const result=await syncCodexContent(owner,this.post.bind(this),this.journal,batch,signal)
        signal.throwIfAborted()
        this.journal.acknowledge(batch,result)
        this.failures.delete(`${owner}:${localTeam}`)
        if(this.journal.counts(owner,localTeam,eligibleIds).pending>=before)break
      }
      for(let round=0;round<4;round++){
        const classification=this.journal.classificationBatch(owner,localTeam);if(!classification)break
        const result=await this.post(owner,'/api/v1/team-codex/sync',classification,signal)
        if(!this.journal.acknowledgeClassifications(classification,result))break
      }
      await this.syncQueues(owner,localTeam,active,signal)
      // Media has its own bounded worker and cannot delay text or queue acknowledgements.
      void this.images.sync(owner,localTeam,eligibleIds,signal).catch(()=>undefined)
    } catch (error) { if (!signal.aborted) this.failure(owner, localTeam, error) }
    finally { this.syncing = false }
  }

  private async syncQueues(owner:number,team:string,tasks:readonly TeamCodexTask[],signal:AbortSignal):Promise<void> {
    if(!tasks.some(task=>task.queue))return
    this.queues.reconcile(owner,team,tasks)
    const key=JSON.stringify([owner,team]),retry=this.queueRetries.get(key)
    if(retry && retry.at>this.now())return
    try {
      if((this.queueCapabilities.get(owner)?.until??0)<=this.now())await this.connectionStatus(owner)
      if(!this.queueCapabilities.get(owner)?.supported)return
      const ids=new Set(tasks.map(task=>task.id))
      for(let round=0;round<4;round++) {
        const batch=this.queues.batch(owner,team,ids)
        if(!batch){this.queueRetries.delete(key);return}
        const metadata={...batch,tasks:batch.tasks.map(({queue_snapshot,...task})=>task)}
        const result=obj(await this.post(owner,'/api/v1/team-codex/sync',metadata,signal))
        const queueResults:unknown[]=Array.isArray(result.queue_results)?[...result.queue_results]:[]
        for(const task of batch.tasks){if(!task.queue_snapshot)continue
          const committed=await uploadCodexObject(owner,this.post.bind(this),batch,task.task_id,'queue','current',{queue:task.queue_snapshot},signal)
          if(Array.isArray(committed.queue_results))queueResults.push(...committed.queue_results)
        }
        result.queue_results=queueResults
        if(!this.queues.acknowledge(batch,result))throw new Error('QUEUE_ACK_PENDING')
      }
      this.queueRetries.delete(key)
    } catch {
      signal.throwIfAborted()
      // Queue protocol failures must not block ordinary prompt/answer synchronization.
      const attempts=(retry?.attempts??0)+1
      this.queueRetries.set(key,{attempts,at:this.now()+Math.min(60_000,5000*2**Math.min(attempts-1,4))})
    }
  }

  async state(owner: number, localTeam: string, local: TeamCodexState, page = 1, memberRef = '', sourceId = '', projectKey = '', position:{cursor?:string|undefined;after?:string|undefined;from?:string|undefined} = {},externalSignal?:AbortSignal): Promise<TeamCodexState> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || (memberRef && !decimal(memberRef)) || (sourceId && !validId(sourceId)) || (projectKey && (!sourceId || Buffer.byteLength(projectKey) > 1024))) throw new ArkmePluginError('team-codex-invalid', '云端筛选参数无效', false, 400)
    if([position.cursor,position.after,position.from].filter(Boolean).length>1 || [position.cursor,position.after,position.from].some(value=>value!==undefined&&value.length>2048))throw new ArkmePluginError('team-codex-invalid','云端分页位置无效',false,400)
    const signal = externalSignal?AbortSignal.any([this.controller.signal,externalSignal]):this.controller.signal
    const active = new Set(eligible(local.tasks).map(t => t.id))
    const readKey=JSON.stringify([owner,localTeam,page,memberRef,sourceId,projectKey,...(position.cursor||position.after||position.from?[position.cursor??'',position.after??'',position.from??'']:[])])
    const counts = this.journal.counts(owner, localTeam)
    const settingsPending = !!this.db.prepare(`SELECT 1 FROM codex_cloud_sources WHERE owner=? AND (?='self' OR local_team=?) AND settings_ack<settings_version LIMIT 1`).get(owner,localTeam,localTeam)
    const ambiguous = local.tasks.filter(t=>t.cloudBlocked && t.status==='active' && !t.excluded && !t.projectExcluded).length
    counts.blocked += ambiguous
    try {
      const personal=localTeam==='self'
      const team = personal?null:await this.destination(owner, localTeam, signal)
      const cursor=position.cursor || (!position.after&&!position.from&&page>1?this.lastReads.get(JSON.stringify([owner,localTeam,page-1,memberRef,sourceId,projectKey]))?.nextCursor:undefined)
      if(page>1&&!cursor&&!position.after&&!position.from)throw new ArkmePluginError('team-codex-cursor-invalid','列表位置已变化，请刷新后继续',false,400)
      const data = obj(await this.post(owner, '/api/v1/team-codex/tasks/list', { protocol_version:2,view: personal?'self':'team',...(personal?{}:{team_ref:team}),page, ...(cursor?{cursor}:{}), ...(position.after?{after:position.after}:{}), ...(position.from?{from:position.from}:{}), limit: 50, ...(memberRef ? { member_ref: memberRef } : {}), ...(sourceId ? {source_id:sourceId} : {}), ...(projectKey ? {project_key:projectKey} : {}) }, signal))
      if (!Array.isArray(data.items) || data.items.length > 50 || data.page !== page || typeof data.has_more !== 'boolean') return invalid()
      if(Object.hasOwn(data,'capabilities'))this.queueCapabilities.set(owner,{supported:supportsCodexCloudQueue(data),until:this.now()+300_000})
      const own = new Map<string, TeamCodexTask>()
      for (const task of local.tasks) {
        const mapping = this.journal.mapping(owner, localTeam, task.id)
        if (mapping) own.set(mapping.taskId, { ...task, cloud: { ...mapping, ownerRef: String(owner), remote: false } })
      }
      const remote = new Map<string, TeamCodexTask>()
      // Preserve a known source-side decision even when that row is no longer in local.tasks.
      const hasVisibility=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_session_visibility'").get()
      const hidden=new Set(hasVisibility && data.items.length ? (this.db.prepare(`SELECT c.id,s.id source FROM codex_cloud_tasks c
        JOIN codex_cloud_sources s ON s.id=c.source JOIN codex_tasks t ON t.id=c.local_id
        JOIN codex_session_visibility v ON v.installation_id=t.installation_id AND v.session_id=t.session_id
        WHERE s.owner=? AND (?='self' OR s.local_team=?) AND v.visibility<>'user' AND c.id IN (${data.items.map(()=>'?').join(',')})`).all(owner,localTeam,localTeam,...data.items.map(value=>str(obj(value).task_id))) as {id:string;source:string}[])
        .map(row=>JSON.stringify([row.source,row.id])) : [])
      for (const value of data.items) {
        const row = obj(value), id = validId(row.task_id), sourceId = validId(row.source_id), user = decimal(row.owner_ref)
        if (!id || !sourceId || !user || (!personal && row.team_ref !== team || personal&&!decimal(row.team_ref)) || (memberRef && user !== memberRef) || !Number.isSafeInteger(row.latest_at) || Number(row.latest_at) < 1 || !Number.isSafeInteger(row.event_count) || Number(row.event_count) < 0) return invalid()
        if(user===String(owner)&&hidden.has(JSON.stringify([sourceId,id]))) continue
        const matched = own.get(id)
        if (matched && matched.cloud?.sourceId === sourceId && user === String(owner)) { remote.set(id, matched); continue }
        const member: ArkmeTeamMember = user === String(owner) && local.self ? local.self : {
          userRef: `cloud:${user}`, displayName: str(row.display_name) || '团队成员', role: 'member', joinedAtMillis: 0,
          identityState: row.identity_state === 'ready' ? 'ready' : row.identity_state === 'incomplete' ? 'incomplete' : 'unavailable',
        }
        // Team access to conversation text does not grant access to another member's queued inputs.
        const summary=user===String(owner)&&Number.isSafeInteger(row.queue_count)&&Number(row.queue_count)>=0&&Number(row.queue_count)<=200?parseCodexCloudQueue({...obj(row.queue_snapshot),items:[]}):undefined
        const queueSummary=summary?{...summary,items:undefined,count:Number(row.queue_count),waitingCount:Number(row.queue_waiting_count??0)}:undefined
        const queueCloud:TeamCodexTask['queueCloud']=user!==String(owner)?'private':queueSummary?'ready'
          :this.queueCapabilities.get(owner)?.supported?'unavailable':'unsupported'
        remote.set(id, { id, title: str(row.task_title) || 'Codex', metadataVersion:Number(row.task_metadata_version), summaryVersion:Number(row.summary_version), status: 'active',
          state: row.state === 'in_progress' ? 'working' : row.state === 'interrupted' ? 'interrupted' : row.state === 'turn_ended' ? 'finished' : 'waiting',
          updatedAt: Number(row.latest_at), eventCount: Number(row.event_count), member, projectKey: str(row.project_key), projectName: str(row.project_name), branch: str(row.branch),
          cloud: { taskId: id, sourceId, sourceName: str(row.source_name), ownerRef: user, remote: true },queueCloud,...(queueSummary?{queueSummary}:{}) })
      }
      if ([...remote.values()].some(task => task.cloud?.ownerRef === String(owner))) this.onConnectionEvidence(owner)
      // Local pending/excluded records remain on page one, never overwrite another member/device.
      if (page === 1 && (!memberRef || memberRef === String(owner))) for (const task of local.tasks) {
        const mapping = this.journal.mapping(owner, localTeam, task.id)
        if (sourceId && mapping?.sourceId !== sourceId || projectKey && task.projectKey !== projectKey) continue
        if(mapping && !task.excluded && !task.projectExcluded && !this.journal.hasPendingTask(owner,localTeam,task.id))continue
        remote.set(mapping?.taskId ?? task.id, mapping ? own.get(mapping.taskId)! : task)
      }
      const failure = this.failures.get(`${owner}:${localTeam}`)
      const reviewingTasks=0
      const visible=[...remote.values()]
      this.lastReads.delete(readKey)
      this.lastReads.set(readKey,{tasks:visible.filter(task=>task.cloud?.remote),hasMore:data.has_more,nextCursor:str(data.next_cursor)||undefined})
      if(this.lastReads.size>100)this.lastReads.delete(this.lastReads.keys().next().value!)
      return { ...local, localTaskPage:undefined, localOnly: false, tasks: visible.sort((a, b) => b.updatedAt - a.updatedAt),
        // Successful list reads must not be discarded because an earlier upload failed.
        cloud: { status:'ready', ...(failure ? {message:failure.state.message} : {}), ...counts, page, hasMore: data.has_more, hasNewer:data.has_newer===true, firstCursor:str(data.first_cursor)||undefined, nextCursor:str(data.next_cursor)||undefined, previousCursor:str(data.previous_cursor)||undefined, reviewingTasks, settingsPending,
          uploadEnabled: this.consent(owner,localTeam)?.enabled === 1,
          sourceName: this.consent(owner,localTeam)?.source_name ?? DEFAULT_CODEX_SOURCE_NAME,
          ...(counts.blocked ? { message: ambiguous ? '部分任务存在跨账号归属冲突，仅保留在本机，未继续上传。' : '部分记录存在版本冲突或被拒绝，已保留本地内容，未覆盖云端。' } : {}) } }
    } catch (error) {
      signal.throwIfAborted()
      await this.guard(owner, signal)
      const failure=this.failure(owner,localTeam,error)
      const cached=failure.status==='offline'?this.lastReads.get(readKey):undefined
      const retained=(cached?.tasks??[]).map(task=>({...task,
        ...(task.queue?{queue:{...task.queue,availability:'stale' as const}}:{}),...(task.queueSummary?{queueSummary:{...task.queueSummary,availability:'stale' as const}}:{})}))
      if(failure.status!=='offline')this.lastReads.clear()
      const remotePosition=!!(position.cursor||position.after||position.from||sourceId||projectKey)
      const current=!remotePosition&&page===1 && (!memberRef || memberRef===String(owner)) ? local.tasks : []
      const currentIds=new Set(current.map(task=>this.journal.mapping(owner,localTeam,task.id)?.taskId??task.id))
      return { ...local,...(cached||remotePosition?{localTaskPage:undefined}:{}), tasks:[...current,...retained.filter(task=>!currentIds.has(task.id))],
        cloud: { ...failure, ...counts, settingsPending, page, ...(cached?{hasMore:cached.hasMore}:{}), uploadEnabled:this.consent(owner,localTeam)?.enabled === 1,
          sourceName:this.consent(owner,localTeam)?.source_name ?? DEFAULT_CODEX_SOURCE_NAME } }
    }
  }

  /** Bridge the verified public account ID to the numeric cloud identity, never by display name. */
  async resolveMember(owner: number, localTeam: string, jotmoId: string): Promise<string> {
    const signal = this.controller.signal
    const team = await this.destination(owner, localTeam, signal)
    const matches = new Set<string>(), cursors = new Set<string>()
    let cursor = ''
    for (let page = 0; page < 100; page++) {
      const data = obj(await this.post(owner, '/api/v1/team/members/list', {team_id:Number(team),limit:50,page_cursor:cursor}, signal))
      if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean') return invalid()
      for (const value of data.items) {
        const row = obj(value)
        if (row.jotmo_id !== jotmoId) continue
        const id = decimal(row.user_id)
        if (!id) return invalid()
        matches.add(id)
      }
      if (!data.has_more) {
        if (matches.size === 1) return [...matches][0]!
        break
      }
      cursor = str(data.next_page_cursor)
      if (!cursor || cursors.has(cursor)) return invalid()
      cursors.add(cursor)
    }
    throw new ArkmePluginError('team-codex-member-unavailable', '暂时无法核对这位成员的云端身份，请刷新团队后重试', true, 409)
  }

  async accountPost<T>(owner:number,path:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<T>{return this.post(owner,path,body,signal?AbortSignal.any([this.controller.signal,signal]):this.controller.signal)}
  localEvents(owner:number,team:string,localId:string,cursor='',window?:{after?:string;from?:string;through?:string}){
    return this.journal.readPage(owner,team,localId,cursor,window)
  }
  originalTurns(owner:number,team:string,localId:string,wanted:readonly string[]){return this.journal.originalTurns(owner,team,localId,wanted)}
  async imageBytes(owner:number,sourceId:string,taskId:string,eventId:string,imageId:string,full:boolean,externalSignal?:AbortSignal):Promise<{data:Uint8Array;mediaType:'image/png'|'image/jpeg'|'image/webp'}>{
    if(!this.port.bytes)throw new ArkmePluginError('capability-unsupported','当前环境不支持图片读取',false,503)
    const signal=externalSignal?AbortSignal.any([this.controller.signal,externalSignal]):this.controller.signal
    await this.guard(owner,signal)
    const data=await this.port.bytes(owner,'/api/v1/team-codex/images/read',{source_id:sourceId,task_id:taskId,event_id:eventId,image_id:imageId,variant:full?'original':'thumbnail'},{},signal)
    await this.guard(owner,signal)
    if(!(data instanceof Uint8Array)||!data.byteLength||data.byteLength>20*1024*1024)return invalid()
    const png=data.length>=8&&Buffer.from(data.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    const jpeg=data.length>=3&&data[0]===255&&data[1]===216&&data[2]===255
    const webp=data.length>=12&&Buffer.from(data.subarray(0,4)).toString()==='RIFF'&&Buffer.from(data.subarray(8,12)).toString()==='WEBP'
    if(!png&&!jpeg&&!webp)return invalid()
    return {data,mediaType:png?'image/png':jpeg?'image/jpeg':'image/webp'}
  }
  async image(owner:number,sourceId:string,taskId:string,eventId:string,imageId:string,full:boolean):Promise<{dataUrl:string}>{
    const value=await this.imageBytes(owner,sourceId,taskId,eventId,imageId,full)
    return {dataUrl:`data:${value.mediaType};base64,${Buffer.from(value.data).toString('base64')}`}
  }
  async events(owner: number, localTeam: string, taskId: string, sourceId: string, cursor = '', window?:{after?:string;from?:string;through?:string},externalSignal?:AbortSignal): Promise<TeamCodexEventPage> {
    if (!validId(taskId) || !validId(sourceId) || cursor.length > 16384) throw new ArkmePluginError('team-codex-invalid', '云端记录标识无效', false, 400)
    const signal = externalSignal?AbortSignal.any([this.controller.signal,externalSignal]):this.controller.signal
    const personal=localTeam==='self'
    const team = personal?null:await this.destination(owner, localTeam, signal)
    const data = obj(await readCodexContent(await this.post(owner, '/api/v1/team-codex/content/list', {protocol_version:2,view:personal?'self':'team',...(personal?{}:{team_ref:team}),source_id:sourceId,task_id:taskId,limit:50,cursor,...window},signal),sourceId,taskId,signal,owner,this.contentCache))
    await this.guard(owner,signal)
    if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean' || (data.has_more && !str(data.next_cursor))) return invalid()
    const items = data.items.map(value => {
      const row = obj(value), kind = row.kind
      if (!str(row.event_id) || !str(row.turn_id) || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || !Number.isSafeInteger(row.turn_seq) || Number(row.turn_seq) < 1 || Number(row.turn_seq) > Math.floor(Number.MAX_SAFE_INTEGER / 3) || !Number.isSafeInteger(row.at) || Number(row.at) < 1 || typeof row.text !== 'string' || typeof row.truncated !== 'boolean' || !['UserPromptSubmit','Progress','Interrupt','Stop'].includes(String(kind))) return invalid()
      const timing=codexTurnTiming(row.timing)
      return { eventId: str(row.event_id), version: Number(row.version), sequence:Number(row.turn_seq)*4+({UserPromptSubmit:0,Progress:1,Interrupt:2,Stop:3}[String(kind)]??0),turnSequence:Number(row.turn_seq),messageSequence:Number(row.message_seq??0),cursor:str(row.cursor), turnId: str(row.turn_id), kind: kind as TeamCodexEvent['kind'], text: row.text, at: Number(row.at), truncated: row.truncated,
        ...(row.private_images_unavailable===true?{privateImagesUnavailable:true}:{}),
        ...(Array.isArray(row.private_images)?{privateImages:row.private_images.map(obj).map(im=>({ref:str(im.image_id),width:Number(im.width),height:Number(im.height),state:im.state==='ready'?'ready' as const:im.state==='pending'?'pending' as const:'unavailable' as const}))}:{}),
        ...(timing && (kind==='UserPromptSubmit'||kind==='Stop'&&timing.state==='finished'||kind==='Interrupt'&&timing.state==='interrupted')?{timing}:{}) }
    })
    const queue=data.owner_view===true?this.queues.read(owner,localTeam,sourceId,taskId,data.queue_snapshot,this.now()):undefined
    const queueCloud:NonNullable<TeamCodexTask['queueCloud']>=data.owner_view===true?queue?'ready':'unavailable':'private'
    const summary=obj(data.task_summary)
    if(summary.source_id!==sourceId || summary.task_id!==taskId || typeof summary.task_title!=='string' || Buffer.byteLength(summary.task_title)>1024 || typeof summary.project_key!=='string' || Buffer.byteLength(summary.project_key)>1024 || typeof summary.project_name!=='string' || Buffer.byteLength(summary.project_name)>256 || typeof summary.branch!=='string' || Buffer.byteLength(summary.branch)>256 || !Number.isSafeInteger(summary.task_metadata_version) || Number(summary.task_metadata_version)<1 || !Number.isSafeInteger(summary.summary_version) || Number(summary.summary_version)<0 || !Number.isSafeInteger(summary.event_count) || Number(summary.event_count)<0 || !Number.isSafeInteger(summary.latest_at) || Number(summary.latest_at)<0 || !['','empty','in_progress','interrupted','turn_ended'].includes(String(summary.state)))return invalid()
    const taskSummary={title:summary.task_title || 'Codex',metadataVersion:Number(summary.task_metadata_version),summaryVersion:Number(summary.summary_version),projectKey:summary.project_key,projectName:summary.project_name,branch:summary.branch,state:summary.state==='in_progress'?'working' as const:summary.state==='interrupted'?'interrupted' as const:summary.state==='turn_ended'?'finished' as const:'waiting' as const,updatedAt:Number(summary.latest_at),eventCount:Number(summary.event_count)}
    return { taskSummary,items,queueCloud,...(queue?{queue}:{}),latestCursor:str(data.latest_cursor),firstCursor:items[0]?.cursor??'',...(data.has_more ? { nextCursor: str(data.next_cursor) } : {}) }
  }
}
