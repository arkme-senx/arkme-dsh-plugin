import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
it('shares time-ordered edits and recovery with the Host without requiring a version', async () => {
 const owner = { recordReeditEditor: vi.fn(async () => ({itemUid:'record'})), submitRecordReedit:vi.fn(async(_input:unknown)=>({submissionId:'revision',state:'pending'})), recordReeditSubmissions:vi.fn(async()=>[]), resumeRecordReeditSubmissions:vi.fn(async()=>{}) }
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
  const {operation,params}=JSON.parse(String(init?.body))
  const value=operation==='provider.capabilities'?{contractVersion:1,features:{recordReeditTimeOrderedV1:true}}:await dispatchArkmeHostOperation(owner as never,operation,params,undefined,undefined,undefined,undefined,init?.signal??undefined)
  return new Response(JSON.stringify({ok:true,value}))
 }})
 try {
  await sdk.recordReeditDetail('source','record')
  await sdk.submitRecordReedit({sourceRef:'source',itemUid:'record',newText:'updated',attachments:[],capture:{completedAtMillis:1700000000000,captureContext:{}}})
  expect(owner.submitRecordReedit).toHaveBeenCalledWith(expect.objectContaining({itemUid:'record',newText:'updated',attachments:[]}))
  expect(owner.submitRecordReedit.mock.calls[0]![0]).not.toHaveProperty('expectedVersion')
  await sdk.resumeRecordReeditSubmissions('source',true)
  expect(owner.resumeRecordReeditSubmissions).toHaveBeenCalledWith('source',true)
  expect(await sdk.recordReeditSubmissions('source')).toEqual([])
  const controller=new AbortController();controller.abort()
  await expect(sdk.submitRecordReedit({sourceRef:'source',itemUid:'record',newText:'cancelled'},controller.signal)).rejects.toBeDefined()
  expect(owner.submitRecordReedit).toHaveBeenCalledTimes(1)
 }finally{sdk.dispose()}
})
it('does not attempt writes against a Provider without the time-ordered edit contract',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}})))
 const sdk=createArkmeSdk({fetchImpl})
 try{await expect(sdk.submitRecordReedit({sourceRef:'source',itemUid:'record',newText:'updated'})).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}});expect(fetchImpl).toHaveBeenCalledTimes(1)}finally{sdk.dispose()}
})
