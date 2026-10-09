import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'
import { TeamSendQueue } from '../src/services/team-send-queue.js'
import { ArkmePluginError } from '../src/services/service.js'
import type { TeamSendInput } from '../src/team-send-contract.js'
import type { TeamAppOperation, TeamMessage } from '../src/team-app-contract.js'

const directories: string[] = [], queues: TeamSendQueue[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  queues.splice(0).forEach(queue => queue.dispose())
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map(path => rm(path, {recursive:true,force:true})))
})
const offline = () => new ArkmePluginError('arkme-network-error', '网络断开', true, 503)
const input = (overrides: Partial<TeamSendInput> = {}): TeamSendInput => ({conversationRef:'42:conversation',clientUid:randomUUID(),expectedReplySeq:0,content:{text_content:'hello',template_kind:1},fileRefs:[],...overrides})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme team delivery ')); directories.push(directory)
  let user = 42, online = true, paused = false, denied = false, lostAck = false
  const published = new Map<string, TeamMessage>(), cancelled = new Map<string, TeamMessage>()
  const upload = vi.fn<FileTransferPorts['upload']>(async (_path, metadata, progress) => {
    if (!online) throw offline()
    progress({phase:'uploading',sentBytes:metadata.size,totalBytes:metadata.size})
    return {...metadata,fileAssetUid:`asset-${metadata.fileName}`}
  })
  const chatSend = vi.fn<FileTransferPorts['send']>(async i => ({kind:'owner_accepted',result:{sourceRef:i.sourceRef,itemUid:i.recordUid,status:1,localState:'synced'}}))
  const ports: FileTransferPorts = {currentUser:async()=>user,upload,send:chatSend,validateSource:async()=>{},fetchMedia:async()=>{throw new Error('unexpected media')}}
  let files = new FileTransfers(directory, ports, 1000)
  const execute = vi.fn(async (op: TeamAppOperation, p: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    signal.throwIfAborted()
    if (!online) throw offline()
    if (denied) throw new ArkmePluginError('team-not_accessible','无权访问',false,403)
    if (op === 'team.app.timeline') return {conversation:{channel:{enabled:!paused},blocked:false},messages:[]}
    if (op === 'team.app.cancel') {
      const uid = String(p.clientUid)
      const message = published.get(uid) ?? cancelled.get(uid) ?? {key:uid,ref:uid,seq:0,revision:1,side:'team',sender:{nickname:'我'},own:true,state:'cancelled',createdAt:Date.now(),canEdit:false,canDelete:false,version:0,contentStatus:'',media:[]} as TeamMessage
      if (message.state === 'cancelled') cancelled.set(uid, message)
      return {message}
    }
    if (op === 'team.app.send') {
      const uid = String(p.clientUid)
      if (cancelled.has(uid)) return {message:cancelled.get(uid)}
      let message = published.get(uid)
      if (!message) {
        message = {key:uid,ref:uid,seq:published.size+1,revision:1,side:'team',sender:{nickname:'我'},own:true,state:'published',createdAt:Date.now(),canEdit:true,canDelete:true,content:p.content as TeamMessage['content'],version:1,contentStatus:'available',media:[]}
        published.set(uid,message)
      }
      if (lostAck) {lostAck=false;throw offline()}
      return {message}
    }
    throw new Error(`unexpected ${op}`)
  })
  const createQueue = () => {
    const queue = new TeamSendQueue({currentUser:async()=>user,files:()=>files,
      identify:async(ref,actor)=>{if(!ref.startsWith(`${actor}:`))throw new ArkmePluginError('team-not_accessible','wrong account',false,403);return ref.split('#')[0]!},execute})
    queues.push(queue);return queue
  }
  let queue = createQueue()
  return {directory,upload,chatSend,execute,published,ports,get files(){return files},get queue(){return queue},
    stage:async(name='image.png')=>files.stageBytes(Buffer.from(name).toString('base64'),{fileName:name,mimeType:'image/png'}),
    setOnline:(v:boolean)=>{online=v},setUser:(v:number)=>{user=v},setPaused:(v:boolean)=>{paused=v},setDenied:(v:boolean)=>{denied=v},loseAck:()=>{lostAck=true},
    restart:()=>{queue.dispose();files=new FileTransfers(directory,ports,1000);queue=createQueue()},
  }
}

