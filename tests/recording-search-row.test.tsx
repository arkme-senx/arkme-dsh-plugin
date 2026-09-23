import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordingSearchRow } from '../src/client/recordings/RecordingSearchRow.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeRecordingSearchItem, ArkmeRecordingSearchSegment } from '../src/types.js'
const segment = (itemIndex: number, text: string, label: string): ArkmeRecordingSearchSegment => ({sessionId:itemIndex === 1 ? 's' : `neighbor-${itemIndex}`,childId:'c',itemIndex,transcriptSource:'system',transcriptVersion:'v',startAtMillis:1000+itemIndex*1000,endAtMillis:2000+itemIndex*1000,text,speaker:{speakerId:label,label,colorIndex:itemIndex}})
const item: ArkmeRecordingSearchItem = {sessionId:'s',dateStamp:0,startAtMillis:2000,snippet:'😀命中',score:1,previous:segment(0,'上一条完整内容','张三'),match:segment(1,'😀命中','李四'),next:segment(2,'下一条完整内容'.repeat(300),'王五'),highlightRanges:[{start:1,length:2}]}
describe('recording search rows',()=>{
  it('renders independent complete transcript lines and highlights only the match with rune indices',()=>{
    const html = renderToStaticMarkup(<RecordingSearchRow item={item}/> )
    expect(html.match(/data-recording-search-segment=/g)).toHaveLength(3)
    expect(html.match(/<time/g)).toHaveLength(4)
    expect(html).toContain('data-recording-search-group-time="true"')
    expect(html.indexOf('data-recording-search-group-time')).toBeLessThan(html.indexOf('data-recording-search-segment'))
    expect(html).toContain(new Date(item.startAtMillis).toLocaleString())
    expect(html).toContain('张三');expect(html).toContain('李四');expect(html).toContain('王五')
    expect(html).toContain(item.next!.text)
    expect(html).toMatch(/😀<mark[^>]*>命中<\/mark>/)
    expect(html).not.toContain('line-clamp')
  })
  it('routes the whole result to the match including version without starting playback',()=>{
    const show = vi.spyOn(arkmeUi,'showRecordingTarget').mockImplementation(()=>{})
    const row = RecordingSearchRow({item})
    row.props.onClick()
    expect(show).toHaveBeenCalledExactlyOnceWith(0,2000,item.match)
    show.mockRestore()
  })
})
