import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PeopleIdentityService } from '../src/services/people-identity-service.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, type ServiceRuntime } from '../src/services/service.js'
import type { PersonFacet, PeopleIdentityPreview, PeopleIdentityReceipt } from '../src/people-contract.js'
const root = '111111111111111111111111', other = '222222222222222222222222', speaker = '333333333333333333333333'
const facet: PersonFacet = { key: 'facet', personKey: 'legacy-user', name: '人物', source: 'relations', aliases: [], accountLinked: true, isSelf: false }
function fixture() {
  let userId = 11
  const post = vi.fn(async (path: string, body: Record<string, unknown>): Promise<any> => {
    if (path.endsWith('/resolve')) return { identity: body.identity, state: 'unlinked', person_id: '000000000000000000000000' }
    if (path.endsWith('/list')) return body.include_operations ? { links: [], recent_operation: { operation_id: 'a'.repeat(64) } } : []
    if (path.endsWith('/preview')) return { preview_token: 'signed-preview', changes: [{ before: { state: 'unlinked' }, after: { identity: { namespace: 'audio_speaker', id: speaker }, state: 'active' } }], expires_at: Date.now() + 600000 }
    return { operation_id: 'a'.repeat(64), state: 'committed' }
  })
  const service = new PeopleIdentityService({ stateStore: { uniqueCode: async () => 'secret' }, config: { environment: 'test' }, requireSession: async () => ({ userId, refreshToken: 'refresh' }), authenticatedRelationPost: post } as unknown as ServiceRuntime)
  const decorate = (id = root, namespace = 'relation_entity') => service.decorate(facet, { namespace, id }, id => `stable-${id}`)
  return { service, post, decorate, switchAccount: () => { userId = 22 } }
}
describe('person identity mutation boundary', () => {
  it('uses owner-resolved stable IDs for explicit links and breaks legacy grouping after explicit unlink', async () => {
    const f = fixture()
    f.post.mockResolvedValueOnce({ state: 'active', person_id: root })
    expect((await f.decorate(speaker, 'audio_speaker')).personKey).toBe(`stable-${root}`)
    f.post.mockResolvedValueOnce({ state: 'unlinked', excluded_person_ids: [root] })
    expect((await f.decorate(speaker, 'audio_speaker')).personKey).toBe('facet')
    f.post.mockResolvedValueOnce({ state: 'unlinked' }).mockResolvedValueOnce([{ state: 'active' }])
    expect((await f.decorate()).personKey).toBe(`stable-${root}`)
  })
  it('requires signed references and preview before apply; sends exact preview body on retry', async () => {
    const f = fixture(), person = await f.decorate(), identity = await f.decorate(speaker, 'audio_speaker')
    await expect(f.service.execute('preview', { personRef: 'legacy-user' })).rejects.toThrow()
    const preview = await f.service.execute('preview', { kind: 'link', personRef: person.personRef, identityRef: identity.identityRef, idempotencyKey: 'client-key-123456789' }) as PeopleIdentityPreview
    expect(preview.changeCount).toBe(1)
    const receipt = await f.service.execute('apply', { commandRef: preview.commandRef }) as PeopleIdentityReceipt
    await f.service.execute('apply', { commandRef: preview.commandRef })
    const bodies = f.post.mock.calls.filter(c => c[0].endsWith('/apply')).map(c => c[1])
    expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0]).toMatchObject({ person_id: root, identities: [{ namespace: 'audio_speaker', id: speaker }], preview_token: 'signed-preview' })
    expect(receipt.operationRef).not.toContain('a'.repeat(64))
    await expect(f.service.execute('apply', { commandRef: person.personRef })).rejects.toThrow()
    f.switchAccount()
    await expect(f.service.execute('apply', { commandRef: preview.commandRef })).rejects.toThrow()
  })
  it('previews unlink, merge and undo with canonical references and recovers an uncertain apply by deterministic result ID', async () => {
    const f = fixture(), person = await f.decorate(), source = await f.decorate(speaker, 'audio_speaker'), target = await f.decorate(other)
    const base = { personRef: person.personRef, idempotencyKey: 'client-key-123456789' }
    await f.service.execute('preview', { ...base, kind: 'unlink', identityRef: source.identityRef })
    const preview = await f.service.execute('preview', { ...base, kind: 'merge', otherPersonRef: target.personRef }) as PeopleIdentityPreview
    expect(f.post.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'merge', person_id: root, other_person_id: other })
    const receipt = await f.service.execute('result', { commandRef: preview.commandRef }) as PeopleIdentityReceipt
    expect(f.post.mock.calls.at(-1)?.[1]).toEqual({ operation_id: createHash('sha256').update(JSON.stringify([11, base.idempotencyKey])).digest('hex') })
    await f.service.execute('preview', { ...base, kind: 'undo', operationRef: receipt.operationRef })
    expect(f.post.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'undo', operation_id: 'a'.repeat(64) })
  })
  it('creates a root only in confirmed first-link apply and restores server-held undo after a fresh list', async () => {
    const f = fixture(), anchor = await f.decorate(speaker, 'audio_speaker'), contact = await f.decorate('27', 'arkme_user')
    const preview = await f.service.execute('preview', { kind: 'link', anchorIdentityRef: anchor.identityRef, identityRef: contact.identityRef, idempotencyKey: 'first-person-link-12345' }) as PeopleIdentityPreview
    const body = f.post.mock.calls.at(-1)![1]
    expect(body).toMatchObject({ action: 'link', new_person_name: '人物', identities: [{ namespace: 'audio_speaker', id: speaker }, { namespace: 'arkme_user', id: '27' }] })
    expect(body).not.toHaveProperty('person_id')
    expect(f.post.mock.calls.some(c => c[0].endsWith('/apply'))).toBe(false)
    await f.service.execute('apply', { commandRef: preview.commandRef })
    const person = await f.decorate()
    const list = await f.service.execute('list', { personRef: person.personRef }) as { operationRef: string }
    expect(list.operationRef).toBeTruthy()
    await f.service.execute('preview', { kind: 'undo', personRef: person.personRef, operationRef: list.operationRef, idempotencyKey: 'undo-after-restart-123' })
    expect(f.post.mock.calls.at(-1)?.[1]).toMatchObject({ operation_id: 'a'.repeat(64) })
  })
  it('distinguishes definite owner rejection from unknown result lookup and network failures', async () => {
    const f = fixture(), person = await f.decorate(), identity = await f.decorate(speaker, 'audio_speaker')
    const preview = await f.service.execute('preview', { kind: 'link', personRef: person.personRef, identityRef: identity.identityRef, idempotencyKey: 'client-key-123456789' }) as PeopleIdentityPreview
    for (const upstreamStatus of [400, 403, 404, 409, 422]) {
      f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-http-error', 'rejected', false, 502, { upstreamStatus }))
      await expect(f.service.execute('apply', { commandRef: preview.commandRef })).rejects.toMatchObject({ code: 'people-identity-rejected' })
    }
    f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-http-error', 'missing', false, 502, { upstreamStatus: 404 }))
    await expect(f.service.execute('result', { commandRef: preview.commandRef })).rejects.toMatchObject({ code: 'arkme-http-error' })
    f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-network-error', 'unknown', true, 502))
    await expect(f.service.execute('apply', { commandRef: preview.commandRef })).rejects.toMatchObject({ code: 'arkme-network-error' })
    f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-http-error', 'staged', false, 502, { upstreamStatus: 404 }))
    expect(await f.decorate()).toEqual(facet)
  })
  it('keeps staged history readable on owner 404 but surfaces outage and cross-account response races', async () => {
    const f = fixture()
    f.post.mockRejectedValueOnce(new ArkmePluginError('missing', 'missing', false, 404))
    expect(await f.decorate()).toEqual(facet)
    f.post.mockRejectedValueOnce(new ArkmePluginError('busy', 'busy', true, 503))
    await expect(f.decorate()).rejects.toThrow('busy')
    f.post.mockImplementationOnce(async () => { f.switchAccount(); return { state: 'unlinked' } })
    await expect(f.decorate()).rejects.toThrow()
  })
})

