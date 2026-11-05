// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), openSource: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: mocks.openSource } }))
import { ArkoReplyManager } from '../src/client/ArkoReplyManager.js'
import { readArkoReplyPromptDrafts, saveArkoReplyPromptDraft, officialArkoReplyPrompt } from '../src/client/arko-reply-drafts.js'
import { arkoReplyHistory } from '../src/client/arko-reply-history.js'
import type { ArkmeSourceItem } from '../src/types.js'
let root: Root, host: HTMLDivElement
const close = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); arkoReplyHistory.activate(undefined); close.mockClear()
  mocks.openSource.mockClear(); mocks.call.mockReset().mockImplementation(async (op, params) => {
    if (op === 'account.capabilities.query') return { accountScope: params.expectedAccountScope, settings: [
      { key: 'record_thought', title: '阿森有想法', enabled: true, version: 1, enabledAt: 1 },
      { key: 'chat_thought', title: '聊天想法', enabled: false, version: 0, enabledAt: 0 },
      { key: 'goal_insight', title: '目标', enabled: false, version: 0, enabledAt: 0 },
    ] }
    if (op === 'record.thoughts.query') return { accountScope: params.expectedAccountScope, items: [{ id: 'one', recordUid: 'note', content: '当前快记回复', biz: 1 }] }
    throw new Error(`unexpected ${op}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals() })
const render = (scope = 'prod:1') => act(async () => root.render(<ArkoReplyManager accountScope={scope} onClose={close}/>))
const textButton = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith(text))!
const click = (element: HTMLElement) => act(async () => element.click())
async function editScene(title = '快记想法') { await click(textButton('提示词')); await click(textButton(title)) }
function changeTextarea(text: string) {
  const input = host.querySelector('textarea')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
it('shows only real switches and a prompt entry, with existing prompt text prefilled for editing', async () => {
  await render()
  expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2)
  expect(host.querySelector('[role="switch"][aria-label="快记里的想法"]')?.getAttribute('aria-checked')).toBe('true')
  expect(host.querySelector('[role="radiogroup"]')).toBeNull(); expect(host.querySelector('textarea')).toBeNull()
  expect(host.textContent).not.toContain('回复风格'); expect(host.textContent).not.toContain('补充要求')
  await click(textButton('提示词'))
  expect(host.textContent).not.toContain('群聊提问后的私密补充'); expect(host.textContent).not.toContain('Arko 对话')
  await click(textButton('快记想法'))
  expect(host.querySelector('textarea')!.value).toBe(officialArkoReplyPrompt('record_auto'))
  expect(host.textContent).toContain('仅保存在本机，尚未在云端生效')
  expect(mocks.call.mock.calls.every(([op]) => op === 'account.capabilities.query')).toBe(true)
})
it('saves exact prompt text locally, reopens it and restores official defaults without cloud writes', async () => {
  await render(); await editScene()
  await act(async () => changeTextarea('这是我修改后的完整提示词'))
  await click(textButton('保存修改'))
  expect(readArkoReplyPromptDrafts('prod:1').scenes.record_auto?.content).toBe('这是我修改后的完整提示词')
  expect(textButton('保存修改').disabled).toBe(true)
  await click(host.querySelector<HTMLButtonElement>('[aria-label="返回提示词列表"]')!)
  expect(textButton('快记想法').textContent).toContain('已修改')
  await click(textButton('快记想法')); expect(host.querySelector('textarea')!.value).toBe('这是我修改后的完整提示词')
  await click(textButton('恢复默认')); expect(host.querySelector('textarea')!.value).toBe(officialArkoReplyPrompt('record_auto'))
  await click(textButton('保存修改')); expect(readArkoReplyPromptDrafts('prod:1').scenes.record_auto).toBeUndefined()
  expect(mocks.call.mock.calls.every(([op]) => op === 'account.capabilities.query')).toBe(true)
})
it('protects unsaved prompt edits and discards only after confirmation', async () => {
  await render(); await editScene(); await act(async () => changeTextarea('尚未保存'))
  await click(host.querySelector<HTMLButtonElement>('[aria-label="返回提示词列表"]')!)
  expect(document.body.textContent).toContain('提示词修改尚未保存')
  await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '取消')!)
  expect(host.querySelector('textarea')!.value).toBe('尚未保存')
  await click(host.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!)
  expect(close).not.toHaveBeenCalled()
  await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '放弃修改')!)
  expect(close).toHaveBeenCalledOnce()
  expect(readArkoReplyPromptDrafts('prod:1').scenes).toEqual({})
})
it('does not expose the previous account prompt after an account switch', async () => {
  await render(); await editScene(); await act(async () => changeTextarea('账号一的提示词'))
  await click(textButton('保存修改')); await render('prod:2')
  expect(host.textContent).not.toContain('账号一的提示词')
  await editScene(); expect(host.querySelector('textarea')!.value).toBe(officialArkoReplyPrompt('record_auto'))
})
it('revalidates indexed replies and opens the original source without loading Arko conversations', async () => {
  await render()
  const source = { kind: 'send_to_self', sourceRef: 'self-ref', displayName: '发给自己' } as ArkmeSourceItem
  arkoReplyHistory.observe('prod:1', source, { itemUid: 'note', sendAtMillis: 200, isMe: true, version: 1 }, [{ id: 'one', recordUid: 'note', content: '未校验的旧缓存', biz: 1 }])
  await click(textButton('全部回复'))
  expect(host.textContent).toContain('当前快记回复'); expect(host.textContent).not.toContain('未校验的旧缓存')
  expect([...host.querySelectorAll('option')].map(option => option.value)).not.toContain('arko_chat')
  expect(mocks.call.mock.calls.some(([op]) => op === 'arko.messages')).toBe(false)
  await click(textButton('快记想法 · 发给自己'))
  expect(mocks.openSource).toHaveBeenCalledWith(source, 'note', 200, undefined, undefined, false, true)
  expect(close).toHaveBeenCalledOnce()
})
it('keeps the edited text on a conflicting save and does not overwrite the newer draft', async () => {
  await render(); await editScene(); await act(async () => changeTextarea('当前窗口的修改'))
  saveArkoReplyPromptDraft('prod:1', 'record_auto', '另一个窗口的新提示词', 0)
  await click(textButton('保存修改'))
  expect(host.textContent).toContain('其他窗口更新')
  expect(host.querySelector('textarea')!.value).toBe('当前窗口的修改')
  expect(readArkoReplyPromptDrafts('prod:1').scenes.record_auto?.content).toBe('另一个窗口的新提示词')
})
