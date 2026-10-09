import { afterEach, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
import { addRecordingAsrInputMetrics,parseRecordingAsrInputMetrics,projectSemanticAsrInputMetrics,type RecordingAsrInputMetrics } from '../src/recording-asr-input-metrics.js'
import { RecordingDailyMetrics } from '../src/client/recordings/RecordingDailyMetrics.js'
import { connectArkmeLocale } from '../src/client/locale.js'
const input=(duration_ms:number,extra:Partial<RecordingAsrInputMetrics>={}):RecordingAsrInputMetrics=>({duration_ms,confirmed_count:1,pending_count:0,unknown_count:0,estimated_count:0,...extra})
const daily=(ms:number,extra:Partial<RecordingAsrInputMetrics>={})=>projectRecordingDailyMetrics({bytes:0,confirmed_count:0,pending_count:0,unknown_count:1},[],input(ms,extra))
afterEach(() => connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })())
it.each([undefined,null,{},[],false,input(-1),input(NaN),input(Number.MAX_SAFE_INTEGER+1),input(1,{confirmed_count:0}),input(0,{estimated_count:2}),{...input(0),pending_count:'1'}])('treats malformed or missing owner evidence as unavailable: %j',value=>{
 expect(projectSemanticAsrInputMetrics(parseRecordingAsrInputMetrics(value))).toMatchObject({asrInputState:'unavailable',asrInputDurationMillis:0,asrInputUnknownCount:1})
})
it('keeps model input independent of archive coverage and displayed transcript pages',()=>{
 const value=daily(1000)
 expect(value).toMatchObject({archiveState:'unavailable',asrInputState:'ready',asrInputDurationMillis:1000,textCount:0})
 expect(daily(0)).toMatchObject({asrInputState:'ready',asrInputConfirmedCount:1,asrInputDurationMillis:0})
 expect(projectSemanticAsrInputMetrics(input(0,{confirmed_count:0}))).toMatchObject({asrInputState:'ready',asrInputDurationMillis:0})
})
it('adds owner totals once per recording and rejects unsafe sums',()=>{
 const total=input(6000);addRecordingAsrInputMetrics(total,input(8000,{pending_count:1}))
 expect(projectSemanticAsrInputMetrics(total)).toMatchObject({asrInputDurationMillis:14000,asrInputConfirmedCount:2,asrInputPendingCount:1,asrInputState:'processing'})
 addRecordingAsrInputMetrics(total,input(Number.MAX_SAFE_INTEGER))
 expect(projectSemanticAsrInputMetrics(total)).toMatchObject({asrInputDurationMillis:14000,asrInputState:'partial',asrInputUnknownCount:1})
})
it('keeps observed totals visible while the current execution is pending',()=>{
 const rendered=renderToStaticMarkup(<RecordingDailyMetrics metrics={daily(4000,{pending_count:1})}/>)
 expect(rendered).toContain('转写输入时长 4秒（已确认）');expect(rendered).toContain('处理中，统计待更新')
})
it('renders precise duration, localized states and no stale values during loading', () => {
  const value = daily(6000)
  const ready = { ...value, asrInputDurationMillis: 8316000 }
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('转写输入时长 2小时18分36秒')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('缺少可靠记录的历史输入时长暂不可用')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={{ ...ready, asrInputDurationMillis: 500 }}/>)).toContain('不足1秒')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready} loading/>)).toContain('转写输入时长 —')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready} loading/>)).not.toContain('2小时')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready} localPending/>)).toContain('2小时18分36秒（已确认）')
  expect(renderToStaticMarkup(<RecordingDailyMetrics/>)).toContain('转写输入时长 暂不可用')
  const partial = renderToStaticMarkup(<RecordingDailyMetrics metrics={{ ...value, asrInputState: 'partial', asrInputUnknownCount: 1 }}/>)
  expect(partial).toContain('转写输入时长 6秒（已确认）')
  expect(partial).toContain('部分转写输入时长暂不可确认')
  connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} })()
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('ASR input 2h 18m 36s')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('Historical input without reliable records is unavailable')
})

it('preserves partial attempt totals and clearly labels historical estimates', () => {
  const value = daily(8000, {confirmed_count:2, estimated_count:1})
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={value}/>)).toContain('转写输入时长 约8秒（含估算）')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={value} localPending/>)).toContain('约8秒（部分，含估算）')
})
