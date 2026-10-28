import { DatabaseSync } from 'node:sqlite'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { TeamCodexRemoteTaskReview } from '../src/team-codex-remote-task-review.js'
import type { TeamCodexEventPage, TeamCodexTask } from '../src/team-codex-contract.js'
import { codexInternalHistory, codexInternalRequest } from '../src/team-codex-task-visibility.js'
const prompt='This is an app-generated request for a suggested next user message. The user did not write this message.\n\n{"suggestion":null}'
const task:TeamCodexTask={id:'task',title:'Codex',status:'active',state:'interrupted',updatedAt:100,eventCount:2,
  member:{userRef:'usr',displayName:'我',role:'member',joinedAtMillis:1},
  cloud:{taskId:'cloud-task',sourceId:'source',sourceName:'电脑',ownerRef:'11',remote:true}}
const page:TeamCodexEventPage={items:[{kind:'UserPromptSubmit',text:prompt,at:99,sequence:1,turnId:'turn',truncated:false},{kind:'Interrupt',text:'',at:100,sequence:2,turnId:'turn',truncated:false}]}
const databases:DatabaseSync[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
function fixture(){const db=new DatabaseSync(':memory:');databases.push(db);return {db,review:new TeamCodexRemoteTaskReview(db)}}
describe('cloud history task classification',()=>{
  it('rejects only precise generated envelopes and preserves quotations, code and mixed real-user history',()=>{
    expect(codexInternalRequest(prompt)).toBe(true)
    for(const text of ['请分析：\n'+prompt,'```\n'+prompt+'\n```','Codex 已中断','This is an app-generated request'])expect(codexInternalRequest(text)).toBe(false)
    expect(codexInternalHistory([...page.items,{...page.items[0]!,text:'真正的问题'}])).toBe(false)
    expect(codexInternalHistory([{...page.items[0]!,truncated:true}])).toBe(false)
  })
  it('returns immediately, persists a verified decision and invalidates it when the task changes',async()=>{
    const f=fixture(),read=vi.fn(async()=>page)
    expect(f.review.visible(11,'team',task,read)).toBe('checking')
    await vi.waitFor(()=>expect(f.review.visible(11,'team',task,read)).toBe('hidden'))
    expect(new TeamCodexRemoteTaskReview(f.db).visible(11,'team',task,read)).toBe('hidden')
    expect(read).toHaveBeenCalledTimes(1)
    const real=vi.fn(async()=>({items:[{...page.items[0]!,text:'请修复实际问题'},page.items[1]!]}))
    expect(f.review.visible(11,'team',{...task,updatedAt:101},real)).toBe('checking')
    await vi.waitFor(()=>expect(f.review.visible(11,'team',{...task,updatedAt:101},real)).toBe('visible'))
  })
  it('does not classify partial history or trust a result after an account switch',async()=>{
    const f=fixture()
    const partial=vi.fn(async()=>({...page,nextCursor:'more'}))
    f.review.visible(11,'team',task,partial)
    await vi.waitFor(()=>expect(f.db.prepare('SELECT verdict FROM codex_remote_task_review').get()).toEqual({verdict:'retry'}))
    let finish!:(value:TeamCodexEventPage)=>void
    f.review.visible(22,'team',task,()=>new Promise(resolve=>{finish=resolve}))
    f.review.fence();finish(page)
    await new Promise(resolve=>setTimeout(resolve,0))
    expect(f.db.prepare('SELECT count(*) n FROM codex_remote_task_review WHERE owner=22').get()).toEqual({n:0})
  })
  it('rechecks unchanged metadata in the background and recovers a corrected history',async()=>{
    const f=fixture();let now=1000
    const review=new TeamCodexRemoteTaskReview(f.db,()=>now)
    review.visible(11,'team',task,async()=>page)
    await vi.waitFor(()=>expect(review.visible(11,'team',task,async()=>page)).toBe('hidden'))
    now+=30*60_000+1
    let finish!:(value:TeamCodexEventPage)=>void
    expect(review.visible(11,'team',task,()=>new Promise(resolve=>{finish=resolve}))).toBe('hidden')
    finish({items:[{...page.items[0]!,text:'真实用户问题'},page.items[1]!]})
    await vi.waitFor(()=>expect(review.visible(11,'team',task,async()=>page)).toBe('visible'))
  })
  it('limits network concurrency and preserves named and locally verified tasks without reading their history',async()=>{
    const f=fixture(),finish:Array<()=>void>=[],read=vi.fn(()=>new Promise<TeamCodexEventPage>(resolve=>finish.push(()=>resolve(page))))
    expect(f.review.visible(11,'team',{...task,title:'实际任务'},read)).toBe('visible')
    expect(f.review.visible(11,'team',{...task,cloud:{...task.cloud!,remote:false}},read)).toBe('visible')
    for(let n=0;n<12;n++)f.review.visible(11,'team',{...task,cloud:{...task.cloud!,taskId:String(n)}},read)
    expect(read).toHaveBeenCalledTimes(4)
    f.review.fence();for(const done of finish)done()
    await new Promise(resolve=>setTimeout(resolve,0))
    expect(read).toHaveBeenCalledTimes(4)
  })
})
