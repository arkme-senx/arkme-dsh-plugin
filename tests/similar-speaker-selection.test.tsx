import { ArkmeClientError } from '../src/sdk/index.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { person } from './helpers/speaker-directory.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { SimilarSpeakerSelection } from '../src/client/recordings/SimilarSpeakerSelection.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const row = (id: string, day: number): ArkmeRecordingWorkbenchItem => ({ itemId: id, itemRef: `ref-${id}`, transcriptSource: 'system', sessionKey: id, speakerKey: id, speakerLabel: id, speakerColorIndex: 1, speakerNumber: 1, sameSpeakerItemCount: 1, text: id, startAtMillis: new Date(2026, 10, day).getTime(), endAtMillis: new Date(2026, 10, day).getTime() + 1000, isSelf: false, isBackground: false })
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
let renderer: ReactTestRenderer
const click = async (text: string) => { await act(async () => { renderer.root.findAllByType('button').find(button => button.children.join('') === text)!.props.onClick(); await tick() }) }
const writes = () => mocks.call.mock.calls.filter(([op]) => op === 'recordings.speaker.correction.apply')
beforeEach(() => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  mocks.call.mockReset().mockImplementation(async (op, input) => {
    if (op === 'speaker-directory.group-members') return { items: [row(input.detailRef, input.detailRef === person('a').detailRef ? 1 : 2)], snapshotRef: `snapshot-${input.detailRef}`, totalCount: 250, firstAt: 1, lastAt: 2, requiresReview: false }
    if (op === 'speaker-directory.correction-items') return { items: [row(input.detailRef, input.detailRef === person('a').detailRef ? 1 : 2)] }
    if (op === 'recordings.speaker.correction.context') return { supported: true, version: 'v1', maxItems: 100, excludedSpeakers: [], soundSource: 'unknown' }
    if (op === 'recordings.speaker.correction.preview') return { affectedCount: input.itemRefs.length, intentToken: 'signed' }
    if (op === 'recordings.speaker.correction.apply') return { affectedCount: input.itemRefs.length, version: 'v2', undoRef: 'undo' }
    if (op === 'recordings.speaker.correction.result') return null
    if (op === 'speaker-directory.open') return { type: 'candidate', candidateRef: 'anchor' }
    if (op === 'recordings.speaker.correction.undo') return { affectedCount: 1, version: 'v3' }
  })
})
afterEach(async () => { await act(async () => renderer?.unmount()) })
it('requires individual fragment selection and signed preview, then retries an unknown result with the same key', async () => {
  await act(async () => { renderer = create(<SimilarSpeakerSelection people={[person('a'), person('b')]} assignment={{ kind: 'anonymous' }} onBack={() => {}} />); await tick() })
  expect(renderer.root.findAllByType('input').filter(input => input.props.type === 'checkbox').every(input => !input.props.checked)).toBe(true)
  await act(async () => { renderer.root.findAllByType('input').filter(input => input.props.type === 'checkbox')[1]!.props.onChange({ target: { checked: true } }); await tick() })
  await click('核实所选范围'); await click('预览纠错')
  expect(writes()).toHaveLength(0)
  const original = mocks.call.getMockImplementation()!
  let lost = true
  mocks.call.mockImplementation((op, input, signal) => op === 'recordings.speaker.correction.apply' && lost ? (lost = false, Promise.reject(new Error('响应丢失'))) : original(op, input, signal))
  await click('确认保存'); const first = writes()[0]![1]
  expect(first).toMatchObject({ itemRefs: [`ref-${person('b').detailRef}`], crossDateSelection: true, target: { kind: 'anonymous' }, detach: false, intentToken: 'signed' })
  await click('重新读取状态'); await click('确认保存')
  expect(writes()[1]![1]).toEqual(first)
  await click('预览撤销')
  expect(mocks.call.mock.calls.some(([op]) => op === 'recordings.speaker.correction.undo')).toBe(false)
  expect(renderer.root.findByProps({ 'aria-label': '撤销影响预览' })).toBeDefined()
  await click('确认撤销')
  expect(mocks.call.mock.calls.some(([op]) => op === 'recordings.speaker.correction.undo')).toBe(true)
})
it('resolves anonymous exclusion from a bounded anchor and never sends detach or a target', async () => {
  await act(async () => { renderer = create(<SimilarSpeakerSelection people={[person('b')]} rejectedPerson={person('a')} onBack={() => {}} />); await tick() })
  await act(async () => { renderer.root.findAllByType('input').filter(input => input.props.type === 'checkbox')[0]!.props.onChange({ target: { checked: true } }); await tick() })
  await click('核实所选范围'); await click('预览纠错'); await click('确认保存')
  expect(writes()[0]![1]).toMatchObject({ rejectedCandidateItemRef: `ref-${person('a').detailRef}`, detach: false })
  expect(writes()[0]![1]).not.toHaveProperty('target')
})

