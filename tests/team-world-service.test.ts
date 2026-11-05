import { expect, it, vi } from 'vitest'
import { TeamWorldService } from '../src/services/team-world-service.js'
import { ArkmeUpstreamResponseError, type ServiceRuntime } from '../src/services/service.js'
import type { TeamWorldContext, TeamWorldOriginal, TeamWorldReceipt } from '../src/team-world-contract.js'
import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'

function fixture() {
  let actor = 8
  const upstream = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/context')) return { team_id: '9223372036854775800', name: '团队', jotmo_id: 'our_team', capabilities: { publish: true, manage: true, feedback: true, reply: true } }
    if (path.endsWith('/submit')) return { content_uid: body.content_uid, revision: Number(body.expected_revision) + 1, accepted_at: 100, pending: false, result: { visibility: 'published', content_revision: 'semantic', publication_version: 1 } }
    if (path.endsWith('/list')) return { items: [{ content_uid: 'original', publication_uid: 'world-original', revision: 2, title: '标题', text: '正文', format: 'plain', source_kind: 'record', assets: [{ file_asset_uid: 'asset-private', owner_user_id: 10, upload_uid: 'upload', mime_type: 'image/png', size: 12 }], deleted: false, public_requested: true, pending: false, updated_at: 100 }], has_more: true, before_at: 100, before_uid: 'original' }
    return {}
  })
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: actor, refreshToken: 'session' }), stateStore: { uniqueCode: async () => 'world-key' }, authenticatedPost: upstream, authenticatedTeamPost: upstream } as unknown as ServiceRuntime
  const image = vi.fn(async () => new Response('png', { headers: { 'content-type': 'image/png', 'content-length': '3' } }))
  runtime.authenticatedRecordImage = image
  const source = vi.fn(async () => ({ kind: 'record', record_uid: 'source-private', version: 3 }))
  const reactionTarget = vi.fn(async (_wire: unknown) => ({ id: 'world-reaction:archive', worldRecordRef: 'exact-history' }))
  const publicPreviews = vi.fn(async (refs: {recordUID:string;ancestorUID:string}[]) => refs.map(() => undefined as import('../src/types.js').ArkmeWorldFeedItem | undefined))
  const service = new TeamWorldService(runtime, { publicPreviews, actorNames: async ids => new Map(ids.map(id => [id, "小李"])), reactionTarget, teamID: async ref => { if (ref !== 'team-ref') throw new Error('wrong-team'); return '9223372036854775800' }, teamRef: async () => 'team-ref', recordRef: async uid => `ref-${uid}`, recordUID: async () => 'public-parent', source, feed: async () => ({ items: [], total: 0, hasMore: false }) })
  return { service, upstream, source, image, reactionTarget, publicPreviews, changeAccount: () => { actor = 9 } }
}
it('reads originals with current revision and no cached authority; rejects another account before I/O', async () => {
  const f = fixture()
  const page = await f.service.execute({ action: 'originals', accountKey: 'test:8', teamRef: 'team-ref' }) as { items: TeamWorldOriginal[] }
  const ref = page.items[0]!.assets[0]!.imageRef
  await expect(f.service.readImage(ref, { cacheOnly: true })).rejects.toMatchObject({ code: 'image-cache-miss' })
  const image = await f.service.readImage(ref)
  expect(image).toMatchObject({ mediaType: 'image/png', bytes: 3 })
  expect(f.image).toHaveBeenCalledWith('/api/v1/team-world/images/read', { team_id: '9223372036854775800', content_uid: 'original', revision: 2, file_asset_uid: 'asset-private' }, { expectedUserId: 8, maxBytes: 20 << 20 })
  f.changeAccount()
  await expect(f.service.readImage(ref)).rejects.toThrow()
  expect(f.image).toHaveBeenCalledTimes(1)
})
it('keeps team IDs exact, hides source/asset routing and reuses the immutable command', async () => {
  const f = fixture(), accountKey = 'test:8'
  const context = await f.service.execute({ action: 'context', accountKey, jotmoId: 'our_team' }) as TeamWorldContext
  expect(context).toEqual({ teamRef: 'team-ref', jotmoId: 'our_team', name: '团队', capabilities: { publish: true, manage: true, feedback: true, reply: true } })
  const source = await f.service.execute({ action: 'source', accountKey, origin: { sourceRef: 'selected', itemUid: 'item' }, version: 3 }) as { sourceRef: string }
  expect(JSON.stringify(source)).not.toContain('source-private')
  const input = { action: 'submit' as const, accountKey, teamRef: context.teamRef, requestUid: 'same-command', expectedRevision: 0, change: 'publish' as const, draft: { title: '', text: '稿件', format: 'plain' as const, sourceRef: source.sourceRef, imageRefs: [] } }
  const receipt = await f.service.execute(input) as TeamWorldReceipt
  await f.service.execute(input)
  const writes = f.upstream.mock.calls.filter(([p]) => p.endsWith('/submit'))
  expect(writes).toHaveLength(2); expect(writes[0]![1]).toEqual(writes[1]![1])
  expect(writes[0]![1]).toMatchObject({ team_id: '9223372036854775800', content_uid: 'same-command', request_uid: 'same-command', draft: { source: { kind: 'record', record_uid: 'source-private', version: 3 } } })
  expect(receipt).toMatchObject({ pending: false, revision: 1, result: { visibility: 'published' } })
  expect(JSON.stringify(receipt)).not.toContain('source-private')
})
it('binds originals, image references and pagination to the account and team', async () => {
  const f = fixture(), page = await f.service.execute({ action: 'originals', accountKey: 'test:8', teamRef: 'team-ref' }) as { items: TeamWorldOriginal[]; nextCursor: string }
  expect(JSON.stringify(page)).not.toContain('asset-private')
  const item = page.items[0]!
  await f.service.execute({ action: 'submit', accountKey: 'test:8', teamRef: 'team-ref', contentRef: item.contentRef, requestUid: 'edit', expectedRevision: 2, change: 'edit', draft: { title: item.title, text: '修改', format: 'plain', imageRefs: item.assets.map(a => a.imageRef) } })
  expect(f.upstream.mock.lastCall?.[1]).toMatchObject({ team_id: '9223372036854775800', content_uid: 'original', draft: { assets: [{ file_asset_uid: 'asset-private', owner_user_id: 10, upload_uid: 'upload' }] } })
  await expect(f.service.execute({ action: 'originals', accountKey: 'test:8', teamRef: 'team-ref', deleted: true, cursor: page.nextCursor })).rejects.toThrow()
  const count = f.upstream.mock.calls.length
  f.changeAccount()
  await expect(f.service.execute({ action: 'original', accountKey: 'test:9', contentRef: item.contentRef })).rejects.toThrow()
  await expect(f.service.execute({ action: 'context', accountKey: 'test:8', jotmoId: 'our_team' })).rejects.toThrow()
  expect(f.upstream.mock.calls).toHaveLength(count)
})
it('does not turn a pending application into a published result', async () => {
  const f = fixture()
  f.upstream.mockResolvedValue({ content_uid: 'original', revision: 3, accepted_at: 100, pending: true } as never)
  const result = await f.service.execute({ action: 'submit', accountKey: 'test:8', teamRef: 'team-ref', requestUid: 'original', expectedRevision: 0, change: 'publish' })
  expect(result).toMatchObject({ pending: true }); expect(result).not.toHaveProperty('result')
})
it('SDK and Tools use the same capability/owner and separate writes from reads', async () => {
  const calls: unknown[] = []; let supported = true
  const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body)
    return new Response(JSON.stringify({ ok: true, value: body.operation === 'provider.capabilities' ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { teamWorldV1: supported } } : { pending: true } }), { headers: { 'content-type': 'application/json' } })
  } })
  const input = { action: 'status' as const, accountKey: 'test:8', requestUid: 'same-command' }
  await sdk.teamWorld(input); expect(calls).toContainEqual({ operation: 'team.world', params: input })
  supported = false; await expect(sdk.teamWorld(input)).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
  const ports = { teamWorld: vi.fn(async () => ({})) }, tools = createArkmeCoreToolDefinitions(ports as never), exec = { signal: new AbortController().signal } as never
  const read = tools.find(t => t.name === 'arkme_team_world_read')!, write = tools.find(t => t.name === 'arkme_team_world_write')!
  await read.execute({ request_json: JSON.stringify(input) }, exec)
  await expect(read.execute({ request_json: JSON.stringify({ ...input, action: 'submit' }) }, exec)).rejects.toThrow()
  await expect(write.execute({ request_json: JSON.stringify(input) }, exec)).rejects.toThrow()
  expect(ports.teamWorld).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
  const scoped = {action:'activity' as const,accountKey:'test:8',teamRef:'team-ref',limit:20}
  supported=true
  await sdk.teamWorld(scoped)
  await read.execute({request_json:JSON.stringify(scoped)},exec)
  expect(calls).toContainEqual({operation:'team.world',params:scoped})
  expect(ports.teamWorld).toHaveBeenLastCalledWith(scoped,expect.any(AbortSignal))
})

