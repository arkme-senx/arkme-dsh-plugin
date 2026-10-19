import { act, create } from 'react-test-renderer'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:mock.call}))
vi.mock('../src/client/ArkmeDetailShell.js', () => ({ ArkmeDetailShell: ({ children, title }: { children: ReactNode; title: string }) => <section aria-label={title}>{children}</section> }))
import { ArkmeArrangementSources } from '../src/client/ArkmeArrangementSources.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeArrangementEvidence } from '../src/types.js'
import { ArkmeClientError } from '../src/client/api.js'
beforeEach(() => { mock.call.mockReset() })
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

const cloudSource: ArkmeArrangementEvidence = { id: 'e', kind: 'audio_summary', role: 'initial', text: '不能回退展示的旧快照', canOpen: true, readOnExpand: true }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
it('does not fetch protected quotes in collapsed board cards', async () => {
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded={false} />) })
  expect(mock.call).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).not.toContain(cloudSource.text)
  await act(async () => view.unmount())
})
it('loads the exact evidence quote on expand and opens the full source separately', async () => {
  mock.call.mockImplementation(async (op: string) => op === 'arrangements.source.read'
    ? { evidenceId: 'e', state: 'ready', text: '核验后的识别原句' }
    : { kind: 'audio_summary', dateStamp: 1791734400000, tzOffsetMillis: 28800000, summaryId: 'original-version' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded />) })
  expect(mock.call).toHaveBeenCalledWith('arrangements.source.read', { arrangementRef: 'a', evidenceId: 'e' }, expect.any(AbortSignal))
  expect(JSON.stringify(view.toJSON())).toContain('核验后的识别原句')
  expect(JSON.stringify(view.toJSON())).not.toContain(cloudSource.text)
  await act(async () => view.root.findByType('button').props.onClick({ stopPropagation() {} }))
  expect(mock.call).toHaveBeenLastCalledWith('arrangements.source.open', { arrangementRef: 'a', evidenceId: 'e' }, expect.any(AbortSignal))
  await act(async () => view.unmount())
})
it('shows pending state, retries transport failures and never falls back to stale text', async () => {
  const first = deferred<never>()
  mock.call.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('连接暂时中断')).mockResolvedValue({ evidenceId: 'e', state: 'ready', text: '重试后原句' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded />) })
  expect(JSON.stringify(view.toJSON())).toContain('正在读取来源')
  // Changing the arrangement aborts the first pending request and starts the next one.
  await act(async () => view.update(<ArkmeArrangementSources arrangementRef="b" sources={[cloudSource]} expanded />))
  expect(mock.call.mock.calls[0]![2].aborted).toBe(true)
  expect(JSON.stringify(view.toJSON())).toContain('连接暂时中断')
  expect(JSON.stringify(view.toJSON())).not.toContain(cloudSource.text)
  await act(async () => view.root.findByProps({ 'aria-label': '重试读取录音总结来源' }).props.onClick({ stopPropagation() {} }))
  expect(JSON.stringify(view.toJSON())).toContain('重试后原句')
  await act(async () => view.unmount())
})
it('shows a definitive unavailable reason and removes the unusable source link', async () => {
  mock.call.mockResolvedValue({ evidenceId: 'e', state: 'unavailable', reason: '原录音总结已删除或当前无权查看' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded />) })
  expect(JSON.stringify(view.toJSON())).toContain('原录音总结已删除或当前无权查看')
  expect(JSON.stringify(view.toJSON())).not.toContain(cloudSource.text)
  expect(view.root.findAllByType('button')).toHaveLength(0)
  await act(async () => view.unmount())
})
it('discards a late response from a previously selected arrangement', async () => {
  const old = deferred<unknown>()
  mock.call.mockReturnValueOnce(old.promise).mockResolvedValue({ evidenceId: 'e', state: 'ready', text: '当前安排原句' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="old" sources={[cloudSource]} expanded />) })
  await act(async () => view.update(<ArkmeArrangementSources arrangementRef="new" sources={[cloudSource]} expanded />))
  await act(async () => old.resolve({ evidenceId: 'e', state: 'ready', text: '上一个安排原句' }))
  expect(JSON.stringify(view.toJSON())).toContain('当前安排原句')
  expect(JSON.stringify(view.toJSON())).not.toContain('上一个安排原句')
  await act(async () => view.unmount())
})
it('rechecks protected quotes after collapsing and reopening', async () => {
  mock.call.mockResolvedValueOnce({ evidenceId: 'e', state: 'ready', text: '曾经可读' }).mockResolvedValue({ evidenceId: 'e', state: 'unavailable', reason: '现在已删除' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded />) })
  await act(async () => view.update(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded={false} />))
  await act(async () => view.update(<ArkmeArrangementSources arrangementRef="a" sources={[cloudSource]} expanded />))
  expect(mock.call).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(view.toJSON())).not.toContain('曾经可读')
  expect(JSON.stringify(view.toJSON())).toContain('现在已删除')
  await act(async () => view.unmount())
})
it('bounds automatic source reads to two and stops queued work when closed', async () => {
  const requests = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>(), deferred<unknown>()]
  mock.call.mockImplementation((_op: string, { evidenceId }: { evidenceId: string }) => requests[Number(evidenceId)]!.promise)
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={requests.map((_, id) => ({ ...cloudSource, id: String(id) }))} expanded />) })
  expect(mock.call).toHaveBeenCalledTimes(2)
  await act(async () => requests[0]!.resolve({ evidenceId: '0', state: 'ready', text: '第一句' }))
  expect(mock.call).toHaveBeenCalledTimes(3)
  await act(async () => view.unmount())
  expect(mock.call.mock.calls.every(call => call[2].aborted)).toBe(true)
  await act(async () => requests[1]!.resolve({ evidenceId: '1', state: 'ready', text: '已关闭' }))
  expect(mock.call).toHaveBeenCalledTimes(3)
})

