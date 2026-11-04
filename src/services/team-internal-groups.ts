import type { TeamInternalGroupAttempt, TeamInternalGroupResult } from '../team-internal-group-contract.js'
import { ArkmePluginError } from './service.js'

type Attempt = TeamInternalGroupAttempt
export interface InternalGroupPorts {
  journal(change?: {put: Attempt}|{ack: string}): Promise<Attempt|undefined>
  post(path: 'preview'|'confirm'|'status', body: Record<string, unknown>): Promise<Record<string, unknown>>
  seal(value: Record<string, unknown>): Promise<string>
  open(ref: string): Promise<Record<string, unknown>>
  preview(value: Record<string, unknown>, requestUid: string, previewRef: string): Promise<TeamInternalGroupResult>
}
const invalid = () => new ArkmePluginError('internal-group-invalid', '内部群请求无效，请重新检查', false, 409)
const equalInput = (a: Attempt['input'], b: Attempt['input']) => a.mode === b.mode && a.team_id === b.team_id && a.name === b.name && a.chat_session_uid === b.chat_session_uid

/** One owner for App, SDK and Tool acceptance/recovery. A missing status never
 * clears an uncertain command; a fresh preview must retain its request UID. */
export class TeamInternalGroups {
  constructor(private readonly p: InternalGroupPorts) {}
  private receipt(data: Record<string, unknown>, uid: string): {state:'activating'|'ready'|'archived'|'rejected';requestUid:string} {
    if (data.state === 'rejected' && data.reason !== 'preview_stale') throw invalid()
    if (data.request_uid !== uid || !['accepted', 'ready', 'archived', 'rejected'].includes(String(data.state))) throw invalid()
    return {state: (data.state === 'accepted' ? 'activating' : data.state) as 'activating'|'ready'|'archived'|'rejected', requestUid: uid}
  }
  async recover(): Promise<TeamInternalGroupResult> {
    const attempt = await this.p.journal()
    if (!attempt) return {state: 'none'}
    const result = await this.p.post('status', {request_uid: attempt.requestUid})
    return result.state === 'not_found' ? {state: 'unresolved', requestUid: attempt.requestUid, label: attempt.label} : {...this.receipt(result, attempt.requestUid), label: attempt.label}
  }
  async prepare(input: Attempt['input'], uid: string, label: string): Promise<TeamInternalGroupResult> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(uid)) throw invalid()
    const pending = await this.p.journal()
    if (pending) {
      const result = await this.recover()
      if (result.state !== 'unresolved') return result
      if (!equalInput(pending.input, input)) return result
      uid = pending.requestUid
      label = pending.label
    }
    const data = await this.p.post('preview', input)
    if (typeof data.preview_token !== 'string' || !data.preview_token || typeof data.expires_at !== 'number') throw invalid()
    const previewRef = await this.p.seal({input, requestUid: uid, label, token: data.preview_token, expires: data.expires_at})
    return this.p.preview(data, uid, previewRef)
  }
  async prepareOriginal(): Promise<TeamInternalGroupResult> {
    const attempt = await this.p.journal()
    if (!attempt) return {state:'none'}
    return this.prepare(attempt.input, attempt.requestUid, attempt.label)
  }
  async confirm(ref: string): Promise<TeamInternalGroupResult> {
    const value = await this.p.open(ref)
    const input = value.input as Attempt['input']
    if (!input || !['create','link'].includes(input.mode) || typeof value.requestUid !== 'string' || typeof value.token !== 'string') throw invalid()
    const attempt = {requestUid: value.requestUid, input, label: String(value.label ?? '')}
    await this.p.journal({put: attempt}) // durable before any write leaves the Host
    try {
      return this.receipt(await this.p.post('confirm', {request_uid: attempt.requestUid, preview_token: value.token}), attempt.requestUid)
    } catch (error) {
      // The durable identity remains even on an expired/stale preview. Recovery
      // can find a concurrent acceptance; renewing keeps the exact same UID.
      const recovered = await this.recover().catch(() => undefined)
      if (recovered && recovered.state !== 'unresolved') return recovered
      throw error
    }
  }
  async ack(uid: string): Promise<TeamInternalGroupResult> {
    const result = await this.recover()
    if ((result.state !== 'ready' && result.state !== 'archived' && result.state !== 'rejected') || result.requestUid !== uid) throw invalid()
    await this.p.journal({ack: uid})
    return {state: 'acknowledged'}
  }
}
