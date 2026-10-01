import type { DatabaseSync } from 'node:sqlite'
import type { ArkmeTeam, ArkmeTeamMember } from './types.js'
import type { TeamCodexEvent, TeamCodexEventPage, TeamCodexInvitation, TeamCodexState, TeamCodexTask } from './team-codex-contract.js'
import { ArkmePluginError } from './services/service.js'
import { TeamCodexCloudJournal } from './team-codex-cloud-journal.js'

export interface TeamCodexCloudPort {
  post<T>(owner: number, path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T>
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
  readonly journal: TeamCodexCloudJournal
  private controller = new AbortController()
  private readonly destinations = new Map<string, { id: string | null; until: number }>()
  private readonly failures = new Map<string, { state: CloudState; retryAt: number; attempts: number }>()
  private syncing = false
  constructor(private readonly db: DatabaseSync, private readonly port: TeamCodexCloudPort, private readonly currentUser: () => Promise<number | undefined>, private readonly now = Date.now) {
    this.journal = new TeamCodexCloudJournal(db)
    db.exec(`CREATE TABLE IF NOT EXISTS codex_cloud_consent (owner INTEGER NOT NULL, local_team TEXT NOT NULL,
      team TEXT NOT NULL, enabled INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(owner,local_team))`)
  }
  private consent(owner: number, team: string): {team:string;enabled:number}|undefined {
    return this.db.prepare('SELECT team,enabled FROM codex_cloud_consent WHERE owner=? AND local_team=?').get(owner, team) as {team:string;enabled:number}|undefined
  }
  async enable(owner: number, localTeam: string): Promise<void> {
    const signal = this.controller.signal
    const team = await this.destination(owner, localTeam, signal)
    if (!team) throw new ArkmePluginError('TEAM_FORBIDDEN', '本次云端试用仅面向即我团队', false, 403)
    await this.guard(owner, signal)
    this.db.prepare('INSERT INTO codex_cloud_consent(owner,local_team,team,enabled,at) VALUES(?,?,?,1,?) ON CONFLICT(owner,local_team) DO UPDATE SET enabled=1,at=excluded.at WHERE team=excluded.team').run(owner, localTeam, team, this.now())
    if (this.consent(owner, localTeam)?.team !== team) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '云端目标已变化，未开启上传', false, 409)
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
      if (!team) return 'unsupported'
      const consent = this.consent(owner, localTeam)
      if (consent && consent.team !== team) return 'unavailable'
      return consent?.enabled === 1 ? 'enabled' : 'disabled'
    } catch {
      await this.guard(owner, signal)
      return 'unavailable'
    }
  }
  fence(): void {
    this.controller.abort()
    this.controller = new AbortController()
    this.destinations.clear()
    this.failures.clear()
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
  private async destination(owner: number, localTeam: string, signal: AbortSignal): Promise<string | null> {
    await this.guard(owner, signal)
    const key = `${owner}:${localTeam}`, cached = this.destinations.get(key)
    if (cached && cached.until > this.now()) return cached.id
    const selected = await this.port.selectedTeam(localTeam, signal)
    await this.guard(owner, signal)
    if (selected.teamRef !== localTeam) return invalid()
    if (selected.jotmoId !== 'arkme_cn') {
      this.destinations.set(key, { id: null, until: this.now() + 60_000 })
      return null
    }
    const result = obj(await this.post(owner, '/api/v1/team/list-mine', {}, signal))
    if (!Array.isArray(result.teams)) return invalid()
    const teams = result.teams.map(obj).filter(t => t.jotmo_id === 'arkme_cn')
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
      if (!destination) return
      if (destination !== consent.team) throw new ArkmePluginError('ACCOUNT_OR_DESTINATION_MISMATCH', '已停止向变化后的团队上传', false, 409)
      const active = eligible(tasks)
      this.journal.reconcile(owner, localTeam, destination, active, readEvents)
      const batch = this.journal.batch(owner, localTeam, new Set(active.map(t => t.id)))
      if (!batch) return
      const result = await this.post(owner, '/api/v1/team-codex/sync', batch, signal)
      signal.throwIfAborted()
      this.journal.acknowledge(batch, result)
      this.failures.delete(`${owner}:${localTeam}`)
    } catch (error) { if (!signal.aborted) this.failure(owner, localTeam, error) }
    finally { this.syncing = false }
  }

  async state(owner: number, localTeam: string, local: TeamCodexState, page = 1, memberRef = '', sourceId = '', projectKey = ''): Promise<TeamCodexState> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || (memberRef && !decimal(memberRef)) || (sourceId && !validId(sourceId)) || (projectKey && (!sourceId || Buffer.byteLength(projectKey) > 1024))) throw new ArkmePluginError('team-codex-invalid', '云端筛选参数无效', false, 400)
    const signal = this.controller.signal
    const active = new Set(eligible(local.tasks).map(t => t.id))
    const counts = this.journal.counts(owner, localTeam, active)
    const ambiguous = local.tasks.filter(t=>t.cloudBlocked && t.status==='active' && !t.excluded && !t.projectExcluded).length
    counts.blocked += ambiguous
    try {
      const team = await this.destination(owner, localTeam, signal)
      if (!team) return { ...local, cloud: { status: 'unsupported', ...counts, page, message: '当前团队仅保留本机记录；本次云端试用仅面向即我团队。' } }
      const data = obj(await this.post(owner, '/api/v1/team-codex/tasks/list', { view: 'team', team_ref: team, page, limit: 50, ...(memberRef ? { member_ref: memberRef } : {}), ...(sourceId ? {source_id:sourceId} : {}), ...(projectKey ? {project_key:projectKey} : {}) }, signal))
      if (!Array.isArray(data.items) || data.items.length > 50 || data.page !== page || typeof data.has_more !== 'boolean') return invalid()
      const own = new Map<string, TeamCodexTask>()
      for (const task of local.tasks) {
        const mapping = this.journal.mapping(owner, localTeam, task.id)
        if (mapping) own.set(mapping.taskId, { ...task, cloud: { ...mapping, ownerRef: String(owner), remote: false } })
      }
      const remote = new Map<string, TeamCodexTask>()
      for (const value of data.items) {
        const row = obj(value), id = validId(row.task_id), sourceId = validId(row.source_id), user = decimal(row.owner_ref)
        if (!id || !sourceId || !user || row.team_ref !== team || (memberRef && user !== memberRef) || !Number.isSafeInteger(row.latest_at) || Number(row.latest_at) < 1 || !Number.isSafeInteger(row.event_count) || Number(row.event_count) < 0) return invalid()
        const matched = own.get(id)
        if (matched && matched.cloud?.sourceId === sourceId && user === String(owner)) { remote.set(id, matched); continue }
        const member: ArkmeTeamMember = user === String(owner) && local.self ? local.self : {
          userRef: `cloud:${user}`, displayName: str(row.display_name) || '团队成员', role: 'member', joinedAtMillis: 0,
          identityState: row.identity_state === 'ready' ? 'ready' : row.identity_state === 'incomplete' ? 'incomplete' : 'unavailable',
        }
        remote.set(id, { id, title: str(row.task_title) || 'Codex', status: 'active',
          state: row.state === 'in_progress' ? 'working' : row.state === 'interrupted' ? 'interrupted' : row.state === 'turn_ended' ? 'finished' : 'waiting',
          updatedAt: Number(row.latest_at), eventCount: Number(row.event_count), member, projectKey: str(row.project_key), projectName: str(row.project_name), branch: str(row.branch),
          cloud: { taskId: id, sourceId, sourceName: str(row.source_name), ownerRef: user, remote: true } })
      }
      // Local pending/excluded records remain on page one, never overwrite another member/device.
      if (page === 1 && (!memberRef || memberRef === String(owner))) for (const task of local.tasks) {
        const mapping = this.journal.mapping(owner, localTeam, task.id)
        if (sourceId && mapping?.sourceId !== sourceId || projectKey && task.projectKey !== projectKey) continue
        remote.set(mapping?.taskId ?? task.id, mapping ? own.get(mapping.taskId)! : task)
      }
      const failure = this.failures.get(`${owner}:${localTeam}`)
      return { ...local, localOnly: false, tasks: [...remote.values()].sort((a, b) => b.updatedAt - a.updatedAt),
        cloud: { ...(failure?.state ?? { status: 'ready' }), ...counts, page, hasMore: data.has_more,
          uploadEnabled: this.consent(owner,localTeam)?.enabled === 1,
          ...(counts.blocked ? { message: ambiguous ? '部分任务存在跨账号归属冲突，仅保留在本机，未继续上传。' : '部分记录存在版本冲突或被拒绝，已保留本地内容，未覆盖云端。' } : {}) } }
    } catch (error) {
      signal.throwIfAborted()
      await this.guard(owner, signal)
      return { ...local, tasks:page===1 && (!memberRef || memberRef===String(owner)) ? local.tasks : [],
        cloud: { ...this.failure(owner, localTeam, error), ...counts, page, uploadEnabled:this.consent(owner,localTeam)?.enabled === 1 } }
    }
  }

  /** Existing self view works on a reader-only computer without enrolling another collector. */
  async hasPersonalTasks(owner: number): Promise<boolean> {
    const signal = this.controller.signal
    const data = obj(await this.post(owner, '/api/v1/team-codex/tasks/list', {view:'self',page:1,limit:1}, signal))
    if (!Array.isArray(data.items) || data.items.length > 1 || data.page !== 1 || typeof data.has_more !== 'boolean'
      || (data.has_more && data.items.length === 0)) return invalid()
    for (const value of data.items) {
      const row = obj(value)
      if (!validId(row.task_id) || !validId(row.source_id) || decimal(row.owner_ref) !== String(owner)
        || !decimal(row.team_ref)) return invalid()
    }
    return data.items.length > 0
  }

  /** Bridge the verified public account ID to the numeric cloud identity, never by display name. */
  async resolveMember(owner: number, localTeam: string, jotmoId: string): Promise<string> {
    const signal = this.controller.signal
    const team = await this.destination(owner, localTeam, signal)
    if (!team) throw new ArkmePluginError('team-codex-member-unavailable', '当前团队尚不支持查看其他成员的云端对话', false, 409)
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

  async events(owner: number, localTeam: string, taskId: string, sourceId: string, cursor = ''): Promise<TeamCodexEventPage> {
    if (!validId(taskId) || !validId(sourceId) || cursor.length > 16384) throw new ArkmePluginError('team-codex-invalid', '云端记录标识无效', false, 400)
    const signal = this.controller.signal
    const team = await this.destination(owner, localTeam, signal)
    if (!team) throw new ArkmePluginError('TEAM_FORBIDDEN', '当前团队未启用云端读取', false, 403)
    const data = obj(await this.post(owner, '/api/v1/team-codex/events/list', { view: 'team', team_ref: team, source_id: sourceId, task_id: taskId, limit: 50, cursor }, signal))
    if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean' || (data.has_more && !str(data.next_cursor))) return invalid()
    const items = data.items.map(value => {
      const row = obj(value), kind = row.kind
      if (!str(row.event_id) || !str(row.turn_id) || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || !Number.isSafeInteger(row.turn_seq) || Number(row.turn_seq) < 1 || Number(row.turn_seq) > Math.floor(Number.MAX_SAFE_INTEGER / 3) || !Number.isSafeInteger(row.at) || Number(row.at) < 1 || typeof row.text !== 'string' || typeof row.truncated !== 'boolean' || !['UserPromptSubmit', 'Interrupt', 'Stop'].includes(String(kind))) return invalid()
      return { eventId: str(row.event_id), version: Number(row.version), sequence: Number(row.turn_seq) * 3 + (kind === 'Stop' ? 2 : kind === 'Interrupt' ? 1 : 0), turnId: str(row.turn_id), kind: kind as TeamCodexEvent['kind'], text: row.text, at: Number(row.at), truncated: row.truncated }
    })
    return { items, ...(data.has_more ? { nextCursor: str(data.next_cursor) } : {}) }
  }
}