const callSources: ArkmeArrangementEvidence[] = ['first', 'second', 'third'].map(id => ({ id, kind: 'call', role: 'initial', canOpen: true, readOnExpand: true }))
const unavailable = () => new ArkmeClientError({ code: 'arrangement-source-unavailable', message: '原通话已删除或当前无权查看', retryable: false })
const sourceTarget = { kind: 'document', title: '已核验来源', text: '后续有效依据' }
function openedEvidence() { return mock.call.mock.calls.filter(([op]) => op === 'arrangements.source.open').map(([, params]) => params.evidenceId) }

it('opens later verified original evidence from a collapsed card and revalidates it on the next click', async () => {
  mock.call.mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable()).mockResolvedValue(sourceTarget)
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={callSources} expanded={false} />) })
  await act(async () => view.root.findByType('button').props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['first', 'second', 'third'])
  expect(JSON.stringify(view.toJSON())).toContain('后续有效依据')
  expect(JSON.stringify(view.toJSON())).not.toContain('原通话已删除')
  const sourceButton = view.root.findAllByType('button').find(button => button.props.className === 'arkme-arrangement-recording-source')!
  await act(async () => sourceButton.props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['first', 'second', 'third', 'third'])
  await act(async () => view.unmount())
})

it('starts with an openable original source instead of an unavailable first row', async () => {
  mock.call.mockResolvedValue(sourceTarget)
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={callSources.map((e,i) => ({ ...e, canOpen: i > 0 }))} expanded={false} />) })
  await act(async () => view.root.findByType('button').props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['second'])
  await act(async () => view.unmount())
})

it('reports all original evidence unavailable without opening supplementary or related material, and retries', async () => {
  mock.call.mockRejectedValue(unavailable())
  let view!: ReturnType<typeof create>
  const sources: ArkmeArrangementEvidence[] = [...callSources, { ...callSources[0]!, id: 'attachment', role: 'related' }, { ...callSources[0]!, id: 'later', role: 'supplement' }]
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={sources} expanded={false} />) })
  await act(async () => view.root.findByType('button').props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['first', 'second', 'third'])
  expect(JSON.stringify(view.toJSON())).toContain('暂未找到可打开的原文，请展开核对来源')
  expect(JSON.stringify(view.toJSON())).not.toContain('原通话已删除')
  mock.call.mockResolvedValue(sourceTarget)
  await act(async () => view.root.findByProps({ role: 'alert' }).findByType('button').props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['first', 'second', 'third', 'first'])
  expect(JSON.stringify(view.toJSON())).toContain('后续有效依据')
  await act(async () => view.unmount())
})

it.each(['auth-http-401', 'arkme-network-error', 'arrangement-source-mismatch'])('stops alternative reads on %s instead of hiding an account, network or identity error', async code => {
  mock.call.mockRejectedValue(new ArkmeClientError({ code, message: '需要重新核验', retryable: true }))
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={callSources} expanded={false} />) })
  await act(async () => view.root.findByType('button').props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['first'])
  expect(JSON.stringify(view.toJSON())).toContain('需要重新核验')
  await act(async () => view.unmount())
})

it('keeps an explicit expanded quote bound to that evidence even when opening it fails', async () => {
  mock.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.source.read') return { evidenceId: params.evidenceId, state: 'ready', text: '已核验原句' }
    throw unavailable()
  })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={callSources} expanded />) })
  await act(async () => view.root.findAllByType('button')[0]!.props.onClick({ stopPropagation() {} }))
  expect(openedEvidence()).toEqual(['first'])
  expect(JSON.stringify(view.toJSON())).toContain('这条通话依据暂未通过核验')
  expect(JSON.stringify(view.toJSON())).not.toContain('原通话已删除')
  await act(async () => view.unmount())
})

it('does not turn an ambiguous call read failure into a deletion claim and allows rechecking', async () => {
  mock.call.mockResolvedValueOnce({ evidenceId: 'first', state: 'unavailable', reason: '原通话已删除或当前无权查看' }).mockResolvedValue({ evidenceId: 'first', state: 'ready', text: '重新核验的原句' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="a" sources={[callSources[0]!]} expanded />) })
  expect(JSON.stringify(view.toJSON())).toContain('这条通话依据暂未通过核验')
  await act(async () => view.root.findByProps({ 'aria-label': '重新核验通话来源' }).props.onClick({ stopPropagation() {} }))
  expect(JSON.stringify(view.toJSON())).toContain('重新核验的原句')
  await act(async () => view.unmount())
})

it('aborts alternative source selection when the arrangement changes', async () => {
  const pending = deferred<unknown>()
  mock.call.mockReturnValue(pending.promise)
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeArrangementSources arrangementRef="old" sources={callSources} expanded={false} />) })
  await act(async () => view.root.findByType('button').props.onClick({ stopPropagation() {} }))
  await act(async () => view.update(<ArkmeArrangementSources arrangementRef="new" sources={callSources} expanded={false} />))
  expect(mock.call.mock.calls[0]![2].aborted).toBe(true)
  await act(async () => pending.resolve(sourceTarget))
  expect(openedEvidence()).toEqual(['first'])
  expect(JSON.stringify(view.toJSON())).not.toContain('后续有效依据')
  await act(async () => view.unmount())
})
