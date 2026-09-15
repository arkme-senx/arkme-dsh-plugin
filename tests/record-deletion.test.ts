import { ArkmePluginError, ArkmeUpstreamResponseError } from '../src/services/service.js'
import { describe,it,expect,vi } from 'vitest'
import { sealRecordDeletionRef, openRecordDeletionRef } from '../src/record-deletion-ref.js'
import { RecordDeletionService, RecordDeletionHttpPort } from '../src/services/record-deletion-service.js'
const ref = { userId: 7, sourceKind: 'private_chat' as const, sourceOwnerRef: 'chat', recordUid: 'record', recordVersion: 3 }
function setup(){
 const port={deleteBatch:vi.fn().mockResolvedValue({items:[{recordUid:'record',version:4,result:'deleted'}]})}
 const runtime={invalidateKey:vi.fn(),requestScope:(id:number)=>String(id),requireSession:vi.fn().mockResolvedValue({userId:7}),stateStore:{uniqueCode:async()=> 'key'}}
 const sources={openSourceRef:vi.fn().mockResolvedValue({kind:'private_chat',ownerRef:'chat'}),invalidateSourceListCache:vi.fn()}
 const service=new RecordDeletionService(runtime as never,sources as never,port)
 return {port,runtime,sources,service}
}
describe('record deletion boundary',()=>{
 it('binds version and identity in a distinct signed reference',()=>{
  const value=sealRecordDeletionRef(ref,'key');expect(openRecordDeletionRef(value,'key')).toEqual(ref)
  expect(()=>openRecordDeletionRef(value,'other')).toThrow()
  expect(()=>openRecordDeletionRef(value.replace('arkme-record-delete-v1','arkme-message-action-v1'),'key')).toThrow()
 })
 it.each([{...ref,userId:8},{...ref,sourceOwnerRef:'other'},{...ref,sourceKind:'topic' as const}])('rejects cross-scope references before IO',async other=>{
  const {service,port}=setup();await expect(service.delete('source',[sealRecordDeletionRef(other,'key')])).rejects.toThrow();expect(port.deleteBatch).not.toHaveBeenCalled()
 })
 it('rejects duplicate records and empty selection',async()=>{
  const {service,port}=setup();const value=sealRecordDeletionRef(ref,'key')
  await expect(service.delete('source',[value,value])).rejects.toThrow();await expect(service.delete('source',[])).rejects.toThrow();expect(port.deleteBatch).not.toHaveBeenCalled()
 })
 it('passes observed versions once and invalidates even for unknown outcomes',async()=>{
  const {service,port,sources}=setup();port.deleteBatch.mockRejectedValue(new Error('timeout'))
  await expect(service.delete('source',[sealRecordDeletionRef(ref,'key')])).rejects.toThrow('timeout')
  expect(port.deleteBatch).toHaveBeenCalledTimes(1);expect(port.deleteBatch.mock.calls[0]?.[0]).toEqual([{recordUid:'record',version:3}]);expect(sources.invalidateSourceListCache).toHaveBeenCalled()
 })
 it('rejects account change before mutation',async()=>{
  const {service,port,runtime}=setup();runtime.requireSession.mockResolvedValueOnce({userId:7}).mockResolvedValue({userId:8})
  await expect(service.delete('source',[sealRecordDeletionRef(ref,'key')])).rejects.toThrow();expect(port.deleteBatch).not.toHaveBeenCalled()
 })
 it('stops after malformed success without replaying',async()=>{
  const post=vi.fn().mockResolvedValue({record_core:{}})
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>({userId:7})} as never)
  const result=await port.deleteBatch([{recordUid:'a',version:3},{recordUid:'b',version:3}],{userId:7} as never)
  expect(result.items.map(x=>x.result)).toEqual(['unknown','not_attempted']);expect(post).toHaveBeenCalledTimes(1)
 })
 it('uses the existing endpoint sequentially with observed versions',async()=>{
  const post=vi.fn().mockImplementation(async(_path,body)=>({record_core:{record_uid:body.record_uid,owner_user_id:7,status:2,version:body.version+1}}))
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>({userId:7})} as never)
  const result=await port.deleteBatch([{recordUid:'a',version:3},{recordUid:'b',version:5}],{userId:7} as never)
  expect(result.items).toEqual([{recordUid:'a',version:4,result:'deleted'},{recordUid:'b',version:6,result:'deleted'}])
  expect(post.mock.calls.map(x=>x.slice(0,2))).toEqual([['/api/v1/records/delete',{record_uid:'a',version:3}],['/api/v1/records/delete',{record_uid:'b',version:5}]])
 })
 it('preserves confirmed successes and stops on a lost response',async()=>{
  const post=vi.fn().mockResolvedValueOnce({record_core:{record_uid:'a',owner_user_id:7,status:2,version:4}}).mockRejectedValue(new Error('timeout'))
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>({userId:7})} as never)
  const result=await port.deleteBatch(['a','b','c'].map(recordUid=>({recordUid,version:3})),{userId:7} as never)
  expect(result.items.map(x=>x.result)).toEqual(['deleted','unknown','not_attempted']);expect(post).toHaveBeenCalledTimes(2)
 })
 it.each([
  new ArkmeUpstreamResponseError('arkme-code-40001','内容版本已变化，请刷新后重试',false,502,{}),
  new ArkmePluginError('auth-http-403','没有权限删除',false,403),
 ])('preserves explicit rejection without claiming unknown outcome',async error=>{
  const post=vi.fn().mockResolvedValueOnce({record_core:{record_uid:'a',owner_user_id:7,status:2,version:4}}).mockRejectedValue(error)
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>({userId:7})} as never)
  const result=await port.deleteBatch(['a','b','c'].map(recordUid=>({recordUid,version:3})),{userId:7} as never)
  expect(result.items.map(x=>x.result)).toEqual(['deleted','rejected','not_attempted'])
  expect(result.items[1]).toMatchObject({message:error.message});expect(post).toHaveBeenCalledTimes(2)
 })
 it.each([
  new ArkmeUpstreamResponseError('arkme-code-1002','服务异常',true,502,{}),
  new ArkmePluginError('arkme-code-40001','响应不确定',false,502,{writeOutcomeUnknown:true}),
 ])('does not treat server failure or unknown outcome metadata as rejection',async error=>{
  const post=vi.fn().mockRejectedValue(error)
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>({userId:7})} as never)
  expect((await port.deleteBatch([{recordUid:'a',version:3}],{userId:7} as never)).items[0]?.result).toBe('unknown')
 })
 it.each(['logout','switch','abort'])('stops remaining writes after %s',async mode=>{
  const controller=new AbortController();let sessionReads=0
  const post=vi.fn().mockImplementation(async()=>{if(mode==='abort')controller.abort();return {record_core:{record_uid:'a',owner_user_id:7,status:2,version:4}}})
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>{if(++sessionReads>1){if(mode==='logout')throw new Error('logged out');return {userId:8}}return {userId:7}}} as never)
  const result=await port.deleteBatch(['a','b'].map(recordUid=>({recordUid,version:3})),{userId:7} as never,controller.signal)
  expect(result.items.map(x=>x.result)).toEqual(['deleted','not_attempted']);expect(post).toHaveBeenCalledTimes(1)
 })
 it.each([{record_uid:'other'},{owner_user_id:8},{status:1},{version:3}])('rejects inconsistent owner result %s',async override=>{
  const post=vi.fn().mockResolvedValue({record_core:{record_uid:'a',owner_user_id:7,status:2,version:4,...override}})
  const port=new RecordDeletionHttpPort({authenticatedPost:post,requireSession:async()=>({userId:7})} as never)
  expect((await port.deleteBatch([{recordUid:'a',version:3}],{userId:7} as never)).items[0]?.result).toBe('unknown')
 })
})

import { recordDeletionCapability } from '../src/record-deletion-ref.js'
describe('authoritative deletion capability',()=>{
 const own={userId:7,sourceKind:'private_chat',sourceOwnerRef:'chat',recordUid:'record',recordVersion:3,recordOwnerUserId:7,isMe:true,status:1}
 it('issues the exact owner version',()=>{const ref=recordDeletionCapability(own,'key').recordDeletionRef!;expect(openRecordDeletionRef(ref,'key').recordVersion).toBe(3)})
 it.each([{isMe:false},{recordOwnerUserId:8},{status:2},{recordVersion:0},{recordVersion:1.5},{sourceKind:'agent'},{sourceKind:'bot_subject'}])('does not grant for unsupported or foreign facts %s',override=>{expect(recordDeletionCapability({...own,...override},'key')).toEqual({})})
})
