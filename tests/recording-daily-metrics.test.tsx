import { afterEach, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectRecordingDailyMetrics, recordingTextCount } from '../src/recording-daily-metrics.js'
import { projectRecordingTranscripts } from '../src/recording-presentation.js'
import { RecordingDailyMetrics } from '../src/client/recordings/RecordingDailyMetrics.js'
import { ArkmeRecordingTimeline } from '../src/client/recordings/ArkmeRecordingTimeline.js'
import { connectArkmeLocale, type ArkmeLocale } from '../src/client/locale.js'

const setLocale = (active: ArkmeLocale) => connectArkmeLocale({getLocale:()=>({active}),subscribe:()=>()=>{}})()

const start = new Date(2026,8,30).getTime(), end = start+86400000
const session = {id:'session',belong_usr:42,start_at:start,end_at:end,spk_ls:[{num:1,spk_id:'person'},{num:2,spk_id:'person'}]}
const child = {id:'child',session_id:'session',start_at:0,duration:60000,has_asr:true,archive_size:123456,source_size:999999,size:888888,asr:[{s:0,e:1000,n:1,t:'你好 🙂'}]}
const metrics = (children:unknown[],sessions:unknown[]=[session]) => {
  const response={session_ls:sessions,child_ls:children}
  return projectRecordingDailyMetrics(response,projectRecordingTranscripts(response,[],new Map(),{viewerUserId:42,dayStartMillis:start,dayEndMillis:end}),42,start,end)
}
afterEach(()=>setLocale('zh'))