it('binds feedback archives to their historical revision and rechecks current original authority', async () => {
  const f = fixture()
  f.upstream.mockImplementation(async (path, body) => {
    if (path.endsWith('/feedback/query')) return { items: [{ id: 'feedback', sequence: 1, content_uid: 'original', kind: 'comment', actor_user_id: 9, at: 100, event_uid: 'comment', context_uid: 'context', content_revision: 'historical' }], has_more: false, after_sequence: 1, seen_through: 1, offered_through: 1 } as never
    if (path.endsWith('/previews')) return { items: (body.items as object[]).map(item => ({ ...item, readable: true, publication_uid: 'public-parent', text: 'current body', team_name: '团队' })) } as never
    if (path.endsWith('/get')) return { content_uid: 'original', publication_uid: 'world-original', revision: 3, title: 'current', text: 'new body', format: 'plain', source_kind: 'record', assets: [], deleted: false, public_requested: false, pending: false, updated_at: 200 } as never
    throw new Error('unexpected')
  })
  const page = await f.service.execute({ action: 'feedback', accountKey: 'test:8', teamRef: 'team-ref' }) as { items: { eventRef: string }[] }
  const request = { action: 'feedback-target' as const, accountKey: 'test:8', eventRef: page.items[0]!.eventRef }
  const result = await f.service.execute(request)
  expect(result).toMatchObject({ original: { text: 'new body', revision: 3 }, commentRef: 'ref-comment' })
  expect(f.reactionTarget).toHaveBeenCalledExactlyOnceWith({ record_uid: 'public-parent', world_context_uid: 'context', content_revision: 'historical' })
  f.upstream.mockRejectedValueOnce(new Error('permission removed'))
  await expect(f.service.execute(request)).rejects.toThrow('permission removed')
  expect(f.reactionTarget).toHaveBeenCalledTimes(1)
  f.changeAccount()
  await expect(f.service.execute({ ...request, accountKey: 'test:9' })).rejects.toThrow()
  expect(f.reactionTarget).toHaveBeenCalledTimes(1)
})

