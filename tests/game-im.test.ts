import {afterEach,it,expect,vi} from 'vitest'
const sdk=vi.hoisted(()=>({on:vi.fn(),off:vi.fn(),setLogLevel:vi.fn(),isReady:()=>true,login:vi.fn(async()=>{}),destroy:vi.fn(async()=>{}),createCustomMessage:vi.fn((v:any)=>v),createTextMessage:vi.fn((v:any)=>v),sendMessage:vi.fn(async(v:any)=>({data:{message:v}})),getMessageList:vi.fn()}))
vi.mock('@tencentcloud/lite-chat',()=>({default:{create:()=>sdk,EVENT:{MESSAGE_RECEIVED:'message',SDK_READY:'ready',SDK_NOT_READY:'notready',KICKED_OUT:'kicked'},TYPES:{CONV_GROUP:'GROUP'}}}))
import {GameIM} from '../src/client/game/im.js'
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers()})
it('paginates pinned SDK history to fifty messages without unsupported count',async()=>{
 let page=0;sdk.getMessageList.mockImplementation(async()=>({data:{messageList:Array.from({length:15},(_,i)=>({ID:`${page}-${i}`})),nextReqMessageID:`cursor${++page}`,isCompleted:page===4}}));const im=new GameIM(1,'room',()=>{},()=>{});expect(await im.history()).toHaveLength(50);expect(sdk.getMessageList).toHaveBeenCalledTimes(4);expect(sdk.getMessageList.mock.calls[1]![0]).toEqual({conversationID:'GROUProom',nextReqMessageID:'cursor1'});await im.destroy()
})
it('isolates group traffic after admission and preserves online-only game/private push flags',async()=>{
 vi.useFakeTimers();const received=vi.fn(),im=new GameIM(1,'',received,()=>{});im.group='room';const handler=sdk.on.mock.calls.find(c=>c[0]==='message')![1];handler({data:[{to:'other',conversationType:'GROUP'},{to:'room',conversationType:'C2C'},{to:'room',conversationType:'GROUP'}]});expect(received).toHaveBeenCalledTimes(1)
 const sent=im.send({x:1});await vi.advanceTimersByTimeAsync(1);await sent;expect(sdk.sendMessage.mock.calls[0]![1]).toEqual({onlineUserOnly:true});const chat=im.text('hello');await vi.advanceTimersByTimeAsync(220);await chat;expect(sdk.sendMessage.mock.calls[1]![1]).toEqual({offlinePushInfo:{disablePush:true}});await expect(im.send({text:'你'.repeat(2000)})).rejects.toThrow('大小限制');await im.destroy()
})

it('prioritizes player traffic, coalesces spectator updates and spaces text and protocol messages together',async()=>{
  vi.useFakeTimers()
  const im=new GameIM(1,'group',()=>{},()=>{})
  const times:number[]=[], order:string[]=[]
  sdk.sendMessage.mockImplementation(async (m:any)=>{
    times.push(Date.now())
    order.push(m.payload.text ?? JSON.parse(m.payload.data).tag)
    return {data:{message:m}}
  })
  const send=(tag:string,key?:string,observer=false)=>im.send({tag},{...(key&&{key}),observer})
  const jobs=[send('initial'),send('old','viewer-A',true),send('viewer-B','viewer-B',true),
    send('latest','viewer-A',true),send('snapshot'),im.text('chat'),send('player','seat'),send('ack'),send('digest')]
  await vi.advanceTimersByTimeAsync(2200)
  await Promise.all(jobs)
  expect(order).toEqual(['initial','snapshot','chat','player','ack','digest','viewer-B','latest'])
  for (const start of times) expect(times.filter(t=>t>=start && t<start+1000).length).toBeLessThanOrEqual(5)
  await im.destroy()
})
