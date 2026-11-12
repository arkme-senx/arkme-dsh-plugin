import { createHash, createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue, type ServiceRuntime } from './service.js'
import type { PersonFacet, PeopleIdentityPreview, PeopleIdentityLink, PeopleIdentityImpact, PeopleIdentityProvenance } from '../people-contract.js'

type Identity = { namespace: string; id: string }
type Link = { provenance?: unknown; revision?: number; identity: Identity; person_id: string; state: string; person_revision?: number; excluded_person_ids?: string[] }
const unavailable = () => new ArkmePluginError('people-identity-unavailable', '人物身份已变化，请重新读取并预览', true, 409)
const oid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v) && !/^0+$/.test(v)

function provenance(link: Link, viewer: number): PeopleIdentityProvenance {
 const p=objectValue(link.provenance), identity=objectValue(p.identity)
 if(p.kind!=='user_decision' || identity.namespace!==link.identity.namespace || identity.id!==link.identity.id || !Number.isSafeInteger(link.revision) || p.revision!==link.revision || !Number.isSafeInteger(p.confirmed_at) || Number(p.confirmed_at)<=0 || p.confirmed_by!==viewer || typeof p.operation_id!=='string' || !/^[a-f0-9]{64}$/.test(p.operation_id) || !['link','unlink','merge','split','undo','materialize'].includes(String(p.action))) return {kind:'unknown'}
 return {kind:'user_decision',action:String(p.action),confirmedAt:Number(p.confirmed_at),confirmedBySelf:true}
}
const conflictMessages:Record<string,string>={
 identity_already_linked:'此身份已关联其他人物，本次未保存。', explicitly_excluded:'此前已明确拆开这些身份，本次未保存。',
 identity_changed:'人物身份已变化，请重新读取并预览。',preview_expired:'预览已过期，请重新预览。',source_changed:'来源资料已变化，请重新读取并预览。',idempotency_mismatch:'操作编号对应的请求内容不一致，请核对原操作结果。'
}