// Upstream business denials must not invite retries or masquerade as outages.
it('does not invite retries for a conflicting command', async () => {
  const f = fixture()
  f.upstream.mockRejectedValueOnce(new ArkmeUpstreamResponseError('arkme-code-40001', 'team_world_content_conflict', true, 502, null))
  await expect(f.service.execute({ action: 'originals', accountKey: 'test:8', teamRef: 'team-ref' }))
    .rejects.toMatchObject({ code: 'team-world-content-conflict', retryable: false, httpStatus: 409 })
})
it.each(['record', 'team'] as const)('maps %s authorization denial to a stable non-retryable permission error', async source => {
  const f = fixture()
  f.upstream.mockRejectedValueOnce(source === 'record'
    ? new ArkmeUpstreamResponseError('arkme-code-40001', 'team_world_not_accessible', true, 502, null)
    : new ArkmeUpstreamResponseError('arkme-code-1001', '参数错误', true, 502, { reason: 'not_accessible' }))
  await expect(f.service.execute(source === 'record'
    ? { action: 'originals', accountKey: 'test:8', teamRef: 'team-ref' }
    : { action: 'feedback', accountKey: 'test:8', teamRef: 'team-ref' }))
    .rejects.toMatchObject({ code: 'team-world-not-accessible', retryable: false, httpStatus: 403 })
})
it('retains transient upstream failures and protects original image permission errors', async () => {
  const f = fixture(), failure = new ArkmeUpstreamResponseError('arkme-http-error', 'upstream unavailable', true, 503, {})
  f.upstream.mockRejectedValueOnce(failure)
  await expect(f.service.execute({ action: 'originals', accountKey: 'test:8', teamRef: 'team-ref' })).rejects.toBe(failure)
  const page = await f.service.execute({ action: 'originals', accountKey: 'test:8', teamRef: 'team-ref' }) as { items: TeamWorldOriginal[] }
  f.image.mockRejectedValueOnce(new ArkmeUpstreamResponseError('arkme-code-40001', 'team_world_not_accessible', true, 502, null))
  await expect(f.service.readImage(page.items[0]!.assets[0]!.imageRef)).rejects.toMatchObject({ code: 'team-world-not-accessible', retryable: false, httpStatus: 403 })
})

