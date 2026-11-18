import { expect, it, vi } from 'vitest'
import { RecordingService } from '../src/services/recording-service.js'

it.each([false,true])('continues the exact accepted civil day without local reinterpretation (window=%s)', async explicitWindow => {
  const window={date:'2026-03-08',timeZone:'America/New_York',dateStamp:Date.parse('2026-03-08T00:00:00-05:00'),endStamp:Date.parse('2026-03-09T00:00:00-04:00')}
  const id='a'.repeat(24), calls: {path:string;body:Record<string,unknown>}[]=[]
  const post=vi.fn(async(path:string,body:Record<string,unknown>)=>{
    calls.push({path,body})
    if(path.endsWith('/continue'))return {accepted:true,summary_id:id}
    if(path.endsWith('/list-timeline-by-range'))return {audio_summary_ls:[{id,status:1,kind:2,date_stamp:window.dateStamp,create_at:window.dateStamp,update_at:window.dateStamp,generation_stage:1}]}
    throw new Error('continuation must not read models or transcript')
  })
  const runtime={config:{environment:'test',recordingWorkbenchEnabled:true},subscribeAccountScope:()=>()=>{},requireSession:async()=>({userId:11,accessToken:'synthetic',refreshToken:'synthetic'}),authenticatedAudioPost:post}
  const service=new RecordingService(runtime as never,{} as never)
  const result=await service.recordingAnalysis({action:'continue',kind:'summary',accountScope:'test:11',versionId:id,dateStamp:explicitWindow?new Date(2026,2,8).getTime():window.dateStamp,...(explicitWindow?{window}:{})})
  expect(calls[0]).toEqual({path:'/api/v1/summary/continue',body:{summary_id:id,kind:2,date_stamp:window.dateStamp}})
  expect(calls[1]?.body).toMatchObject({date_stamp:window.dateStamp,from_stamp:window.dateStamp})
  if(explicitWindow)expect(calls[1]?.body.to_stamp).toBe(window.endStamp)
  expect('section' in result && result.section.state).toBe('processing')
  service.dispose()
})
