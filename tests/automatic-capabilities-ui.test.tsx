// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeAutomaticAiSettings } from '../src/client/ArkmeAutomaticAiSettings.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement, enabled: boolean, version: number
const result = (scope = 'prod:1') => ({ accountScope: scope, settings: [{ key: 'personal_profile', title: '个人档案', enabled, version, enabledAt: enabled ? 100 : 0 }] })
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  enabled = false; version = 0
  mocks.call.mockReset().mockImplementation(async (operation, params) => {
    if (operation.endsWith('update')) {
      if (params.expectedVersion !== version) throw new Error('conflict')
      if (enabled !== params.enabled) version++
      enabled = params.enabled
    }
    return result(params.expectedAccountScope)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const render = async (scope = 'prod:1') => { await act(async () => root.render(<ArkmeAutomaticAiSettings accountScope={scope} />)) }
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!
const click = async (node: HTMLButtonElement) => { await act(async () => node.click()) }
const writes = () => mocks.call.mock.calls.filter(([op]) => op === 'account.capabilities.update')

it('requires human billing consent, carries the observed version, and closes directly', async () => {
  await render(); expect(writes()).toHaveLength(0)
  expect(host.querySelector('.arkme-automatic-ai > p')?.textContent).toBe('开启后自动分析，消耗 AI 额度。')
  expect(host.querySelector('details')).toBeNull()
  const toggle = host.querySelector('[role="switch"]')!
  const guidance = document.getElementById(toggle.getAttribute('aria-describedby')!)!
  expect(guidance.textContent).toBe('「探索 → 个人档案」')
  expect(guidance.closest('.arkme-automatic-ai-row')).toBe(toggle.closest('.arkme-automatic-ai-row'))
  expect(writes()).toHaveLength(0)
  await click(host.querySelector('[role="switch"]')!)
  expect(writes()).toHaveLength(0); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('首次开启会分析所选来源的历史材料'); expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('AI 额度')
  await click(button('同意并开启'))
  expect(writes()[0]?.[1]).toMatchObject({ enabled: true, expectedVersion: 0, billingConsent: true, expectedAccountScope: 'prod:1' })
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  await click(host.querySelector('[role="switch"]')!)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(writes()[1]?.[1]).toMatchObject({ enabled: false, expectedVersion: 1 })
})
it('does not overwrite a newer cross-device close with stale consent', async () => {
  await render(); await click(host.querySelector('[role="switch"]')!)
  version = 2
  await click(button('同意并开启'))
  expect(enabled).toBe(false); expect(writes()).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('操作未完成')
})
it('can retry profile initialization after authorization succeeded without toggling it off', async () => {
  await render(); await click(host.querySelector('[role="switch"]')!)
  mocks.call.mockImplementationOnce(async () => { enabled = true; version = 1; throw new Error('profile unavailable') })
  await click(button('同意并开启'))
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  await click(button('个人档案已授权，重试启动分析'))
  expect(writes()[1]?.[1]).toMatchObject({ enabled: true, expectedVersion: 1 })
  expect(button('个人档案已授权，重试启动分析')).toBeUndefined()
})
it('drops consent and ignores old writes after an account change', async () => {
  await render(); await click(host.querySelector('[role="switch"]')!)
  await render('prod:2')
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(writes()).toHaveLength(0)
  await click(host.querySelector('[role="switch"]')!)
  let release!: () => void
  mocks.call.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  await click(button('同意并开启'))
  await render('prod:3')
  const reads = mocks.call.mock.calls.length
  await act(async () => release())
  expect(mocks.call.mock.calls.length).toBe(reads)
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
})
it('reads cross-device changes on focus and does not save twice', async () => {
  await render(); enabled = true; version = 1
  await act(async () => window.dispatchEvent(new Event('focus')))
  let release!: () => void
  mocks.call.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  await click(host.querySelector('[role="switch"]')!); await click(host.querySelector('[role="switch"]')!)
  expect(writes()).toHaveLength(1)
  await act(async () => release())
})
it('clears a transient read error after a successful focus refresh', async () => {
  mocks.call.mockRejectedValueOnce(new Error('offline'))
  await render()
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(host.querySelector('[role="switch"]')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('shows fixed destinations and contextual effects beside every switch before consent', async () => {
  const names = { personal_profile: '个人档案', record_thought: '阿森有想法（快记）', chat_thought: '阿森有想法（聊天）', arrangement_recognition: '安排', goal_insight: '目标', offline_context: '线下交流关联', recording_voice_trigger: '录音语音触发' }
  const expected = ['「探索 → 个人档案」', '阅读新快记，有想法时在快记下方回应你。', '在私聊和群聊消息下方提供建议，仅你可见。', '左侧「安排」', '「探索 → 目标」', '在聊天中回看相关的线下交流，仅你可见。', '录音日历「更多 → 语音触发」']
  mocks.call.mockResolvedValue({ accountScope: 'prod:1', settings: Object.entries(names).map(([key, title]) => ({ key, title, enabled: false, version: 0, enabledAt: 0 })) })
  await render()
  expect(host.querySelector('h3')?.textContent).toBe('自动使用额度')
  expect(host.querySelector('details')).toBeNull()
  const toggles = [...host.querySelectorAll('[role="switch"]')]
  expect(toggles).toHaveLength(7)
  const labels = ['自动整理个人档案', 'Arko有想法（快记）', 'Arko有想法（聊天）', '自动识别安排', '自动分析目标', '线下交流关联', '录音口令记事']
  for (const [index, label] of labels.entries()) {
    const toggle = toggles[index]!
    expect(toggle.getAttribute('aria-label')).toBe(label)
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe(expected[index])
  }
  expect(writes()).toHaveLength(0)
})

it.each([false, true])('keeps contextual guidance in a filtered chat control with compact=%s', async compact => {
  mocks.call.mockResolvedValue({ accountScope: 'prod:1', settings: [{ key: 'chat_thought', title: '阿森有想法（聊天）', enabled: false, version: 0, enabledAt: 0 }] })
  await act(async () => root.render(<ArkmeAutomaticAiSettings accountScope="prod:1" only={['chat_thought']} compact={compact} />))
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-label')).toBe('聊天中的建议')
  expect(host.textContent).toContain('在私聊和群聊消息下方提供建议，仅你可见。')
  expect(host.textContent).not.toContain('聊天自动回复')
  expect(writes()).toHaveLength(0)
})

it('explains the command and saved result without enabling on open or cancel', async () => {
  mocks.call.mockResolvedValue({ accountScope: 'prod:1', settings: [{ key: 'recording_voice_trigger', title: '录音语音触发', enabled: false, version: 0, enabledAt: 0 }] })
  await render()
  await click(host.querySelector('[role="switch"]')!)
  const dialog = document.querySelector('[role="dialog"]')!
  for (const text of ['录音口令记事', '如「帮我记一下」', '录音上传转写后', '提取口令后的原话', '按规则自动保存到「发给自己」或由你确认', '消耗 AI 额度', '仅处理开启后新上传的录音']) expect(dialog.textContent).toContain(text)
  expect(writes()).toHaveLength(0)
  await click(button('取消'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(writes()).toHaveLength(0)
})