it('batches previews and shows exact add/remove events; never substitutes current state for the event', async () => {
  const f = fixture(), team = '9223372036854775800'
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `feedback-${i}`, sequence: i+1, content_uid: 'original', kind: 'reaction', actor_user_id: 9, at: 100+i, event_uid: `event-${i}`, context_uid: 'context', content_revision: 'historical' }))
  f.upstream.mockImplementation(async (path, body) => {
    if (path.endsWith('/feedback/query')) return { items, has_more: false, after_sequence: 20, seen_through: 0, offered_through: 20 } as never
    if (path.endsWith('/previews')) return { items: (body.items as Record<string, unknown>[]).map((item, i) => ({ ...item, readable: true, publication_uid:'world-original', team_name: '团队', title: '', text: '当前原稿', reaction: { event_uid: item.event_uid, actor_user_id: 9, at: 100+i, context_uid:'context', content_revision:'historical', active:i%2===0, expression:{text:'收到'} } })) } as never
    throw Error('unexpected')
  })
  const page = await f.service.execute({ action: 'feedback', accountKey: 'test:8', teamRef: 'team-ref' }) as { items: import('../src/team-world-contract.js').TeamWorldFeedback[] }
  expect(page.items[0]).toMatchObject({ actorName:'小李', reaction:{active:true,expression:{text:'收到'}}, preview:{text:'当前原稿'} })
  expect(page.items[1]?.reaction?.active).toBe(false)
  expect(page.items[0]?.contentKey).toBe(page.items[1]?.contentKey)
  expect(f.publicPreviews).toHaveBeenCalledWith([{recordUID:'world-original',ancestorUID:''}], undefined)
  expect(f.upstream.mock.calls).toHaveLength(2)
  expect(f.upstream.mock.lastCall?.[1]).toEqual({ items: items.map(r => ({team_id:team, content_uid:r.content_uid, event_uid:r.event_uid})) })
  expect(JSON.stringify(page)).not.toContain('event-0')
  expect(JSON.stringify(page)).not.toContain(team)
})
it('fails closed on revoked or mismatched preview and preserves activity facts without an original', async () => {
  for (const mismatch of ['revoked','event','actor','time','context','revision']) {
    const f = fixture()
    f.upstream.mockImplementation(async (path, body) => {
      if (path.endsWith('/feedback/query')) return { items:[{ id:'f',sequence:1,content_uid:'original',kind:'reaction',actor_user_id:9,at:100,event_uid:'event',context_uid:'context',content_revision:'old' }],has_more:false,after_sequence:1,seen_through:0,offered_through:1 } as never
      if (path.endsWith('/previews')) return { items:(body.items as object[]).map(item => ({ ...item,readable:mismatch!=='revoked',publication_uid:'world-original',text:'protected',reaction:{event_uid:mismatch==='event'?'wrong':'event',actor_user_id:mismatch==='actor'?10:9,at:mismatch==='time'?101:100,context_uid:mismatch==='context'?'wrong':'context',content_revision:mismatch==='revision'?'wrong':'old',active:false,expression:{text:'收到'}} })) } as never
      throw Error('unexpected')
    })
    await expect(f.service.execute({action:'feedback',accountKey:'test:8',teamRef:'team-ref'})).rejects.toThrow()
  }
  const f = fixture()
  f.upstream.mockImplementation(async (path, body) => {
    if (path.endsWith('/activity/query')) return {items:[{team_id:7,content_uid:'original',publication_uid:'public-original',request_uid:'command',action:'unpublish',revision:2,accepted_at:100,pending:false}],has_more:false} as never
    if (path.endsWith('/previews')) return {items:(body.items as object[]).map(item=>({...item,readable:false,text:'MUST NOT COPY'}))} as never
    throw Error('unexpected')
  })
  const page = await f.service.execute({action:'activity',accountKey:'test:8'})
  expect(page).toMatchObject({items:[{action:'unpublish',acceptedAt:100}]})
  expect(JSON.stringify(page)).not.toContain('MUST NOT COPY')
  expect(JSON.stringify(page)).not.toContain('preview')
})
it('keeps authorized comment content and original media as distinct projections',async()=>{
 const f=fixture()
 f.upstream.mockImplementation(async(path,body)=>{
  if(path.endsWith('/feedback/query'))return {items:[{id:'f',sequence:1,content_uid:'original',kind:'comment',actor_user_id:9,at:100,event_uid:'reply',context_uid:'context',content_revision:'revision'}],has_more:false,after_sequence:1,seen_through:0,offered_through:1} as never
  if(path.endsWith('/previews'))return {items:(body.items as object[]).map(item=>({...item,readable:true,publication_uid:'published-root',revision:2,text:'原稿',image_count:1,image_uids:['private-asset']}))} as never
  throw Error('unexpected')
 })
 f.publicPreviews.mockResolvedValueOnce([{recordRef:'public-comment',textContent:'评论正文',imageRefs:['public-comment-image']} as never])
 const page=await f.service.execute({action:'feedback',accountKey:'test:8',teamRef:'team-ref'}) as {items: import('../src/team-world-contract.js').TeamWorldFeedback[]}
 expect(f.publicPreviews).toHaveBeenCalledWith([{recordUID:'reply',ancestorUID:'published-root'}],undefined)
 expect(page.items[0]).toMatchObject({comment:{textContent:'评论正文',imageRefs:['public-comment-image']},preview:{text:'原稿',imageRefs:[expect.any(String)]}})
 expect(JSON.stringify(page)).not.toContain('private-asset')
 const imageRef=page.items[0]!.preview.imageRefs![0]!
 await f.service.readImage(imageRef)
 expect(f.image.mock.calls[0]?.[1]).toEqual({team_id:'9223372036854775800',content_uid:'original',revision:2,file_asset_uid:'private-asset'})
 const denied=await f.service.execute({action:'feedback',accountKey:'test:8',teamRef:'team-ref'}) as typeof page
 expect(denied.items[0]?.comment).toBeUndefined();expect(denied.items[0]?.preview.text).toBe('原稿')
})

