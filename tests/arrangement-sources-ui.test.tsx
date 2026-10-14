import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:mock.call}))
import { ArkmeArrangementSources } from '../src/client/ArkmeArrangementSources.js'
import { arkmeUi } from '../src/client/ui-controller.js'
it('opens the verified historical summary version and separates later attachments',async()=>{
  mock.call.mockResolvedValue({kind:'audio_summary',dateStamp:1791734400000,tzOffsetMillis:28800000,summaryId:'original-version'})
  let view!:ReturnType<typeof create>
  await act(async()=>{view=create(<ArkmeArrangementSources arrangementRef="arr" expanded sources={[{id:'e',kind:'audio_summary',role:'initial',text:'识别原文',canOpen:true},{id:'r',kind:'record',role:'related',text:'后加资料',canOpen:true}]}/> )})
  expect(JSON.stringify(view.toJSON())).toContain('关联资料')
  const button=view.root.findAllByType('button')[0]!
  await act(async()=>button.props.onClick({stopPropagation(){}}))
  expect(mock.call).toHaveBeenCalledWith('arrangements.source.open',{arrangementRef:'arr',evidenceId:'e'},expect.any(AbortSignal))
  expect(arkmeUi.getSnapshot().recordingTarget?.summary?.versionId).toBe('original-version')
  await act(async()=>view.unmount())
})
it('shows unavailable reasons without offering a guessed destination',async()=>{
  let view!:ReturnType<typeof create>
  await act(async()=>{view=create(<ArkmeArrangementSources arrangementRef="arr" expanded sources={[{id:'e',kind:'call',role:'initial',text:'来源文字',canOpen:false,unavailableReason:'历史记录未保存定位信息'}]}/>)})
  expect(view.root.findAllByType('button')).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('历史记录未保存定位信息')
  await act(async()=>view.unmount())
})
