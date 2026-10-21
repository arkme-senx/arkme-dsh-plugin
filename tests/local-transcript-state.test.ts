import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { changeLocalTranscript } from '../src/local-transcript-state.js'
import { quoteSourceContent } from '../src/message-quote.js'

it('persists a local replacement across reopening, isolates account/environment/call, rejects concurrent overwrite and restores original', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'arkme-transcript-'))
 let db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
 const change = { id: 'one', original: '原词，原词。', expectedRevision: 0, text: '原词，新词。' }
 try {
  const service = Object.assign(Object.create(ArkmeService.prototype), { config: { environment: 'prod' }, stateStore: db, runtime: { requireSession: async () => ({ userId: 11 }) } }) as ArkmeService
  await expect(dispatchArkmeHostOperation(service, 'transcript.local.change', { accountKey: 'prod:12', scope: 'recording:123', id: 'one', change })).rejects.toMatchObject({ code: 'transcript-account-changed' })
  await expect(dispatchArkmeHostOperation(service, 'transcript.local.change', { accountKey: 'prod:11', scope: 'recording:123', id: 'other', change })).rejects.toMatchObject({ code: 'transcript-local-invalid' })
  await dispatchArkmeHostOperation(service, 'transcript.local.change', { accountKey: 'prod:11', scope: 'recording:123', id: 'one', change })
  expect(await dispatchArkmeHostOperation(service, 'transcript.local.read', { accountKey: 'prod:11', scope: 'recording:123', ids: ['one'] })).toHaveProperty('one.text', change.text)
  db.close(); db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  expect((await db.localTranscriptEntries('prod:11', 'recording:123', ['one'])).one?.text).toBe('原词，新词。')
  for (const [account, scope] of [['prod:12','recording:123'],['test:11','recording:123'],['prod:11','call:123']]) expect(await db.localTranscriptEntries(account!,scope!,['one'])).toEqual({})
  await expect(db.localTranscriptEntries('prod:11','recording:123',['one'],change)).rejects.toThrow('已更新')
  await expect(db.localTranscriptEntries('prod:11','recording:123',['one'],{...change,original:'云端新原文',expectedRevision:1})).rejects.toThrow('云端原文已更新')
  const restored = await db.localTranscriptEntries('prod:11','recording:123',['one'],{id:'one',original:'云端新原文',expectedRevision:1,restore:true})
  expect(restored.one).toMatchObject({revision:2,original:'云端新原文',text:'云端新原文'})
 } finally {db.close();await rm(directory,{recursive:true,force:true})}
})
it('validates exact mark anchors and keeps marks after correction for explicit stale handling', () => {
 const text='甲乙甲乙',digest=createHash('sha256').update(quoteSourceContent({title:'',textContent:text,textFormat:'plain'})).digest('hex')
 const anchor={version:1,projection:'arkme-text-v1',text:'甲乙',start:2,end:4,prefix:'甲乙',suffix:'',sourceDigest:digest} as const
 // readMessageQuote contract includes v1 projection, not a guessed numeric confidence.
 const base={id:'one',original:text,expectedRevision:0}
 const result=changeLocalTranscript(undefined,{...base,mark:{kind:'add',operationId:'one',anchor}},11)
 expect(result.marks).toHaveLength(1)
 expect(result.marks[0]?.actorId).toBe(11)
 expect(()=>changeLocalTranscript(result,{...base,expectedRevision:1,mark:{kind:'add',operationId:'two',anchor:{...anchor,text:'不一致'}}},11)).toThrow('已变化')
 const edited=changeLocalTranscript(result,{...base,expectedRevision:1,text:'甲乙新的'},11)
 expect(edited.marks[0]?.anchor.text).toBe('甲乙')
 expect(changeLocalTranscript(edited,{...base,expectedRevision:2,mark:{kind:'remove',operationId:'three',annotationId:'one'}},11).marks).toEqual([])
})
