import type {TeamMemberAdditionAttempt, TeamMemberAdditionRecovery, TeamMemberAddResult} from '../team-member-add-contract.js'
import {ArkmePluginError, objectValue as obj} from './service.js'

const invalid = () => new ArkmePluginError('team-member-result-invalid', '添加结果不完整，请核对原批次', true, 502)
const uidValid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v)
const id = (v: unknown): string => {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' ? v : ''
  if (!/^[1-9][0-9]*$/.test(s) || BigInt(s) > 9223372036854775807n) throw invalid()
  return s
}
export interface MemberAdditionPorts {
  actor: number
  teamId: string
  open(ref: unknown): Promise<Record<string, unknown>>
  key(userId: string): Promise<string>
  post(path: string, body: Record<string, unknown>, read?: boolean): Promise<Record<string, unknown>>
  journal(change?: {put: TeamMemberAdditionAttempt} | {ack: string}): Promise<TeamMemberAdditionAttempt | undefined>
}
/** One business owner for App, SDK and Tools. Persist intent before dispatch; keep it until acknowledged. */
export class TeamMemberAddition {
  constructor(private readonly p: MemberAdditionPorts) {}
  private async pending() {
    const value = await this.p.journal()
    if (value === undefined) return undefined
    if (!uidValid(value.requestUid) || !Array.isArray(value.userIds) || !value.userIds.length || value.userIds.length > 50 || new Set(value.userIds).size !== value.userIds.length || value.userIds.some(v => id(v) !== v)) throw invalid()
    return value
  }
  private async receipt(attempt: TeamMemberAdditionAttempt, raw: Record<string, unknown>): Promise<TeamMemberAddResult> {
    if (id(raw.team_id) !== this.p.teamId || id(raw.actor_user_id) !== String(this.p.actor) || raw.request_uid !== attempt.requestUid || !Array.isArray(raw.items) || raw.items.length !== attempt.userIds.length || !Number.isSafeInteger(raw.member_count) || Number(raw.member_count) < 1 || !Number.isSafeInteger(raw.membership_revision) || Number(raw.membership_revision) < 0) throw invalid()
    const seen = new Set<string>()
    const items = await Promise.all(raw.items.map(async value => {
      const row = obj(value), userId = id(row.user_id)
      if (!attempt.userIds.includes(userId) || seen.has(userId) || !['added', 'already_member', 'rejected'].includes(String(row.status)) || row.status === 'rejected' && row.reason !== 'account_unavailable') throw invalid()
      seen.add(userId)
      return {key: await this.p.key(userId), ...(attempt.labels?.[userId] ? {displayName: attempt.labels[userId]} : {}), status: row.status as 'added' | 'already_member' | 'rejected', ...(row.status === 'rejected' ? {reason: 'account_unavailable'} : {})}
    }))
    return {state: 'completed', requestUid: attempt.requestUid, memberCount: Number(raw.member_count), membershipRevision: Number(raw.membership_revision), items}
  }
  private async status(attempt: TeamMemberAdditionAttempt): Promise<TeamMemberAdditionRecovery> {
    const raw = await this.p.post('members/add-status', {team_id: this.p.teamId, request_uid: attempt.requestUid}, true)
    return raw.state === 'not_found' ? {state: 'unresolved', requestUid: attempt.requestUid} : this.receipt(attempt, raw)
  }
  async recover(): Promise<TeamMemberAdditionRecovery> { const attempt = await this.pending(); return attempt ? this.status(attempt) : {state: 'none'} }
  async ack(uid: unknown) {
    if (!uidValid(uid)) throw invalid()
    const attempt = await this.pending()
    if (attempt?.requestUid === uid && (await this.status(attempt)).state !== 'completed') throw invalid()
    await this.p.journal({ack: uid})
    return {state: 'acknowledged' as const}
  }
  private async send(attempt: TeamMemberAdditionAttempt) {
    // A rejected duplicate cannot prove that another in-flight copy did not
    // commit. Only a verified completed receipt may release the durable intent.
    return this.receipt(attempt, await this.p.post('members/add', {team_id: this.p.teamId, user_ids: attempt.userIds, request_uid: attempt.requestUid}))
  }
  async retry() {
    const attempt = await this.pending()
    if (!attempt) throw invalid()
    const state = await this.status(attempt)
    return state.state === 'completed' ? state : this.send(attempt)
  }
  async add(uid: unknown, refs: unknown) {
    if (!uidValid(uid) || !Array.isArray(refs) || !refs.length || refs.length > 50) throw invalid()
    const values = await Promise.all(refs.map(ref => this.p.open(ref)))
    const userIds = values.map(value => {
      if (id(value.team_id) !== this.p.teamId) throw invalid()
      return id(value.user_id)
    }).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
    if (new Set(userIds).size !== userIds.length) throw invalid()
    const labels = Object.fromEntries(values.map(value => [id(value.user_id), typeof value.display_name === 'string' ? value.display_name.slice(0, 256) : '']))
    let attempt: TeamMemberAdditionAttempt = {requestUid: uid, userIds, labels}
    const previous = await this.pending()
    if (previous && (previous.requestUid !== uid || JSON.stringify(previous.userIds) !== JSON.stringify(userIds))) throw new ArkmePluginError('team-member-add-unresolved', '请先核对原批次结果', false, 409)
    if (previous) attempt = previous
    const state = await this.status(attempt)
    if (state.state === 'completed') {
      // Retain even a historical receipt until the caller applies and acknowledges it.
      await this.p.journal({put: attempt})
      return state
    }
    if (!previous && values.some(value => !Number.isSafeInteger(value.expires) || Number(value.expires) < Date.now())) throw invalid()
    await this.p.journal({put: attempt})
    return this.send(attempt)
  }
}