describe('Team delivery with the shared FileTransfers owner', () => {
  it('a slow upload does not delay consecutive text sends in another conversation',async()=>{
    const f=await fixture(),file=await f.stage()
    const slow=input({fileRefs:[file.fileRef]}),a=input({conversationRef:'42:other'}),b=input({conversationRef:'42:other'})
    let release!:()=>void
    const barrier=new Promise<void>(resolve=>{release=resolve})
    const upload=f.upload.getMockImplementation()!
    f.upload.mockImplementationOnce(async(...args)=>{await barrier;return upload(...args)})
    await f.queue.enqueue(slow);await f.queue.enqueue(a);await f.queue.enqueue(b)
    const recovery=f.queue.recover()
    try {
      await vi.waitFor(()=>expect(f.published.has(b.clientUid)).toBe(true))
      expect(f.published.has(slow.clientUid)).toBe(false)
      expect([...f.published.keys()]).toEqual([a.clientUid,b.clientUid])
    } finally {release();await recovery}
    expect(f.published.size).toBe(3)
  })
  it.each(['pause','dispose','account change'])('stops both delivery workers before later sends on %s',async change=>{
    const f=await fixture(),commands=[input(),input({conversationRef:'42:other'}),input({conversationRef:'42:third'})]
    let release!:()=>void
    const barrier=new Promise<void>(resolve=>{release=resolve})
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>{if(op==='team.app.send')await barrier;return original(op,p,signal)})
    for(const command of commands)await f.queue.enqueue(command)
    const recovery=f.queue.recover()
    try {
      await vi.waitFor(()=>expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(2))
      if(change==='account change')f.setUser(43)
      if(change==='dispose')f.queue.dispose();else f.queue.pause()
    } finally {release();await recovery}
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(2)
    expect(f.published.size).toBe(0)
  })
  it('uses a free delivery slot for a message submitted while another upload is pending',async()=>{
    const f=await fixture(),file=await f.stage(),slow=input({fileRefs:[file.fileRef]}),later=input({conversationRef:'42:other'})
    let release!:()=>void
    const barrier=new Promise<void>(resolve=>{release=resolve})
    const upload=f.upload.getMockImplementation()!
    f.upload.mockImplementationOnce(async(...args)=>{await barrier;return upload(...args)})
    await f.queue.enqueue(slow)
    const recovery=f.queue.recover()
    try {
      await vi.waitFor(()=>expect(f.upload).toHaveBeenCalledTimes(1))
      await f.queue.enqueue(later)
      await vi.waitFor(()=>expect(f.published.has(later.clientUid)).toBe(true))
      expect(f.published.has(slow.clientUid)).toBe(false)
    } finally {release();await recovery}
    expect(f.published.size).toBe(2)
  })
  it('accepts an offline attachment locally, then survives Host restart with the original identity', async()=>{
    const f=await fixture();f.setOnline(false)
    const file=await f.stage(), command=input({fileRefs:[file.fileRef]})
    const task=await f.queue.enqueue(command)
    expect(f.execute).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled()
    await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({state:'retrying',clientUid:command.clientUid})
    f.restart();f.setOnline(true);vi.setSystemTime(Date.now()+3000)
    await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({taskRef:task.taskRef,state:'sent'})
    expect(f.published.size).toBe(1);expect(f.chatSend).not.toHaveBeenCalled()
    expect(f.upload).toHaveBeenCalledTimes(1)
  })
  it('serializes one conversation while another remains independent and cursors remain immutable',async()=>{
    const f=await fixture(), a=input(), b=input(), c=input({conversationRef:'42:other'})
    await f.queue.enqueue(a);await f.queue.enqueue(b);await f.queue.enqueue(c)
    await f.queue.recover()
    expect([...f.published.keys()]).toEqual([a.clientUid,c.clientUid,b.clientUid])
    await f.queue.recover()
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(3)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send').map(([,p])=>p.expectedReplySeq)).toEqual([0,0,0])
  })
  it('wakes the next queued message immediately after success instead of imposing a polling delay',async()=>{
    const f=await fixture();await f.queue.enqueue(input());await f.queue.enqueue(input())
    await f.queue.recover()
    expect(f.published.size).toBe(2)
  })
  it('persists the frozen request and replays an unknown ACK without reuploading or duplicating',async()=>{
    const f=await fixture(),file=await f.stage(),command=input({fileRefs:[file.fileRef]})
    await f.queue.enqueue(command);f.loseAck();await f.queue.recover()
    const first=f.execute.mock.calls.find(([op])=>op==='team.app.send')![1]
    f.restart();vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    expect(f.published.size).toBe(1);expect(f.upload).toHaveBeenCalledTimes(1)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')[1]![1]).toEqual(first)
    expect((await f.queue.list(command.conversationRef))[0]?.state).toBe('sent')
  })
  it('resolves the original accepted command after a channel pause without admitting another send',async()=>{
    const f=await fixture(),command=input();await f.queue.enqueue(command)
    f.loseAck();await f.queue.recover();f.setPaused(true)
    vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[0]?.state).toBe('sent')
    await f.queue.enqueue(input());await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[1]?.state).toBe('failed')
    expect(f.published.size).toBe(1)
  })
  it('delivers later messages while an accepted ACK is unknown without duplicating on recovery',async()=>{
    const f=await fixture(),first=input(),second=input()
    await f.queue.enqueue(first);await f.queue.enqueue(second)
    f.loseAck();await f.queue.recover()
    await f.queue.recover()
    expect([...f.published.keys()]).toEqual([first.clientUid,second.clientUid])
    expect((await f.queue.list(first.conversationRef)).map(t=>t.state)).toEqual(['retrying','sent'])
    vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    expect(f.published.size).toBe(2)
    expect((await f.queue.list(first.conversationRef)).map(t=>t.state)).toEqual(['sent','sent'])
  })
  it('leaves only the unavailable upload pending and sends a later text',async()=>{
    const f=await fixture(),file=await f.stage(),first=input({fileRefs:[file.fileRef]}),second=input()
    await f.queue.enqueue(first);await f.queue.enqueue(second)
    const original=f.upload.getMockImplementation()!
    f.upload.mockImplementation(async()=>{throw offline()})
    await f.queue.recover();await f.queue.recover()
    expect(f.published.has(second.clientUid)).toBe(true)
    expect(f.published.has(first.clientUid)).toBe(false)
    expect(f.upload).toHaveBeenCalledTimes(1)
    f.upload.mockImplementation(original);vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    expect(f.published.size).toBe(2)
  })
  it('reuses successful sibling uploads after an interrupted batch',async()=>{
    const f=await fixture(),a=await f.stage('a.png'),b=await f.stage('b.png')
    const original=f.upload.getMockImplementation()!;let fail=true
    f.upload.mockImplementation(async(...args)=>{if(args[1].fileName==='b.png'&&fail){fail=false;throw offline()}return original(...args)})
    await f.queue.enqueue(input({fileRefs:[a.fileRef,b.fileRef]}));await f.queue.recover()
    f.restart();vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    expect(f.upload.mock.calls.filter(args=>args[1].fileName==='a.png')).toHaveLength(1)
    expect(f.upload.mock.calls.filter(args=>args[1].fileName==='b.png')).toHaveLength(2)
    expect(f.published.size).toBe(1)
  })
  it('rechecks current authority for later sends without retrying a rejected message',async()=>{
    const f=await fixture(),file=await f.stage(),a=input({fileRefs:[file.fileRef]})
    await f.queue.enqueue(a);f.setDenied(true)
    await f.queue.recover()
    expect(f.upload).not.toHaveBeenCalled();expect(f.published.size).toBe(0)
    f.setDenied(false);await f.queue.enqueue(input());await f.queue.recover()
    expect((await f.queue.list(a.conversationRef)).map(t=>t.state)).toEqual(['failed','sent'])
    expect(f.published.size).toBe(1)
    const failed=(await f.queue.list(a.conversationRef))[0]!
    await expect(f.queue.retry(a.conversationRef,failed.taskRef)).rejects.toMatchObject({code:'team-not_accessible'})
    await f.queue.cancel(a.conversationRef,failed.taskRef);await f.queue.recover()
    expect(f.published.size).toBe(1)
  })
  it.each(['team-invalid_request','team-dependency_unavailable','team-reply_conflict'])('isolates %s from later independent messages across restart',async(code)=>{
    const f=await fixture(),first=input(),second=input(),other=input({conversationRef:'42:other'})
    await f.queue.enqueue(first);await f.queue.enqueue(second);await f.queue.enqueue(other)
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>{
      if(op==='team.app.send'&&p.clientUid===first.clientUid)throw new ArkmePluginError(code,'send failed',code!=='team-invalid_request',409)
      return original(op,p,signal)
    })
    await f.queue.recover()
    const firstRequest=f.execute.mock.calls.find(([op,p])=>op==='team.app.send'&&p.clientUid===first.clientUid)![1]
    expect(f.published.has(other.clientUid)).toBe(true)
    f.restart();await f.queue.recover()
    expect(f.published.has(second.clientUid)).toBe(true)
    expect(f.execute.mock.calls.filter(([op,p])=>op==='team.app.send'&&p.clientUid===first.clientUid)).toHaveLength(1)
    expect((await f.queue.list(first.conversationRef))[0]?.state).toBe(code==='team-invalid_request'?'failed':'retrying')
    if(code!=='team-invalid_request'){
      f.execute.mockImplementation(original);vi.setSystemTime(Date.now()+31_000);await f.queue.recover()
      expect(f.execute.mock.calls.filter(([op,p])=>op==='team.app.send'&&p.clientUid===first.clientUid)[1]![1]).toEqual(firstRequest)
      expect(f.published.size).toBe(3)
    }
  })
  it('backs off legacy server responses and resumes the same send without confirmation',async()=>{
    const f=await fixture(),command=input();await f.queue.enqueue(command)
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>op==='team.app.send'?{reason:'reply_conflict',message:{ref:'accepted',state:'preparing'}}:original(op,p,signal))
    await f.queue.recover();await f.queue.recover()
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(1)
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({state:'retrying',reason:'preparing'})
    vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(2)
    f.execute.mockImplementation(original)
    vi.setSystemTime(Date.now()+5000);await f.queue.recover()
    const sends=f.execute.mock.calls.filter(([op])=>op==='team.app.send').map(([,p])=>p)
    expect(sends).toHaveLength(3);expect(sends[1]).toEqual(sends[0]);expect(sends[2]).toEqual(sends[0])
    expect(f.published.size).toBe(1)
    expect(f.execute.mock.calls.some(([op])=>String(op)==='team.app.send.confirm')).toBe(false)
  })
  it.each([false,true])('recovers a persisted legacy conflict with original identity, cancellation=%s',async(cancelRequested)=>{
    const f=await fixture(),command=input(),task=await f.queue.enqueue(command)
    const later=input();await f.queue.enqueue(later)
    await f.files.mutateTeamSends(42,tasks=>{
      Object.assign(tasks[0]!,{state:cancelRequested?'cancelling':'failed',reason:'reply_conflict',
        error:'其他成员已回复，请阅读后确认是否仍要发送',sendContent:command.content,
        cancelRequested,confirmReplySeq:99,message:{ref:'accepted',state:'preparing'}})
    })
    f.restart()
    if(!cancelRequested)expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({state:'queued',reason:'preparing'})
    expect((await f.queue.list(command.conversationRef))[0]?.error).toBe(cancelRequested?'其他成员已回复，请阅读后确认是否仍要发送':undefined)
    await f.queue.recover();await f.queue.recover()
    const sends=f.execute.mock.calls.filter(([op])=>op==='team.app.send').map(([,p])=>p)
    expect(sends.map(p=>p.clientUid)).toEqual(cancelRequested?[later.clientUid]:[command.clientUid,later.clientUid])
    if(!cancelRequested)expect(sends[0]).toEqual({conversationRef:command.conversationRef,clientUid:command.clientUid,expectedReplySeq:0,content:command.content})
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({taskRef:task.taskRef,state:cancelRequested?'cancelled':'sent'})
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.cancel')).toHaveLength(cancelRequested?1:0)
    expect(f.execute.mock.calls.some(([op])=>String(op)==='team.app.send.confirm')).toBe(false)
    expect(f.published.size).toBe(cancelRequested?1:2)
  })
  it.each(['queued','uploading','sending','retrying'] as const)('hides a retained legacy explanation without resetting the %s checkpoint',async(state)=>{
    const f=await fixture(),command=input();await f.queue.enqueue(command)
    const deadline=Date.now()+30_000
    await f.files.mutateTeamSends(42,tasks=>Object.assign(tasks[0]!,{state,reason:'reply_conflict',error:'其他成员已回复',sendContent:command.content,nextAttemptAt:deadline,attempts:4}))
    const restored=(await f.queue.list(command.conversationRef))[0]!
    expect(restored).toMatchObject({state,reason:'preparing',nextAttemptAt:deadline,attempts:4,sendContent:command.content})
    expect(restored.error).toBeUndefined()
    await f.queue.recover();expect(f.published.size).toBe(0)
    vi.setSystemTime(deadline);await f.queue.recover();expect(f.published.size).toBe(1)
  })
  it('retries a legacy rejection without operation metadata using the same request',async()=>{
    const f=await fixture(),command=input();await f.queue.enqueue(command)
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>{
      if(op==='team.app.send')throw new ArkmePluginError('team-reply_conflict','服务暂时不可用',false,409)
      return original(op,p,signal)
    })
    await f.queue.recover();await f.queue.recover()
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(1)
    expect((await f.queue.list(command.conversationRef))[0]?.state).toBe('retrying')
    f.execute.mockImplementation(original);vi.setSystemTime(Date.now()+3000);await f.queue.recover()
    const sends=f.execute.mock.calls.filter(([op])=>op==='team.app.send').map(([,p])=>p)
    expect(sends).toHaveLength(2);expect(sends[1]).toEqual(sends[0]);expect(f.published.size).toBe(1)
  })
  it('deduplicates repeated local admission and rejects changed payloads',async()=>{
    const f=await fixture(),command=input()
    const [a,b]=await Promise.all([f.queue.enqueue(command),f.queue.enqueue(command)])
    expect(a.taskRef).toBe(b.taskRef)
    await expect(f.queue.enqueue({...command,content:{...command.content,text_content:'different'}})).rejects.toMatchObject({code:'team-idempotency_conflict'})
    expect(await f.queue.list(command.conversationRef)).toHaveLength(1)
    const renewed=await f.queue.enqueue({...command,conversationRef:`${command.conversationRef}#renewed`})
    expect(renewed.conversationRef).toBe(`${command.conversationRef}#renewed`)
  })
  it('keeps a queued cancellation exclusive with background recovery',async()=>{
    const f=await fixture(),command=input(),task=await f.queue.enqueue(command)
    const original=f.files.teamSends.bind(f.files);let release!:(v:Awaited<ReturnType<typeof original>>)=>void
    const snapshot=await original(42)
    vi.spyOn(f.files,'teamSends').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
    const cancelling=f.queue.cancel(command.conversationRef,task.taskRef)
    for(let n=0;n<10&&!release;n++)await Promise.resolve()
    await f.queue.recover();release(snapshot)
    expect((await cancelling).state).toBe('cancelled');expect(f.published.size).toBe(0)
  })
  it('resolves an unknown ACK before cancellation instead of hiding an already delivered message',async()=>{
    const f=await fixture(),command=input(),task=await f.queue.enqueue(command)
    f.loseAck();await f.queue.recover()
    expect((await f.queue.cancel(command.conversationRef,task.taskRef)).state).toBe('sent')
    expect(f.published.size).toBe(1)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(1)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.cancel')).toHaveLength(1)
  })
  it('cancels an unknown request without publishing a send that never reached the owner',async()=>{
    const f=await fixture(),command=input(),task=await f.queue.enqueue(command)
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>{if(op==='team.app.send')throw offline();return original(op,p,signal)})
    await f.queue.recover()
    expect((await f.queue.cancel(command.conversationRef,task.taskRef)).state).toBe('cancelled')
    expect(f.published.size).toBe(0)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(1)
    expect(f.execute.mock.calls.at(-1)?.slice(0,2)).toEqual(['team.app.cancel',{conversationRef:command.conversationRef,clientUid:command.clientUid}])
  })
  it.each([false,true])('persists cancellation through restart even when cancellation ACK was lost: %s',async(cancelAckLost)=>{
    const f=await fixture(),command=input(),task=await f.queue.enqueue(command)
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>{if(op==='team.app.send')throw offline();return original(op,p,signal)})
    await f.queue.recover()
    f.execute.mockImplementation(async(op,p,signal)=>{
      if(op==='team.app.cancel'){if(cancelAckLost)await original(op,p,signal);throw offline()}
      return original(op,p,signal)
    })
    await expect(f.queue.cancel(command.conversationRef,task.taskRef)).rejects.toThrow()
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({cancelRequested:true,state:'cancelling'})
    f.restart();f.execute.mockImplementation(original);vi.setSystemTime(Date.now()+5000)
    await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({state:'cancelled',clientUid:command.clientUid})
    expect(f.published.size).toBe(0)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(1)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.cancel')).toHaveLength(2)
  })
  it('does not resume sending if an old server cannot confirm identity-based cancellation',async()=>{
    const f=await fixture(),command=input(),task=await f.queue.enqueue(command)
    const original=f.execute.getMockImplementation()!
    f.execute.mockImplementation(async(op,p,signal)=>{if(op==='team.app.send')throw offline();return original(op,p,signal)})
    await f.queue.recover()
    f.execute.mockImplementation(async(op,p,signal)=>op==='team.app.cancel'?{}:original(op,p,signal))
    await expect(f.queue.cancel(command.conversationRef,task.taskRef)).rejects.toMatchObject({code:'team-cancel-uncertain'})
    f.restart();await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[0]).toMatchObject({cancelRequested:true,state:'failed'})
    expect(f.published.size).toBe(0)
    expect(f.execute.mock.calls.filter(([op])=>op==='team.app.send')).toHaveLength(1)
    f.execute.mockImplementation(original)
    await f.queue.retry(command.conversationRef,task.taskRef);await f.queue.recover()
    expect((await f.queue.list(command.conversationRef))[0]?.state).toBe('cancelled')
  })
  it('cannot send the previous account tasks or inspect them under another account',async()=>{
    const f=await fixture(),command=input();await f.queue.enqueue(command)
    f.queue.pause();f.setUser(43);await f.queue.recover()
    await expect(f.queue.list(command.conversationRef)).rejects.toMatchObject({code:'team-not_accessible'})
    expect(f.published.size).toBe(0)
    f.setUser(42);await f.queue.recover();expect(f.published.size).toBe(1)
  })
  it('does not discard a task when local persistence fails before acceptance',async()=>{
    const f=await fixture(),file=await f.stage()
    const path=join(f.directory,'42','state.json')
    await rm(path);const {mkdir}=await import('node:fs/promises');await mkdir(path)
    await expect(f.queue.enqueue(input({fileRefs:[file.fileRef]}))).rejects.toThrow()
    expect(await f.files.teamSends(42)).toEqual([]);expect(f.execute).not.toHaveBeenCalled()
  })
  it('retains pending file references but reclaims old completed task bytes through shared cleanup',async()=>{
    const f=await fixture(),a=await f.stage(),command=input({fileRefs:[a.fileRef]})
    await f.queue.enqueue(command)
    vi.setSystemTime(Date.now()+8*86400000);await f.stage('pending.png')
    await expect(f.files.readLocal(a.fileRef)).resolves.toBeDefined()
    await f.queue.recover();await f.stage('after.png')
    // A long offline wait must not expire the preview immediately after delivery.
    await expect(f.files.readLocal(a.fileRef)).resolves.toBeDefined()
    expect((await f.queue.list(command.conversationRef))[0]?.completedAtMillis).toBe(Date.now())
    vi.setSystemTime(Date.now()+8*86400000);await f.stage('expired.png')
    await expect(f.files.readLocal(a.fileRef)).rejects.toThrow()
    expect(await f.queue.list(command.conversationRef)).toEqual([])
  })
  it('backs off failed network reads rather than spinning on every recovery tick',async()=>{
    const f=await fixture();await f.queue.enqueue(input());f.setOnline(false)
    await f.queue.recover();await f.queue.recover();await f.queue.recover()
    expect(f.execute).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now()+2001);await f.queue.recover();expect(f.execute).toHaveBeenCalledTimes(2)
  })
})