it('preserves an existing formal candidate assignment when excluding a formal anchor', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, input, signal) => op === 'speaker-directory.open' ? Promise.resolve({ type: 'speaker', speakerRef: 'formal-anchor' }) : original(op, input, signal))
  await act(async () => { renderer = create(<SimilarSpeakerSelection people={[{ ...person('b'), type: 'marked' }]} rejectedPerson={{ ...person('a'), type: 'marked' }} onBack={() => {}} />); await tick() })
  await act(async () => { renderer.root.findAllByType('input').filter(input => input.props.type === 'checkbox')[0]!.props.onChange({ target: { checked: true } }); await tick() })
  await click('核实所选范围'); await click('预览纠错'); await click('确认保存')
  expect(writes()[0]![1]).toMatchObject({ rejectedSpeakerRef: 'formal-anchor', preserveAssignment: true, detach: false })
  expect(writes()[0]![1]).not.toHaveProperty('target')
})


it('drops a definitively rejected signed preview and permits a new preview instead of claiming unknown outcome', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, input, signal) => op === 'recordings.speaker.correction.apply' ? Promise.reject(new ArkmeClientError({ code: 'recording-correction-rejected', message: '范围已变化', retryable: false })) : original(op, input, signal))
  await act(async () => { renderer = create(<SimilarSpeakerSelection people={[person('a')]} assignment={{ kind: 'anonymous' }} onBack={() => {}} />); await tick() })
  await act(async () => { renderer.root.findAllByType('input').filter(input => input.props.type === 'checkbox')[0]!.props.onChange({ target: { checked: true } }); await tick() })
  await click('核实所选范围'); await click('预览纠错'); await click('确认保存')
  expect(renderer.root.findAllByType('button').some(button => button.children.join('') === '确认保存')).toBe(false)
  expect(JSON.stringify(renderer.toJSON())).toContain('本次操作未保存')
  const previewButton = renderer.root.findAllByType('button').find(button => button.children.join('') === '预览纠错')!
  expect(previewButton.props.disabled).toBe(false)
  await click('预览纠错')
  const previews = mocks.call.mock.calls.filter(([op]) => op === 'recordings.speaker.correction.preview')
  expect(previews).toHaveLength(2)
  expect(previews[1]![1].idempotencyKey).not.toBe(previews[0]![1].idempotencyKey)
})

