// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { WorldSoundPublishDialog } from '../src/client/WorldSoundPublishDialog.js'
import { WorldSoundCard } from '../src/client/WorldSoundCard.js'
import { worldSoundPlayback } from '../src/client/world-sound-playback.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { WorldSoundExcerpt } from '../src/world-sound-contract.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => call(...args) }))
const excerpt: WorldSoundExcerpt = { source: 'call', revision: 'a'.repeat(64), durationMillis: 3000, segments: [
  { text: '值得分享的一句话', speaker: '说话人 1', offsetMillis: 0, durationMillis: 1000, omittedBefore: false, audioUrl: '/media/a' },
  { text: '继续听下一段', speaker: '说话人 2', offsetMillis: 1000, durationMillis: 2000, omittedBefore: true, audioUrl: '/media/b' },
] }
let root: Root, host: HTMLDivElement
const mount = async (node: React.ReactNode) => act(async () => root.render(node))
const click = async (label: string) => act(async () => {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent?.replace(/\s*↗$/, '').trim() === label || node.getAttribute('aria-label') === label)
  expect(button, label).toBeDefined(); button!.click()
})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7 })
  call.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); worldSoundPlayback.stop(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the exact uncertain command, displays audit status and withdraws without exposing editors', async () => {
  let submits = 0
  call.mockImplementation(async (op, input) => {
    if (op === 'team.app.teams') return []
    if (input.action === 'prepare') return { draftRef: 'sealed-draft', excerpt }
    if (input.action === 'publish' && !submits++) throw new Error('结果未知')
    return { recordRef: 'record', checkStatus: input.action === 'management' && !input.withdraw ? 2 : 1, publicRequested: !input.withdraw }
  })
  const close = vi.fn(), preview = vi.fn()
  await mount(<WorldSoundPublishDialog selection={{ kind: 'call', callRef: 'call', segmentIds: ['stable'] }} onClose={close} onPreview={preview} />)
  expect(document.querySelector('textarea,[contenteditable="true"]')).toBeNull()
  expect(document.body.textContent).toContain('通话摘录')
  await click('试听全部选段'); expect(preview).toHaveBeenCalledOnce()
  await click('提交审核'); expect(document.body.textContent).toContain('结果未知')
  await click('重试确认提交结果')
  const writes = call.mock.calls.filter(([, input]) => input.action === 'publish')
  expect(writes).toHaveLength(2); expect(writes[0]![1]).toEqual(writes[1]![1])
  expect(document.body.textContent).toContain('审核中，目前仅自己可见')
  await click('检查审核状态'); expect(document.body.textContent).toContain('审核通过，已发布到世界')
  await click('取消公开发布'); expect(document.body.textContent).toContain('已取消公开发布')
  expect(call.mock.calls.at(-1)![1]).toMatchObject({ action: 'management', recordRef: 'record', withdraw: true })
})

it('has one primary continuous player and source-specific guidance, while pending cards cannot play', async () => {
  const toggle = vi.spyOn(worldSoundPlayback, 'toggle').mockImplementation(() => {})
  await mount(<WorldSoundCard recordRef="r" excerpt={excerpt} />)
  await click('播放全部声音片段'); expect(toggle).toHaveBeenCalledWith('test:7:r:' + excerpt.revision, excerpt)
  await click('我也想这样分享'); expect(document.body.textContent).toContain('打开通话详情')
  expect(document.body.textContent).not.toContain('打开录音详情')
  await mount(<WorldSoundCard recordRef="r" excerpt={excerpt} status="pending" />)
  expect(document.querySelector('[aria-label="播放全部声音片段"]')).toBeNull()
  expect(document.body.textContent).toContain('审核中 · 仅自己可见')
  await click('查看完整原文')
  expect([...document.querySelectorAll('li button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true)
})

it('aborts preparation and hides the previous account when switching accounts', async () => {
  let signal: AbortSignal | undefined
  call.mockImplementation((op, _input, requestSignal) => op === 'team.app.teams' ? Promise.resolve([]) : new Promise(() => { signal = requestSignal }))
  await mount(<WorldSoundPublishDialog selection={{ kind: 'recording', itemRefs: ['opaque'] }} onClose={() => {}} onPreview={() => {}} />)
  expect(signal?.aborted).toBe(false)
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8 }))
  expect(signal?.aborted).toBe(true)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
