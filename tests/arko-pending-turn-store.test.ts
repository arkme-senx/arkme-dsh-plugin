import { mkdtemp,readFile,writeFile,rm,stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach,describe,expect,it } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import { isValidArkoPendingTurn,type ArkmeArkoPendingTurn } from '../src/arko-turn-contract.js'
const directories:string[]=[]
afterEach(async()=>{await Promise.all(directories.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
async function directory(){const root=await mkdtemp(join(tmpdir(),'arko pending '));directories.push(root);return root}
function turn():ArkmeArkoPendingTurn{return {userId:10001,sessionId:88,clientTurnUid:'11111111-1111-4111-8111-111111111111',text:'',
 images:[{fileRef:'arkme-file-v1.11111111-1111-4111-8111-111111111111',fileName:'photo.png',mimeType:'image/png',size:100,fileKind:1}],
 createdAtMillis:1,localUserMessageId:'local-user',localAssistantMessageId:'local-assistant',modelRouteKey:'managed-ai/vision'}}
describe('Arko durable pending turn owner',()=>{
 it('survives a Host restart, retains image files and keeps the exact cloud request',async()=>{
  const root=await directory(),first=new ArkmeStateStore(root),pending=turn()
  await first.prepareArkoTurn(pending.userId,pending)
  const request={session_id:88,client_turn_uid:pending.clientTurnUid,content:'',attachments:[{type:'image',file_asset_uid:'cloud-asset'}]}
  await first.prepareArkoTurn(pending.userId,pending,request)
  const restarted=new ArkmeStateStore(root)
  expect(await restarted.arkoTurn(10001,pending.clientTurnUid)).toEqual({turn:pending,request})
  expect(await restarted.arkoPendingTurns(20002)).toEqual([])
  expect(await restarted.arkoFileRefs(10001)).toEqual(pending.images!.map(file=>file.fileRef))
  await expect(restarted.prepareArkoTurn(10001,{...pending,text:'different'})).rejects.toThrow('其他内容')
  await expect(restarted.prepareArkoTurn(10001,pending,{...request,content:'changed'})).rejects.toThrow()
  await restarted.acknowledgeArkoTurn(10001,pending.clientTurnUid)
  expect(await new ArkmeStateStore(root).arkoPendingTurns(10001)).toEqual([])
  if(process.platform!=='win32')expect((await stat(join(root,'state.json'))).mode&0o777).toBe(0o600)
 })
 it('preserves corrupt recovery evidence and isolates the affected account',async()=>{
  const root=await directory(),store=new ArkmeStateStore(root),pending=turn()
  await store.prepareArkoTurn(10001,pending)
  const file=join(root,'state.json'),raw=JSON.parse(await readFile(file,'utf8'))
  raw.arkoTurnsByUser['10001'][pending.clientTurnUid].turn.images[0].fileRef='/private/path.png'
  await writeFile(file,JSON.stringify(raw))
  const restarted=new ArkmeStateStore(root)
  await expect(restarted.arkoPendingTurns(10001)).rejects.toThrow('恢复数据损坏')
  expect(await restarted.arkoPendingTurns(20002)).toEqual([])
  expect((await readFile(file,'utf8'))).toContain('/private/path.png')
 })
 it('rejects paths, non-images and duplicate local references before persistence',()=>{
  const pending=turn(),image=pending.images![0]!
  expect(isValidArkoPendingTurn(pending)).toBe(true)
  expect(isValidArkoPendingTurn({...pending,images:[image,image]})).toBe(false)
  expect(isValidArkoPendingTurn({...pending,images:[{...image,fileRef:'/tmp/photo.png'}]})).toBe(false)
  expect(isValidArkoPendingTurn({...pending,images:[{...image,mimeType:'text/html'}]})).toBe(false)
 })
})
