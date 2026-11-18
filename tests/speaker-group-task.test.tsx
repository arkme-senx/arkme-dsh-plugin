import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn(),toggle:vi.fn(),play:vi.fn(),stop:vi.fn(),locate:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/recordings/useRecordingPlayback.js',()=>({useRecordingPlayback:()=>({toggle:mocks.toggle,playItem:mocks.play,stop:mocks.stop,isLoading:false,isPlaying:false,activeItemRef:'',error:''})}))
vi.mock('../src/client/ui-controller.js',()=>({arkmeUi:{showRecordingTarget:mocks.locate}}))
import {RecentSpeakerGroupJobs,SpeakerGroupTask} from '../src/client/recordings/SpeakerGroupTask.js'
const job={jobRef:'opaque-job',action:'apply' as const,state:'complete' as const,preparedCount:300,totalCount:300,conflictCount:0,conflicts:[]}
const preview={commandRef:'undo-command',affectedCount:300,firstAt:1,lastAt:2,conflictCount:0,conflicts:[],sourceCounts:[300],expiresAt:99999}
let renderer:ReactTestRenderer
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve()}
const click=async(text:string)=>act(async()=>{const b=renderer.root.findAllByType('button').find(b=>b.children.join('')===text);expect(b).toBeTruthy();b!.props.onClick();await tick()})
beforeEach(()=>{vi.clearAllMocks()})
afterEach(async()=>{await act(async()=>renderer?.unmount())})
it('reads persisted completed jobs after mount and previews undo before submitting',async()=>{
 mocks.call.mockImplementation(async(_op,p)=>p.action==='jobs'?{items:[job]}:p.action==='undo-preview'?preview:{...job,action:'undo'})
 await act(async()=>{renderer=create(<RecentSpeakerGroupJobs/>);await tick()})
 expect(renderer.root.findAllByType('summary')[0]!.children.join('')).toBe('最近操作')
 expect(mocks.call).not.toHaveBeenCalled()
 await act(async()=>{renderer.root.findByType('details').props.onToggle({currentTarget:{open:true}});await tick()})
 await click('刷新任务')
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.props['aria-label']?.includes('300'))!.props.onClick();await tick()})
 expect(renderer.root.findAll(n=>n.props['aria-modal']==='true')).toHaveLength(1)
 expect(renderer.root.findAllByType('summary')[0]!.children.join('')).toBe('最近操作')
 await click('预览撤销')
 expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({action:'undo-preview',jobRef:'opaque-job'})
 expect(mocks.call.mock.calls.some(([,p])=>p.action==='undo')).toBe(false)
 await click('确认撤销')
 expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({action:'undo',commandRef:'undo-command'})
})
it('cancels an unfinished durable job but never presents cancellation during atomic publishing',async()=>{
 mocks.call.mockResolvedValue({...job,state:'cancelled'})
 await act(async()=>{renderer=create(<SpeakerGroupTask initialJob={{...job,state:'preparing',preparedCount:20}} onBack={()=>{}}/>);await tick()})
 await click('取消未完成任务')
 expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({action:'cancel',jobRef:'opaque-job'})
 expect(JSON.stringify(renderer.toJSON())).toContain('原归属保留')
 await act(async()=>{renderer.update(<SpeakerGroupTask key="publishing" initialJob={{...job,state:'publishing'}} onBack={()=>{}}/>);await tick()})
 expect(renderer.root.findAllByType('button').some(b=>b.children.join('')==='取消未完成任务')).toBe(false)
})
it('opens an opaque conflict source and offers existing playback and original-location actions',async()=>{
 const row={itemId:'row',itemRef:'opaque-item',startAtMillis:100000,endAtMillis:101000,speakerLabel:'当前人物',text:'需要核对的原文'}
 mocks.call.mockResolvedValue({item:row})
 await act(async()=>{renderer=create(<SpeakerGroupTask targetLabel="张老师" initialPreview={{...preview,commandRef:'',conflictCount:1,conflicts:[{conflictRef:'opaque-conflict'}]}} onBack={()=>{}}/>);await tick()})
 expect(renderer.root.findAllByType('button').find(b=>b.children.join('')==='确认整组保存')!.props.disabled).toBe(true)
 await click('读取冲突片段 1')
 expect(mocks.call.mock.calls.at(-1)?.[1]).toEqual({action:'conflict',conflictRef:'opaque-conflict'})
 expect(JSON.stringify(renderer.toJSON())).toContain('需要核对的原文')
 await click('回听当前片段');expect(mocks.play).toHaveBeenCalledWith(row)
 await click('定位原文');expect(mocks.locate).toHaveBeenCalledWith(expect.any(Number),100000)
})
