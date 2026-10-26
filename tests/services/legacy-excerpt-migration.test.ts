import {DatabaseSync} from 'node:sqlite'
import {afterEach,expect,it,vi} from 'vitest'
import {LocalSelfNoteQuotes} from '../../src/local-self-note-quotes.js'
import {selectedTextNoteWireText} from '../../src/selected-text-note.js'
import {RecordService} from '../../src/services/record-service.js'
import {ArkmeUpstreamResponseError} from '../../src/services/service.js'
import type {ServiceRuntime} from '../../src/services/service.js'
const databases:DatabaseSync[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
const quote={version:1 as const,sourceLabel:'Codex',senderName:'作者',sourceAtMillis:1,text:'旧摘录 😀'}
function fixture(){
 const db=new DatabaseSync(':memory:');databases.push(db)
 const store=new LocalSelfNoteQuotes(db),session={userId:11,refreshToken:'test-session'}
 const uid='legacy-record',text=selectedTextNoteWireText('自己的理解',quote)
 store.prepare('test:11',uid,quote,'自己的理解')
 const post=vi.fn(async(path:string)=>path.endsWith('/detail')?{record_core:{record_uid:uid,owner_user_id:11,status:1,version:1,text_content:text}}:{record_uid:uid,version:2})
 const runtime={config:{environment:'test'},stateStore:{selfNoteQuotes:store},requireSession:async()=>session,accountScopedSession:async()=>session,authenticatedPost:post} as unknown as ServiceRuntime
 return {db,store,uid,text,post,restart:()=>new RecordService(runtime,{} as never,{} as never)}
}
it('migrates a positively identified old quote without creating another record or changing its text',async()=>{
 const f=fixture();await f.restart().migrateLegacySelfExcerpts()
 expect(f.post.mock.calls.map(c=>c[0])).toEqual(['/api/v1/records/detail','/api/v1/records/excerpt/attach'])
 const body=(f.post.mock.calls[1] as unknown as [string,any])[1]
 expect(body).toMatchObject({record_uid:f.uid,expected_version:1,excerpt:{schema_version:1}})
 expect(JSON.stringify(body)).not.toContain(quote.text)
 expect(f.store.migrationCandidates('test:11')).toEqual([])
 expect(f.store.project('test:11',f.uid,f.text)).toBeUndefined()
})
it('retains the frozen request after an unknown response and restart, and does not rebase on a later edit',async()=>{
 const f=fixture(),original=f.post.getMockImplementation()!
 f.post.mockImplementation(async(path)=>path.endsWith('/attach')?Promise.reject(Error('lost response')):original(path))
 await f.restart().migrateLegacySelfExcerpts()
 const first=(f.post.mock.calls[1] as unknown as [string,any])[1]
 f.post.mockClear();await f.restart().migrateLegacySelfExcerpts()
 expect((f.post.mock.calls[1] as unknown as [string,any])[1]).toEqual(first)
 f.post.mockImplementation(async()=>({record_core:{record_uid:f.uid,owner_user_id:11,status:1,version:3,text_content:f.text+' edited'}}) as never)
 await f.restart().migrateLegacySelfExcerpts()
 expect(f.store.migrationCandidates('test:11')).toEqual([])
 expect(f.store.project('test:11',f.uid,f.text)?.quote.text).toBe(quote.text)
})
it('does not treat similar text without a local UID binding, another account or a changed quote as evidence',()=>{
 const f=fixture()
 expect(f.store.migration('test:22',f.uid,f.text,1)).toBeUndefined()
 expect(f.store.migration('test:11','different-uid',f.text,1)).toBeUndefined()
 expect(f.store.migration('test:11',f.uid,f.text.replace('旧摘录','别的原文'),1)).toBeUndefined()
})
it('advances a bounded page past a temporarily protected entry',()=>{
 const f=fixture()
 for(let i=0;i<9;i++)f.store.prepare('test:11','row-'+i,quote,'note')
 const first=f.store.migrationCandidates('test:11',4)
 const next=f.store.migrationCandidates('test:11',4,first.at(-1))
 expect(first).toHaveLength(4);expect(next).toHaveLength(4)
 expect(next.some(id=>first.includes(id))).toBe(false)
})

it('retains local data and stops retrying a definitive metadata conflict such as existing quote tags',async()=>{
 const f=fixture(),read=f.post.getMockImplementation()!
 f.post.mockImplementation(async(path)=>{if(path.endsWith('/attach'))throw new ArkmeUpstreamResponseError('arkme-code-40001','excerpt quote cannot create tags',false,400,{});return read(path)})
 await f.restart().migrateLegacySelfExcerpts()
 expect(f.store.migrationCandidates('test:11')).toEqual([])
 expect(f.store.project('test:11',f.uid,f.text)).toMatchObject({storage:'local',migrationConflict:true,quote:{text:quote.text}})
 f.post.mockClear();await f.restart().migrateLegacySelfExcerpts();expect(f.post).not.toHaveBeenCalled()
})