export class PeopleIdentityService {
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime, private readonly speakerRef?: (id: string, owner: number) => Promise<string>) { this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), unavailable) }
  private async identityKey(identity: Identity) {
    const session = await this.runtime.requireSession()
    return createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(JSON.stringify([this.runtime.config.environment, session.userId, identity])).digest('hex')
  }
  private async seal(value: Record<string, unknown>) {
    const session = await this.runtime.requireSession()
    return this.codec.seal('arkme-person-identity-v1', { ...value, viewer: session.userId, environment: this.runtime.config.environment, expires: Date.now() + 30 * 60_000 })
  }
  private async open(value: unknown) {
    if (typeof value !== 'string') throw unavailable()
    const session = await this.runtime.requireSession(), ref = await this.codec.open('arkme-person-identity-v1', value)
    if (ref.viewer !== session.userId || ref.environment !== this.runtime.config.environment || Number(ref.expires) < Date.now()) throw unavailable()
    return ref
  }
  private async post<T>(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const session = await this.runtime.requireSession()
    let result: T
    try {
      result = await this.runtime.authenticatedRelationPost<T>(`/api/v1/entity/identities/${action}`, body, session, signal, { bypassCache: true, cacheMs: 0, ...(action === 'apply' ? { lane: 'write' as const } : {}) })
    } catch (error) {
      if(error instanceof ArkmeUpstreamResponseError && error.upstreamStatus===409) {
        const reason=objectValue(error.responseData).reason
        const text=typeof reason==='string'?conflictMessages[reason]:undefined
        if(text) throw new ArkmePluginError(action==='apply'?'people-identity-rejected':'people-identity-conflict',text,false,409)
      }
      // Runtime transports owner HTTP failures as 502 with upstreamStatus.
      // Only definite apply rejections permit a new command; result 404 does
      // not prove a concurrently executing write failed.
      if (action === 'apply' && error instanceof ArkmePluginError &&
        ([400, 403, 404, 409, 422].includes(error.upstreamStatus ?? error.httpStatus) || error.code === 'arkme-code-1001')) {
        throw new ArkmePluginError('people-identity-rejected', error.message, false, 409, { cause: error })
      }
      throw error
    }
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return result
  }
  async decorate(facet: PersonFacet, identity: Identity, stableKey: (id: string) => string, signal?: AbortSignal, directoryLink?: Link): Promise<PersonFacet> {
    // Historic staged entities remain readable, but are not eligible for identity writes.
    let link: Link
    try { link = directoryLink ?? await this.post<Link>('resolve', { identity }, signal) }
    catch (e) { if (e instanceof ArkmePluginError && (e.upstreamStatus ?? e.httpStatus) === 404) return facet; throw e }
    const personId = link.state === 'active' ? link.person_id : identity.namespace === 'relation_entity' ? identity.id : undefined
    const identityRef = await this.seal({ identity, label: facet.name }), identityKey = await this.identityKey(identity)
    if (!personId || !oid(personId)) return { ...facet, identityRef, identityKey, ...(link.excluded_person_ids?.length ? { personKey: facet.key } : {}) }
    const links = directoryLink ? [] : identity.namespace === 'relation_entity' && link.state !== 'active' ? await this.post<Link[]>('list', { person_id: personId }, signal) : undefined
    return { ...facet, identityRef, identityKey, personIdentityKey: stableKey(personId), identityRevision: link.person_revision ?? 0, personRef: await this.seal({ person_id: personId }),
      ...((link.state === 'active' || links?.length || directoryLink && identity.namespace === 'relation_entity') ? { personKey: stableKey(personId), ...(facet.source === 'relations' && facet.accountLinked ? { legacyPersonKey: facet.personKey } : {}) } : {}) }
  }
  async execute(action: unknown, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (action === 'capabilities') {
      let raw: Record<string,unknown>
      try { raw=await this.post<Record<string,unknown>>('capabilities',{},signal) }
      catch(e) { if(e instanceof ArkmePluginError && [404,501].includes(e.upstreamStatus??e.httpStatus))return {supported:false};throw e }
      if(raw.supported===false)return {supported:false}
      const mapping={link:'explicit_link',unlink:'unlink',merge:'merge',split:'split',undo:'undo',materialize:'stable_source_person',recordingBinding:'recording_binding'}
      if(raw.schema_version!==1 || Object.values(mapping).some(k=>typeof raw[k]!=='boolean'))throw unavailable()
      return {supported:true,...Object.fromEntries(Object.entries(mapping).map(([k,v])=>[k,raw[v]]))}
    }
    if (action === 'impact') {
      const ref = await this.open(params.commandRef), body = objectValue(ref.command)
      if (!body.preview_token) throw unavailable()
      let cursor: string | undefined
      if (params.cursor) {
        const c = await this.open(params.cursor)
        if (c.commandHash !== createHash('sha256').update(JSON.stringify(body)).digest('hex') || typeof c.cursor !== 'string') throw unavailable()
        cursor = c.cursor
      }
      const result = await this.post<Record<string, unknown>>('impact', { command: body, ...(cursor ? { cursor } : {}) }, signal)
      if (!['pending', 'complete'].includes(String(result.state)) || ![result.identity_count, result.relation_record_count, result.unavailable_record_count].every(v => Number.isSafeInteger(v) && Number(v) >= 0) || !Array.isArray(result.names) || result.state === 'pending' && !result.next_cursor) throw unavailable()
      const display = objectValue(result.display_change)
      if (!Array.isArray(display.before) || !Array.isArray(display.after) || ![...display.before,...display.after].every(v => typeof v === 'string')) throw unavailable()
      const nextCursor = result.next_cursor ? await this.seal({ commandHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), cursor: result.next_cursor }) : undefined
      return { recordSources: result.record_sources, state: result.state, identityCount: result.identity_count, relationRecordCount: result.relation_record_count, unavailableRecordCount: result.unavailable_record_count,
        displayChange: { before: display.before as string[], after: display.after as string[] }, names: result.names.map(v => { const r = objectValue(v); if (typeof r.name !== 'string' || typeof r.target !== 'boolean') throw unavailable(); return {name:r.name, target:r.target} }), ...(nextCursor ? { nextCursor } : {}) } as PeopleIdentityImpact
    }
    if (action === 'binding-preview') {
      const person = await this.open(params.personRef)
      if (!oid(person.person_id)) throw unavailable()
      const result = await this.post<{ state: string; preview_token: string }>('recording-binding/preview', { person_id: person.person_id }, signal)
      if (!['reuse', 'create_required'].includes(result.state) || !result.preview_token) throw unavailable()
      return { state: result.state, commandRef: await this.seal({ binding: { person_id: person.person_id, preview_token: result.preview_token } }) }
    }
    if (action === 'binding-apply') {
      const ref = await this.open(params.commandRef), body = objectValue(ref.binding)
      if (!oid(body.person_id) || !body.preview_token || !this.speakerRef) throw unavailable()
      const result = await this.post<{ state: string; speaker_id: string }>('recording-binding/apply', body, signal)
      if (result.state !== 'ready' || !oid(result.speaker_id)) throw unavailable()
      const session = await this.runtime.requireSession()
      return { speakerRef: await this.speakerRef(result.speaker_id, session.userId) }
    }
    if (action === 'apply') {
      const ref = await this.open(params.commandRef), body = objectValue(ref.command)
      if (!body.preview_token) throw unavailable()
      const result = await this.post<Record<string, unknown>>('apply', body, signal)
      return { operationRef: await this.seal({ operation_id: result.operation_id }), state: result.state }
    }
    if (action === 'result') {
      const ref = await this.open(params.operationRef ?? params.commandRef)
      const session = await this.runtime.requireSession()
      const operationId = ref.operation_id ?? createHash('sha256').update(JSON.stringify([session.userId, objectValue(ref.command).idempotency_key])).digest('hex')
      const result = await this.post<Record<string, unknown>>('result', { operation_id: operationId }, signal)
      return { operationRef: await this.seal({ operation_id: result.operation_id }), state: result.state }
    }
    const person = params.personRef ? await this.open(params.personRef) : undefined
    if (person && !oid(person.person_id)) throw unavailable()
    if (action === 'list') {
      if (!person) throw unavailable()
      const result = await this.post<{ links: Link[]; recent_operation?: { operation_id: string } }>('list', { person_id: person.person_id, include_operations: true }, signal)
      const viewer = (await this.runtime.requireSession()).userId
      const links = await Promise.all(result.links.map(async (link): Promise<PeopleIdentityLink> => ({ provenance: provenance(link, viewer), identityKey: await this.identityKey(link.identity), identityRef: await this.seal({ identity: link.identity }), namespace: link.identity.namespace, ...(link.identity.namespace === 'relation_entity' ? { splitRef: await this.seal({ person_id: link.identity.id }) } : {}) })))
      return { links, ...(result.recent_operation ? { operationRef: await this.seal({ operation_id: result.recent_operation.operation_id }) } : {}) }
    }
    if (action !== 'preview' || !['link', 'unlink', 'merge', 'split', 'materialize', 'undo'].includes(String(params.kind))) throw unavailable()
    if (typeof params.idempotencyKey !== 'string' || params.idempotencyKey.length < 16 || params.idempotencyKey.length > 80) throw unavailable()
    const body: Record<string, unknown> = { action: params.kind, ...(person ? { person_id: person.person_id } : {}), idempotency_key: params.idempotencyKey }
    if (params.kind === 'materialize') {
      const anchor = await this.open(params.anchorIdentityRef)
      if (!anchor.identity || typeof anchor.label !== 'string') throw unavailable()
      body.identities = [anchor.identity]; body.new_person_name = anchor.label
    } else if (!person) {
      const anchor = await this.open(params.anchorIdentityRef)
      if (!anchor.identity || !['link', 'merge'].includes(String(params.kind))) throw unavailable()
      body.action = 'link'
      if (params.otherPersonRef) {
        const other = await this.open(params.otherPersonRef)
        if (!oid(other.person_id)) throw unavailable()
        body.person_id = other.person_id; body.identities = [anchor.identity]
      } else {
        const candidate = await this.open(params.identityRef)
        if (!candidate.identity || typeof anchor.label !== 'string') throw unavailable()
        body.new_person_name = anchor.label; body.identities = [anchor.identity, candidate.identity]
      }
      body.allow_relink = true
    } else if (params.kind === 'link' || params.kind === 'unlink') {
      const identity = await this.open(params.identityRef)
      if (!identity.identity) throw unavailable()
      body.identities = [identity.identity]
      body.allow_relink = params.kind === 'link'
    } else if (params.kind === 'merge' || params.kind === 'split') {
      const other = await this.open(params.otherPersonRef)
      if (!oid(other.person_id)) throw unavailable()
      body.other_person_id = other.person_id
    } else {
      const operation = await this.open(params.operationRef)
      body.operation_id = operation.operation_id
    }
    const preview = await this.post<{ preview_token: string; changes: { before: Link; after: Link }[]; expires_at: number }>('preview', body, signal)
    if (!preview.preview_token || !Array.isArray(preview.changes)) throw unavailable()
    const changes = await Promise.all(preview.changes.map(async c => ({ identityKey: await this.identityKey(c.after.identity), namespace: c.after.identity.namespace, beforeState: c.before.state, afterState: c.after.state })))
    return { changes, commandRef: await this.seal({ command: { ...body, preview_token: preview.preview_token } }), changeCount: preview.changes.length, expiresAt: preview.expires_at } satisfies PeopleIdentityPreview
  }
}