it('shares opaque original references only within each authorized feedback page', async () => {
  const f = fixture()
  f.upstream.mockImplementation(async (path, body) => {
    if (path.endsWith('/feedback/query')) return { items: ['original-a', 'original-b', 'original-a'].map((content_uid, i) => ({ id: `event-${i}`, sequence: i + 1, content_uid, kind: 'comment', actor_user_id: 9, at: 100, event_uid: `comment-${i}`, context_uid: 'context', content_revision: 'revision' })), has_more: true, after_sequence: 3, offered_through: 3, seen_through: 0 } as never
    if (path.endsWith('/previews')) return { items: (body.items as object[]).map(item => ({ ...item, readable: true, publication_uid: 'public-parent', title: 'identical titles', text: 'identical bodies', team_name: 'team' })) } as never
    throw Error('unexpected')
  })
  const read = () => f.service.execute({ action: 'feedback', accountKey: 'test:8', teamRef: 'team-ref', limit: 20 }) as Promise<{items: import('../src/team-world-contract.js').TeamWorldFeedback[]; afterSequence: number; offeredThrough: number}>
  const a = await read(), b = await read()
  expect(a.items[0]!.contentRef).toBe(a.items[2]!.contentRef)
  expect(a.items[0]!.contentRef).not.toBe(a.items[1]!.contentRef)
  expect(b.items[0]!.contentRef).toBe(b.items[2]!.contentRef)
  expect(b.items[0]!.contentRef).not.toBe(a.items[0]!.contentRef)
  expect(a).toMatchObject({afterSequence:3,offeredThrough:3})
  expect(JSON.stringify(a)).not.toContain('original-a')
  expect(f.upstream.mock.calls.filter(([p])=>p.endsWith('/previews'))).toHaveLength(2)
  f.changeAccount()
  const calls=f.upstream.mock.calls.length
  await expect(f.service.execute({action:'original',accountKey:'test:9',contentRef:a.items[0]!.contentRef})).rejects.toThrow()
  expect(f.upstream.mock.calls).toHaveLength(calls)
})

