// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeBotCreateDialog } from '../src/client/ArkmeBotCreateDialog.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeBotSummary } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(), ArkmeClientError: Error }))

let host: HTMLDivElement
let root: Root
const onClose = vi.fn()
const onBotCreated = vi.fn()
const bot: ArkmeBotSummary = {
  botRef: 'created-bot', name: '测试 Bot', provider: 'openclaw',
  description: '', status: 'online', directChatAvailable: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(callArkme).mockResolvedValue(bot)
  onBotCreated.mockResolvedValue(undefined)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root.render(<ArkmeBotCreateDialog onClose={onClose} onBotCreated={onBotCreated} />) })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

function nameInput() { return host.querySelector<HTMLInputElement>('input[placeholder="给 Bot 起个名字"]')! }
function createButton() { return host.querySelector<HTMLButtonElement>('footer button:last-child')! }
function enterName(value = '测试 Bot') {
  const input = nameInput()
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function keyDown(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true, ...init })
  await act(async () => { nameInput().dispatchEvent(event) })
  return event
}

it.each([
  ['组词中', { isComposing: true }],
  ['组词已结束但仍为输入法确认键', { isComposing: false, keyCode: 229 }],
  ['其他按键', { key: 'a', keyCode: 65 }],
])('%s 不创建、不拦截文字输入', async (_, init) => {
  enterName()
  const event = await keyDown(init)
  expect(callArkme).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(nameInput().value).toBe('测试 Bot')
  expect(nameInput().disabled).toBe(false)
  expect(event.defaultPrevented).toBe(false)
})

it('确认候选文字后再次正常回车，使用最终名称创建一次', async () => {
  enterName('ce')
  act(() => { nameInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
  await keyDown({ isComposing: true })
  act(() => { nameInput().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '测试' })) })
  enterName('  测试  ')
  await keyDown()
  expect(callArkme).toHaveBeenCalledExactlyOnceWith('bots.create', { name: '测试', provider: 'openclaw' })
  expect(onBotCreated).toHaveBeenCalledWith(bot)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('鼠标创建保留原路径', async () => {
  enterName()
  await act(async () => { createButton().click() })
  expect(callArkme).toHaveBeenCalledExactlyOnceWith('bots.create', { name: '测试 Bot', provider: 'openclaw' })
})

it('空白名称不会发请求', async () => {
  enterName('  ')
  expect(createButton().disabled).toBe(true)
  await keyDown()
  expect(callArkme).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('请输入 Bot 名称')
})

it('创建未结束时禁用输入和按钮，不重复提交；完成后正常关闭', async () => {
  let finish!: (value: ArkmeBotSummary) => void
  vi.mocked(callArkme).mockReturnValueOnce(new Promise<ArkmeBotSummary>(resolve => { finish = resolve }))
  enterName()
  await keyDown()
  expect(nameInput().disabled).toBe(true)
  expect(createButton().disabled).toBe(true)
  expect(createButton().textContent).toBe('创建中...')
  await keyDown({ repeat: true })
  await act(async () => { createButton().click() })
  expect(callArkme).toHaveBeenCalledTimes(1)
  await act(async () => { finish(bot) })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('创建失败显示错误并恢复输入，允许用户主动重试', async () => {
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('创建失败'))
  enterName()
  await keyDown()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('创建失败')
  expect(nameInput().disabled).toBe(false)
  expect(createButton().disabled).toBe(false)
  expect(onClose).not.toHaveBeenCalled()
  await keyDown()
  expect(callArkme).toHaveBeenCalledTimes(2)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('已创建但打开会话失败，不允许再次创建', async () => {
  onBotCreated.mockRejectedValueOnce(new Error('打开失败'))
  enterName()
  await keyDown()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Bot 已创建，但无法打开私聊')
  expect(createButton().disabled).toBe(true)
  await keyDown()
  expect(callArkme).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
})

it('229 确认后可立即再次普通回车，不残留输入法锁定状态', async () => {
  enterName()
  await keyDown({ keyCode: 229, isComposing: false })
  expect(callArkme).not.toHaveBeenCalled()
  await keyDown()
  expect(callArkme).toHaveBeenCalledTimes(1)
})

it('Webhook 和简介保持独立字段，简介换行不提交', async () => {
  enterName()
  const description = host.querySelector('textarea')!
  act(() => {
    host.querySelector<HTMLButtonElement>('[data-arkme-bot-provider="webhook"]')!.click()
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(description, '  简介\n第二行  ')
    description.dispatchEvent(new Event('input', { bubbles: true }))
    description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(callArkme).not.toHaveBeenCalled()
  await keyDown()
  expect(callArkme).toHaveBeenCalledExactlyOnceWith('bots.create', {
    name: '测试 Bot', provider: 'webhook', description: '简介\n第二行',
  })
})

it('输入法确认后允许取消，不发创建请求', async () => {
  enterName()
  await keyDown({ isComposing: true })
  act(() => { host.querySelector<HTMLButtonElement>('footer button:first-child')!.click() })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(callArkme).not.toHaveBeenCalled()
})

it('等待创建后的导航完成期间，保持忙碌且不重复创建', async () => {
  let finish!: () => void
  onBotCreated.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  enterName()
  await keyDown()
  expect(createButton().disabled).toBe(true)
  expect(onClose).not.toHaveBeenCalled()
  await keyDown()
  expect(callArkme).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  expect(onClose).toHaveBeenCalledTimes(1)
})
