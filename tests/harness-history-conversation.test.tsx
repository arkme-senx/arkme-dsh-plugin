// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { historyMessageNode } from '../src/client/harness-history-conversation.js'
import type { DshRemoteTimelineNode } from '../src/dsh-remote/types.js'
const node = (kind: string, data: unknown = {}, presentation = {}): DshRemoteTimelineNode => ({ node_ref: 'n', kind, data, anchor_seq: 9, ordinal: 0, time: 1, presentation } as DshRemoteTimelineNode)
describe('available history renders through native message payloads without journal completeness', () => {
  it('keeps user content and stable identity', () => {
    const content = [{ type: 'text', text: '原始用户正文' }]
    const message = historyMessageNode(node('user', { content }))
    expect(message).toMatchObject({ id: 'n', key: 'n', kind: 'user', data: { content, seq: 9, time: 1 } })
    expect(message!.data).not.toHaveProperty('retainedBy')
  })
  it('supports both native kind and cloud type assistant blocks', () => {
    const message = historyMessageNode(node('assistant', { blocks: [{ kind: 'text', text: '正文' }, { type: 'reasoning', text: '推理' }, null] }))
    expect(message).toMatchObject({ kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: '正文' }, { kind: 'reasoning', text: '推理' }] } })
  })
  it('renders legacy partial text even when no original message is present', () => {
    expect(historyMessageNode(node('assistant', {}, { details: '仅存的内容' }))?.data).toMatchObject({ blocks: [{ kind: 'text', text: '仅存的内容' }] })
    expect(historyMessageNode(node('assistant', { message: { content: [{ type: 'text', text: '旧格式' }] } }))?.data).toMatchObject({ blocks: [{ kind: 'text', text: '旧格式' }] })
  })
  it('leaves tool activity outside the message adapter instead of presenting it as assistant output', () => {
    expect(historyMessageNode(node('tool'))).toBeUndefined()
  })
})

it('reuses native components under owned slots and isolates the disabled composer from the live editor', async () => {
  const { SlotCore } = await import('@deepseek-ai/dsh-client-ui-slots')
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { vi } = await import('vitest')
  const { installHarnessHistoryConversation } = await import('../src/client/harness-history-conversation.js')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const ledger = new SlotCore(), core = ledger as any
  const releaseRoot = core.register({ name: 'root', children: { 'main.conversation': { kind: 'single', scope: 'session-maybe' } } }, () => null)
  const releaseNative = core.register({ name: 'main.conversation', children: {
    'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
    'conversation.chat.node': { kind: 'keyed', scope: 'session-maybe' },
  } }, () => null)
  const inject = vi.fn(() => ({})), captured: any[] = []
  const releaseComposer = core.register({ name: 'conversation.composer.bar', inject }, (props: any) => {
    captured.push(props)
    return createElement('textarea', { disabled: props.disabled, 'aria-label': '原生输入框' })
  })
  const slots = { entries: (name: string) => core.entries(name), entriesOfSlot: core.entriesOfSlot.bind(core), register: core.register.bind(core), subscribe: core.subscribe.bind(core) }
  const surface = document.createElement('section')
  const stop = installHarnessHistoryConversation({ slots } as never, surface)
  const alias = core.entriesOfSlot('arkme.history.composer')[0]
  alias.inject('unrelated-live-session')
  expect(inject).toHaveBeenCalledWith(undefined)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(alias.component, { disabled: true, sessionId: 'live', inputActions: { submit: vi.fn() }, keyboard: { editor: {} }, t: (key: string) => key === 'placeholder.default' ? '正常输入提示' : key, renderSlot: () => null })))
    expect(captured.at(-1)).toMatchObject({ placeholder: '正常输入提示', disabled: true, sessionId: undefined, keyboard: undefined, inputActions: undefined })
    expect(captured.at(-1).useInput(() => 'live draft')).toBeUndefined()
    expect(host.querySelector('textarea')!.disabled).toBe(true)
    expect(core.entriesOfSlot('conversation.composer.bar')).toHaveLength(1)
  } finally {
    await act(async () => root.unmount()); host.remove(); stop()
    expect(core.entriesOfSlot('main.conversation')).toHaveLength(1)
    expect(core.entriesOfSlot('arkme.history.composer')).toHaveLength(0)
    releaseComposer(); releaseNative(); releaseRoot(); vi.unstubAllGlobals()
  }
})