it('filters activity on the server and binds pagination to the team while batching authorized public previews', async () => {
  const f = fixture(), team = '9223372036854775800'
  const row = {team_id:team,content_uid:'original',publication_uid:'public-root',request_uid:'command',action:'publish',revision:1,accepted_at:100,pending:false}
  f.upstream.mockImplementation(async (path, body) => {
    if (path.endsWith('/activity/query')) return {items:[row],has_more:true,before_at:100,before_id:'command-id'} as never
    if (path.endsWith('/previews')) return {items:(body.items as object[]).map(item=>({...item,readable:false}))} as never
    throw Error('unexpected')
  })
  f.publicPreviews.mockResolvedValue([{recordRef:'public-ref',textContent:'公开内容'} as never])
  const page = await f.service.execute({action:'activity',accountKey:'test:8',teamRef:'team-ref',limit:20}) as {nextCursor:string;items:unknown[]}
  expect(f.upstream.mock.calls[0]?.[1]).toEqual({team_id:team,before_at:0,before_id:'',limit:20})
  expect(f.publicPreviews).toHaveBeenCalledWith([{recordUID:'public-root',ancestorUID:''}],undefined)
  expect(page.items[0]).toMatchObject({recordRef:'ref-public-root',publication:{textContent:'公开内容'}})
  const calls = f.upstream.mock.calls.length
  await expect(f.service.execute({action:'activity',accountKey:'test:8',cursor:page.nextCursor})).rejects.toThrow()
  expect(f.upstream.mock.calls).toHaveLength(calls)
  await expect(f.service.execute({action:'activity',accountKey:'test:8',teamRef:'team-ref',cursor:page.nextCursor})).rejects.toThrow() // Nonadvancing response.
  row.team_id='7'
  await expect(f.service.execute({action:'activity',accountKey:'test:8',teamRef:'team-ref'})).rejects.toThrow()
})