it('requires explicit whole scope and displays backend total plus the exact target before saving', async () => {
 const original=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation((op,input,signal)=>op==='speaker-directory.group-action'?Promise.resolve(input.action==='preview'?{commandRef:'whole-command',affectedCount:450,firstAt:1,lastAt:2,sourceCounts:[250,250],conflictCount:0,conflicts:[],expiresAt:99999}:{jobRef:'job',action:'apply',state:'complete',preparedCount:450,totalCount:450,conflictCount:0,conflicts:[]}):original(op,input,signal))
 await act(async()=>{renderer=create(<SimilarSpeakerSelection people={[person('a'),person('b')]} assignment={{kind:'directory',person:person('target',{type:'marked',displayName:'王老师'})}} onBack={()=>{}}/>);await tick()})
 expect(mocks.call.mock.calls.some(([op])=>op==='speaker-directory.group-action')).toBe(false)
 await act(async()=>{renderer.root.findAllByType('input').filter(x=>x.props.type==='radio')[1]!.props.onChange();await tick()})
 expect(renderer.root.findAllByType('input').filter(x=>x.props.type==='checkbox').every(x=>x.props.disabled)).toBe(true)
 expect(JSON.stringify(renderer.toJSON())).toContain('2000')
 await click('预览完整分组范围')
 expect(JSON.stringify(renderer.toJSON())).toContain('王老师');expect(JSON.stringify(renderer.toJSON())).toContain('450')
 const preview=mocks.call.mock.calls.find(([op,p])=>op==='speaker-directory.group-action'&&p.action==='preview')![1]
 expect(preview.snapshots).toEqual(['snapshot-detail-a','snapshot-detail-b'])
 expect(preview).not.toHaveProperty('itemRefs')
 expect(mocks.call.mock.calls.some(([,p])=>p.action==='apply')).toBe(false)
 await click('确认整组保存')
 expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({action:'apply',commandRef:'whole-command'})
})
it('blocks whole commands for mixed groups while preserving explicit subset selection',async()=>{
 const original=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,input,signal)=>{const result=await original(op,input,signal);return op==='speaker-directory.group-members'?{...result,requiresReview:true}:result})
 await act(async()=>{renderer=create(<SimilarSpeakerSelection people={[person('mixed')]} assignment={{kind:'anonymous'}} onBack={()=>{}}/>);await tick()})
 await act(async()=>{renderer.root.findAllByType('input').filter(x=>x.props.type==='radio')[1]!.props.onChange();await tick()})
 expect(renderer.root.findAllByType('button').find(b=>b.children.join('')==='预览完整分组范围')!.props.disabled).toBe(true)
 expect(JSON.stringify(renderer.toJSON())).toContain('混合或待确认')
 await act(async()=>{renderer.root.findAllByType('input').filter(x=>x.props.type==='radio')[0]!.props.onChange();await tick()})
 await act(async()=>{renderer.root.findAllByType('input').filter(x=>x.props.type==='checkbox')[0]!.props.onChange({target:{checked:true}});await tick()})
 expect(renderer.root.findAllByType('button').find(b=>b.children.join('')==='核实所选范围')!.props.disabled).toBe(false)
})
it('retries failed initial member loading without leaving the selection dialog',async()=>{
 mocks.call.mockRejectedValueOnce(new Error('成员读取失败'))
 await act(async()=>{renderer=create(<SimilarSpeakerSelection people={[person('a')]} assignment={{kind:'anonymous'}} onBack={()=>{}}/>);await tick()})
 expect(JSON.stringify(renderer.toJSON())).toContain('成员读取失败')
 await click('重新读取成员')
 expect(renderer.root.findAllByType('input').filter(x=>x.props.type==='checkbox')).toHaveLength(1)
 expect(mocks.call.mock.calls.filter(([op])=>op==='speaker-directory.group-members')).toHaveLength(2)
})
it('shows full coverage and suspicious evidence while preserving the selected subset during local review sorting',async()=>{
 const original=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,input,signal)=>op==='speaker-directory.group-members'?{
  items:[row('known',1),row('outlier',2)],snapshotRef:'snapshot',totalCount:2,firstAt:1,lastAt:2,requiresReview:true,
  consistency:{state:'ready',score:50,analyzedCount:2,totalCount:2,reviewCount:1},scoreDefinition:'cohesion-v1',
  evidence:[{itemRef:'ref-known',state:'ready',deviation:0},{itemRef:'ref-outlier',state:'ready',deviation:1}]
 }:original(op,input,signal))
 await act(async()=>{renderer=create(<SimilarSpeakerSelection people={[person('a')]} assignment={{kind:'anonymous'}} onBack={()=>{}}/>);await tick()})
 expect(JSON.stringify(renderer.toJSON())).toContain('已分析 2 / 2 段')
 const checks=renderer.root.findAllByType('input').filter(x=>x.props.type==='checkbox')
 expect(checks[0]!.props['aria-label']).toContain('outlier')
 await act(async()=>{checks[0]!.props.onChange({target:{checked:true}});await tick()})
 expect(JSON.stringify(renderer.toJSON())).toContain('偏离距离：1.000')
 expect(renderer.root.findAllByType('button').some(b=>b.children.join('')==='试听')).toBe(true)
})

it('opens an explicit sentence subrange from complete member review without writing',async()=>{
 await act(async()=>{renderer=create(<SimilarSpeakerSelection people={[person('a')]} assignment={{kind:'anonymous'}} onBack={()=>{}}/>);await tick()})
 await click('句内拆分')
 expect(renderer.root.findAllByType('input').some(x=>x.props['aria-label']==='起点（秒）')).toBe(true)
 expect(writes()).toHaveLength(0)
})