it('materializes one explicit source and exposes entity split without guessing history', async () => {
  const f = fixture(), source = await f.decorate(speaker, 'audio_speaker')
  await f.service.execute('preview', { kind: 'materialize', anchorIdentityRef: source.identityRef, idempotencyKey: 'stable-single-source-01' })
  expect(f.post.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'materialize', new_person_name: '人物', identities: [{ namespace: 'audio_speaker', id: speaker }] })
  const person = await f.decorate()
  f.post.mockResolvedValueOnce({ links: [{ identity: { namespace: 'relation_entity', id: other }, state: 'active', person_id: root }] })
  const result = await f.service.execute('list', { personRef: person.personRef }) as { links: Array<{ splitRef: string }> }
  await f.service.execute('preview', { kind: 'split', personRef: person.personRef, otherPersonRef: result.links[0]!.splitRef, idempotencyKey: 'split-existing-child-01' })
  expect(f.post.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'split', person_id: root, other_person_id: other })
  expect(f.post.mock.calls.at(-1)?.[1]).not.toHaveProperty('operation_id')
})
it('reads independent identity capabilities and distinguishes unsupported from transport failures',async()=>{
 const f=fixture()
 f.post.mockResolvedValueOnce({schema_version:1,explicit_link:true,unlink:false,merge:true,split:true,undo:true,stable_source_person:true,recording_binding:true})
 await expect(f.service.execute('capabilities',{})).resolves.toMatchObject({supported:true,link:true,unlink:false,merge:true,recordingBinding:true})
 f.post.mockRejectedValueOnce(new ArkmePluginError('upstream','missing',false,502,{upstreamStatus:404}))
 await expect(f.service.execute('capabilities',{})).resolves.toEqual({supported:false})
 f.post.mockRejectedValueOnce(new Error('timeout'))
 await expect(f.service.execute('capabilities',{})).rejects.toThrow('timeout')
})

