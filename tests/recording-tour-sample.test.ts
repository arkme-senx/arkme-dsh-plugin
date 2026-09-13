import { expect, it } from 'vitest'
import { recordingTourSample as day } from '../src/client/recordings/recording-tour-sample.js'
it('provides a coherent full-day sample with six speakers and matching timeline evidence', () => {
 const items = day.transcript.items
 expect(items).toHaveLength(30)
 expect(new Set(items.map(item => item.speakerKey)).size).toBe(6)
 expect(items.at(-1)!.endAtMillis-items[0]!.startAtMillis).toBe(12.5*60*60*1000)
 expect(day.totalDurationMillis).toBe(items.reduce((total,item)=>total+item.endAtMillis-item.startAtMillis,0))
 const events=day.timeline.items[0]!.timelineEvents
 expect(events).toHaveLength(6)
 for (const event of events) {
  const evidence=items.filter(item=>event.rawText.includes(item.text))
  expect(evidence).toHaveLength(5)
  expect(new Set(event.participants)).toEqual(new Set(evidence.map(item=>item.speakerLabel)))
 }
 const summary=day.summary.items[0]!.content
 expect(summary).toContain('我的这一天')
 expect(summary).toContain('一、今日概览')
 expect(summary).toContain('二、关键事件')
})
