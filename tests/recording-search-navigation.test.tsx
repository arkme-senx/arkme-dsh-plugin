import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordingSearchIdentityHash } from '../src/recording-search-version.js'
const mocks = vi.hoisted(() => ({call:vi.fn()}))
vi.mock('../src/client/api.js', async original => ({...await original<typeof import('../src/client/api.js')>(),callArkme:mocks.call}))
import { ArkmeRecordingSurface, ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'
let renderer: ReactTestRenderer | undefined
const target = {sessionId:'s',childId:'c',itemIndex:0,transcriptSource:'system' as const,transcriptVersion:'v'}
afterEach(async () => { await act(async()=>renderer?.unmount());arkmeUi.showRecordings();vi.restoreAllMocks() })
describe('precise recording search navigation',()=>{
  it.each([false,true])('validates the precise day item and never plays (stale=%s)',async stale=>{
    const day = new Date();day.setHours(0,0,0,0)
    mocks.call.mockReset().mockImplementation(async (operation, params)=>{
      if(operation==='recordings.calendar')return {days:[]}
      if(operation==='recordings.day')return {dateStamp:params.dateStamp,totalDurationMillis:1000,
        transcript:{state:'ready',processingCount:0,totalDurationMillis:1000,items:[{itemId:'exact',itemRef:'ref',sessionKey:'opaque',transcriptSource:'system',startAtMillis:day.getTime()+1000,endAtMillis:day.getTime()+2000,speakerKey:'sp',speakerColorIndex:0,speakerLabel:'张三',sameSpeakerItemCount:1,text:'命中',searchIdentityHash:recordingSearchIdentityHash(target),searchVersion:stale?'changed':'v'}]},summary:{state:'empty',items:[]},timeline:{state:'empty',items:[]}}
      throw new Error('unexpected '+operation)
    })
    arkmeUi.showRecordingTarget(day.getTime(),day.getTime()+1000,target)
    await act(async()=>{renderer=create(<ArkmeRecordingSurface onOpenRecordingImport={()=>{}} recordingRefreshRevision={0}/>);await new Promise(resolve=>setTimeout(resolve,10))})
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
    if(stale)expect(JSON.stringify(renderer!.toJSON())).toContain('该转写条目已更新或不可用')
    else expect(renderer!.root.findByType(ArkmeRecordingTranscriptRow).props.selected).toBe(true)
    expect(mocks.call.mock.calls.some(([operation])=>operation==='recordings.playback.open')).toBe(false)
  })
})