it('only exposes provenance matching the current identity, revision and viewer', async()=>{
 const f=fixture(), person=await f.decorate()
 const identity={namespace:'audio_speaker',id:speaker}
 const proof={kind:'user_decision',identity,revision:3,confirmed_by:11,confirmed_at:1794391200000,operation_id:'a'.repeat(64),action:'link'}
 for(const [overrides,expected] of [[{},'user_decision'],[{revision:2},'unknown'],[{confirmed_by:22},'unknown'],[{identity:{namespace:'audio_speaker',id:other}},'unknown'],[{operation_id:'bad'},'unknown']] as const){
  f.post.mockResolvedValueOnce({links:[{identity,state:'active',revision:3,provenance:{...proof,...overrides}}]})
  const value=await f.service.execute('list',{personRef:person.personRef}) as any
  expect(value.links[0].provenance.kind).toBe(expected)
  expect(JSON.stringify(value.links[0].provenance)).not.toContain('confirmed_by')
 }
})
it('maps only known owner conflict reasons without exposing upstream details',async()=>{
 const f=fixture(),person=await f.decorate(),target=await f.decorate(other)
 f.post.mockRejectedValueOnce(new ArkmeUpstreamResponseError('arkme-code-409','private upstream body',false,409,{reason:'explicitly_excluded',secret:'never expose'},{upstreamStatus:409}))
 await expect(f.service.execute('preview',{kind:'merge',personRef:person.personRef,otherPersonRef:target.personRef,idempotencyKey:'conflict-test-12345678'})).rejects.toMatchObject({code:'people-identity-conflict',message:'此前已明确拆开这些身份，本次未保存。'})
})
