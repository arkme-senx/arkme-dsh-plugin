import { afterEach, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectRecordingDailyMetrics, recordingTextCount } from '../src/recording-daily-metrics.js'
import { parseRecordingStorageMetrics, addRecordingStorageMetrics } from '../src/recording-daily-metrics.js'
import { RecordingDailyMetrics } from '../src/client/recordings/RecordingDailyMetrics.js'
import { ArkmeRecordingTimeline } from '../src/client/recordings/ArkmeRecordingTimeline.js'
import { connectArkmeLocale, type ArkmeLocale } from '../src/client/locale.js'

const setLocale = (active: ArkmeLocale) => connectArkmeLocale({getLocale:()=>({active}),subscribe:()=>()=>{}})()

const start = new Date(2026,8,30).getTime()
const child = { id: 'child', archive_size: 123456, has_asr: true }
const metrics = (children: Array<typeof child>) => projectRecordingDailyMetrics({
  bytes: children.reduce((sum,c)=>sum+(c.has_asr && c.archive_size > 0 ? c.archive_size : 0),0),
  confirmed_count: children.filter(c=>c.has_asr && c.archive_size > 0).length,
  pending_count: children.filter(c=>!c.has_asr).length,
  unknown_count: children.filter(c=>c.has_asr && c.archive_size === 0).length,
}, [{text:'你好 🙂'}])
afterEach(()=>setLocale('zh'))

it('counts Unicode code points without Unicode whitespace, including astral characters',()=>{
  expect(recordingTextCount('中 文\nA\t🙂\u00a0\u3000\u0085\uFEFF')).toBe(4)
  expect(recordingTextCount('e\u0301')).toBe(2)
})
it.each([undefined,null,'1234',-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN])('does not turn invalid owner storage into a confirmed zero: %s',bytes=>{
  expect(parseRecordingStorageMetrics({bytes,confirmed_count:1,pending_count:0,unknown_count:0}).unknown_count).toBe(1)
})
it('keeps exact large totals and identifies aggregate precision overflow',()=>{
  const total={bytes:2**40+123,confirmed_count:1,pending_count:0,unknown_count:0}
  addRecordingStorageMetrics(total,{bytes:20,confirmed_count:1,pending_count:1,unknown_count:2})
  expect(projectRecordingDailyMetrics(total,[{text:'你 🙂'}])).toMatchObject({archiveBytes:2**40+143,confirmedCount:2,pendingCount:1,unknownCount:2,archiveState:'partial',textCount:2})
  addRecordingStorageMetrics(total,{bytes:Number.MAX_SAFE_INTEGER,confirmed_count:1,pending_count:0,unknown_count:0})
  expect(total.bytes).toBe(2**40+143);expect(total.unknown_count).toBe(3)
})
it('keeps silence, unknown and processing distinct',()=>{
  expect(projectRecordingDailyMetrics({bytes:0,confirmed_count:1,pending_count:0,unknown_count:0},[]).archiveState).toBe('ready')
  expect(projectRecordingDailyMetrics(parseRecordingStorageMetrics(undefined),[]).archiveState).toBe('unavailable')
  expect(projectRecordingDailyMetrics({bytes:0,confirmed_count:0,pending_count:1,unknown_count:0},[]).archiveState).toBe('processing')
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