it('uses only VAD archive bytes and final deduplicated text; merged people retain both utterances',()=>{
  const response={...child,asr:[...child.asr,{s:2000,e:3000,n:2,t:'再见'}]}
  expect(metrics([response,response])).toEqual({archiveBytes:123456,archiveState:'ready',confirmedCount:1,pendingCount:0,unknownCount:0,textCount:5})
})
it('counts Unicode code points without Unicode whitespace, including astral characters',()=>{
  expect(recordingTextCount('中 文\nA\t🙂\u00a0\u3000\u0085\uFEFF')).toBe(4)
  expect(recordingTextCount('e\u0301')).toBe(2)
})
it('distinguishes silent zero, historical unknown zero and incomplete ASR',()=>{
  expect(metrics([{...child,archive_size:0,asr:[]}])).toMatchObject({archiveState:'ready',archiveBytes:0,confirmedCount:1})
  expect(metrics([{...child,archive_size:0}])).toMatchObject({archiveState:'unavailable',unknownCount:1,textCount:3})
  expect(metrics([{...child,has_asr:false,archive_size:0,asr:[]}])).toMatchObject({archiveState:'processing',pendingCount:1,confirmedCount:0})
  expect(metrics([child,{...child,id:'pending',start_at:60000,has_asr:false,asr:[]}, {...child,id:'old',start_at:120000,archive_size:0}])).toMatchObject({archiveState:'partial',archiveBytes:123456,pendingCount:1,unknownCount:1})
})
it.each([undefined,null,'1234',-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN])('never coerces an invalid archive size to zero: %s',archive_size=>{
  expect(metrics([{...child,archive_size}])).toMatchObject({archiveState:'unavailable',confirmedCount:0,unknownCount:1})
})
it('supports large int64 values within safe precision and never overflows a sum',()=>{
  expect(metrics([{...child,archive_size:2**40+123}]).archiveBytes).toBe(2**40+123)
  expect(metrics([{...child,archive_size:Number.MAX_SAFE_INTEGER},{...child,id:'second',start_at:60000}])).toMatchObject({archiveState:'partial',unknownCount:1,archiveBytes:Number.MAX_SAFE_INTEGER})
})
it('keeps account ownership separate from who spoke or uploaded',()=>{
  const other={...session,id:'other',belong_usr:99,user_id:42}
  expect(metrics([child,{...child,id:'foreign',session_id:'other'}],[session,other])).toMatchObject({archiveBytes:123456,confirmedCount:1,textCount:3})
  expect(metrics([child],[{...session,belong_usr:0}])).toMatchObject({archiveBytes:0,confirmedCount:0,textCount:3})
  expect(metrics([child],[{...session,belong_usr:undefined}])).toMatchObject({archiveState:'unavailable',textCount:3})
  expect(metrics([child],[{...session,belong_usr:-1}]).archiveState).toBe('unavailable')
})
it('retains cross-midnight session mappings but never prorates a cross-day archive',()=>{
  const cross={...session,start_at:start-60000,end_at:start+180000}
  expect(metrics([{...child,start_at:60000}],[cross])).toMatchObject({archiveState:'ready',archiveBytes:123456,textCount:3})
  expect(metrics([{...child,start_at:30000}],[cross])).toMatchObject({archiveState:'unavailable',unknownCount:1})
  expect(metrics([{...child,start_at:end-1000,duration:2000}])).toMatchObject({archiveState:'unavailable',unknownCount:1})
  expect(metrics([{...child,start_at:end}])).toMatchObject({archiveBytes:0,textCount:0,confirmedCount:0})
})
it('does not confuse a missing payload or missing physical children with an empty day',()=>{
  expect(projectRecordingDailyMetrics({},[],42,start,end).archiveState).toBe('unavailable')
  expect(metrics([])).toMatchObject({archiveState:'unavailable',unknownCount:1})
  expect(metrics([],[{...session,end_at:undefined,duration:60000}]).archiveState).toBe('unavailable')
  expect(projectRecordingDailyMetrics({session_ls:[],child_ls:[]},[],0,start,end).archiveState).toBe('unavailable')
  expect(metrics([],[])).toMatchObject({archiveState:'ready',archiveBytes:0,textCount:0})
})
it('deduplicates physical children using the latest available revision',()=>{
  expect(metrics([child,{...child,upload_at:start,archive_size:9876}]).archiveBytes).toBe(9876)
  expect(metrics([{...child,upload_at:start,archive_size:9876},child]).archiveBytes).toBe(9876)
})
it('shows compact confirmed totals and separates partial and pending statuses',()=>{
  const complete=renderToStaticMarkup(<RecordingDailyMetrics metrics={metrics([child])}/>)
  expect(complete).toContain('人声存储 120.6 KB');expect(complete).toContain('转写 3 字')
  const partial=renderToStaticMarkup(<RecordingDailyMetrics metrics={metrics([child,{...child,id:'old',archive_size:0}])} localPending/>)
  expect(partial).toContain('（已确认）');expect(partial).toContain('部分大小暂不可确认');expect(partial).toContain('处理中，统计待更新')
  const legacy=renderToStaticMarkup(<RecordingDailyMetrics/>)
  expect(legacy).toContain('暂不可用');expect(legacy).not.toContain('0 B')
  const loading=renderToStaticMarkup(<RecordingDailyMetrics metrics={metrics([child])} loading/>)
  expect(loading).not.toContain('120.6');expect(loading).toContain('转写 — 字')
})
it('shows per-person characters in the existing speaker panel without attributing background text',()=>{
  const base={speakerKey:'same',speakerLabel:'张三',speakerColorIndex:0,startAtMillis:start,endAtMillis:start+1000,text:'你好🙂',isBackground:false}
  const items=[base,{...base,startAtMillis:start+2000,endAtMillis:start+3000,text:'再见'},{...base,speakerKey:'background',isBackground:true,text:'背景音'}] as never
  const html=renderToStaticMarkup(<ArkmeRecordingTimeline items={items} dailyMetrics={metrics([child])} isPlaying={false} onSelectAtMillis={()=>{}} onTogglePlayback={()=>{}}/>)
  expect(html).toContain('转写 5 字');expect(html).not.toContain('转写 8 字')
})
it('localizes the new compact statistics',()=>{
  setLocale('en')
  const html=renderToStaticMarkup(<RecordingDailyMetrics metrics={metrics([{...child,has_asr:false}])}/>)
  expect(html).toContain('Speech storage Unavailable');expect(html).toContain('Processing; metrics will update');expect(html).not.toContain('处理中')
})
