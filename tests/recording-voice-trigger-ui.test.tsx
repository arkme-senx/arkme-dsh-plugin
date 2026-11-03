// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => api)
vi.mock('../src/client/recordings/ArkmeRecordingSpeakerEditor.js', () => ({ ArkmeRecordingSpeakerEditor: () => <div>单独标记说话人</div> }))
import { RecordingVoiceTriggerDialog } from '../src/client/recordings/RecordingVoiceTriggers.js'
import { defaultRecordingVoiceRule, type RecordingVoiceCandidate } from '../src/recording-voice-trigger-contract.js'
let root: Root, holder: HTMLDivElement, available = true
const accountKey = 'prod:7', onClose = vi.fn()
const hit = (speaker: RecordingVoiceCandidate['speaker'], status: RecordingVoiceCandidate['status'] = 'pending'): RecordingVoiceCandidate => ({ candidateKey: speaker, candidateRef: `opaque-${speaker}`, revision: 1, phrase: '帮我记一下', text: `${speaker}的记事`, speaker, speakerLabel: speaker === 'unknown' ? '未识别说话人' : '其他人', status, boundary: 'complete', startAtMillis: 1000, endAtMillis: 2000, evidence: { kind: 'transcript', model: 'test', match: 'literal' } })
const buttons = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent === label)
const click = async (node: HTMLElement) => act(async () => { node.click() })
beforeEach(() => {
  available = true; onClose.mockClear()
  api.callArkme.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'recordings.voice-triggers.rules.set') return { accountKey, available, revision: 2, rules: params.rules, draft: { revision: 1, rules: params.rules } }
    if (operation === 'recordings.voice-triggers.decide') return { ...hit(params.candidateRef.replace('opaque-', '')), status: params.decision === 'save' ? 'saved' : 'ignored', revision: 2 }
    if (params.action === 'settings') return { accountKey, available, revision: 1, rules: [defaultRecordingVoiceRule()], draft: { revision: 0, rules: [defaultRecordingVoiceRule()] } }
    if (params.action === 'page') return { items: [hit('unknown'), hit('self'), hit('other')] }
    if (params.action === 'detail') return { items: [{ itemRef: 'original-segment', itemId: 'original-segment', canBindSpeaker: true, speakerLabel: '未识别说话人', text: '原音中的口令和正文', startAtMillis: 1000 }] }
    throw new Error('unexpected operation')
  })
  holder = document.createElement('div'); document.body.append(holder); root = createRoot(holder)
})
afterEach(async () => { await act(async () => root.unmount()); holder.remove() })
const mount = () => act(async () => root.render(<RecordingVoiceTriggerDialog accountKey={accountKey} mediaPath="/media" onClose={onClose} />))
it('renders self first while preserving unknown/other hits and saves without assigning a voice', async () => {
  await mount()
  expect([...document.querySelectorAll('article')].map(node => node.textContent)).toEqual([expect.stringContaining('self的记事'), expect.stringContaining('unknown的记事'), expect.stringContaining('other的记事')])
  await click(buttons('保存到发给自己')[1]!)
  expect(document.querySelectorAll('article')[1]!.textContent).toContain('已保存')
  expect(document.querySelectorAll('article')[1]!.textContent).toContain('标记说话人')
  expect(api.callArkme.mock.calls.some(([_, params]) => params.action === 'detail')).toBe(false)
  await click(buttons('标记说话人')[0]!)
  expect(document.body.textContent).toContain('选择需要标记的原音片段')
  await click(buttons('未识别说话人 · 1/1 08:00原音中的口令和正文')[0] ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes('原音中的口令和正文'))!)
  expect(document.body.textContent).toContain('单独标记说话人')
})
it('shows missing backend explicitly, lets configuration persist and never pretends detection is active', async () => {
  available = false; await mount()
  expect(document.body.textContent).toContain('后端接口开发中')
  expect(document.body.textContent).not.toContain('尚未发现口令命中')
  expect(api.callArkme.mock.calls.some(([_, params]) => params.action === 'page')).toBe(false)
  await click(buttons('编辑')[0]!)
  await act(async () => document.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(document.body.textContent).toContain('配置已保存在本机，尚未开始自动检测')
})
it('preserves loaded hits on refresh failure and does not poll', async () => {
  await mount(); const count = api.callArkme.mock.calls.length
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(api.callArkme).toHaveBeenCalledTimes(count)
  api.callArkme.mockRejectedValueOnce(new Error('网络失败'))
  await click(buttons('刷新')[0]!)
  expect(document.body.textContent).toContain('网络失败')
  expect(document.querySelectorAll('article')).toHaveLength(3)
})
it('does not offer a save for an unfinished capture', async () => {
  const prior = api.callArkme.getMockImplementation()!
  api.callArkme.mockImplementation((op, params) => params.action === 'page' ? Promise.resolve({ items: [{ ...hit('unknown'), boundary: 'open' }] }) : prior(op, params))
  await mount()
  expect(buttons('保存到发给自己')[0]!.disabled).toBe(true)
  expect(document.body.textContent).toContain('等待后续录音')
})

it('confirms an uncertain displayed range with the existing card button and no extra dialog', async () => {
  const original = api.callArkme.getMockImplementation()!
  api.callArkme.mockImplementation(async (operation, params) => {
    if (params.action === 'page') return { items: [{ ...hit('unknown'), boundary: 'uncertain' }] }
    if (operation === 'recordings.voice-triggers.decide') return { ...hit('unknown', 'saved'), boundary: 'uncertain', revision: 2 }
    return original(operation, params)
  })
  await mount()
  expect(document.body.textContent).toContain('仅保存当前显示的文字')
  expect(api.callArkme.mock.calls.some(([op]) => op === 'recordings.voice-triggers.decide')).toBe(false)
  await click(buttons('确认保存当前内容')[0]!)
  expect(api.callArkme.mock.calls.filter(([op]) => op === 'recordings.voice-triggers.decide')).toHaveLength(1)
  expect(api.callArkme.mock.calls.find(([op]) => op === 'recordings.voice-triggers.decide')?.[1]).toMatchObject({ decision: 'save', confirmedRange: true })
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(document.body.textContent).toContain('已保存到发给自己')
  expect(document.querySelector('article')!.textContent).not.toContain('请试听核对后保存')
})
it('keeps uncertain confirmation retry on its original card after a failed request', async () => {
  const original = api.callArkme.getMockImplementation()!
  let writes = 0
  api.callArkme.mockImplementation(async (operation, params) => {
    if (operation === 'recordings.voice-triggers.decide' && writes++ === 0) throw new Error('网络失败')
    return params.action === 'page' ? { items: [{ ...hit('unknown'), boundary: 'uncertain' }] } : original(operation, params)
  })
  await mount()
  await click(buttons('确认保存当前内容')[0]!)
  expect(document.body.textContent).toContain('网络失败')
  expect(buttons('确认保存当前内容')[0]!.disabled).toBe(false)
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  await click(buttons('确认保存当前内容')[0]!)
  expect(writes).toBe(2)
  expect(api.callArkme.mock.calls.filter(([op]) => op === 'recordings.voice-triggers.decide').every(([, params]) => params.confirmedRange === true)).toBe(true)
})
it('keeps pagination available when current permissions remove all items in a snapshot page',async()=>{
 const original=api.callArkme.getMockImplementation()!
 api.callArkme.mockImplementation(async(op,params)=>params.action==='page'?{items:[],nextCursor:'next-authorized-page'}:original(op,params))
 await mount()
 expect(buttons('加载更多')).toHaveLength(1)
 expect(document.body.textContent).not.toContain('尚未发现口令命中')
})
