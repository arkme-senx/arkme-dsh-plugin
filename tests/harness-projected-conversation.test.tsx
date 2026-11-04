// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('../src/client/harness-account-sessions.js', () => ({ useAccountSessionCatalog: () => ({ rows: [] }) }))
vi.mock('../src/sdk/index.js', () => ({ callArkme: vi.fn(async () => ({ nodes: [], complete: false, online: false })) }))
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { installProjectedConversation } from '../src/client/harness-projected-conversation.js'

it('shadows only remote content, preserving native header/composer entries and restoring the exact local tree', async () => {
  const slots = new SlotCore(), register = slots.register.bind(slots) as any
  register({ name: 'root', children: {
    'conversation.session': { kind: 'single', scope: 'session' },
    'conversation.session.header': { kind: 'single', scope: 'session' },
    'conversation.session.header.corner': { kind: 'single', scope: 'session' },
    'conversation.composer': { kind: 'single', scope: 'session' },
  } }, () => null)
  register({ name: 'conversation.session', children: { 'conversation.view': { kind: 'list', scope: 'session' } } }, () => null)
  for (const name of ['conversation.session.header', 'conversation.composer']) register({ name }, () => null)
  register({ name: 'conversation.view', id: 'chat', children: { 'conversation.chat.flow': { kind: 'single', scope: 'session' } } }, () => null)
  register({ name: 'conversation.chat.flow', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null)
  register({ name: 'conversation.chat.node', key: 'user' }, () => null)
  const original = slots.entriesOfSlot('conversation.session')[0]
  const corner = slots.entries('conversation.session.header.corner')
  const header = slots.entries('conversation.session.header'), composer = slots.entries('conversation.composer')
  let state: any
  const listeners = new Set<() => void>()
  const select = (id: string) => { state = { byId: { [id]: { id, retainedBy: { mainView: 1 } } } }; listeners.forEach(fn => fn()) }
  select('local')
  const surface = document.createElement('section')
  const stop = installProjectedConversation({ slots, sessions: {
    list: { getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } },
    subagentAddress: () => undefined,
  } } as any, surface)
  expect(slots.entriesOfSlot('conversation.session')[0]).toBe(original)
  select('arkme:runtime:remote')
  expect(slots.entriesOfSlot('conversation.session')[0]).not.toBe(original)
  expect(slots.entries('conversation.session.header')).toBe(header)
  expect(slots.entries('conversation.session.header.corner')).toBe(corner)
  expect(slots.entries('conversation.composer')).toBe(composer)
  expect(slots.entriesOfSlot('arkme.projectedHistory.conversation.view.chat.conversation.chat.flow')).toHaveLength(1)
  expect(slots.entriesOfSlot('arkme.projectedHistory.conversation.view.chat.conversation.chat.flow.default.conversation.chat.node')).toHaveLength(1)
  surface.setAttribute('data-arkme-source-writable', 'true'); await Promise.resolve()
  expect(slots.entriesOfSlot('conversation.session')[0]).not.toBe(original)
  surface.setAttribute('data-arkme-native-history-ready', 'true'); await Promise.resolve()
  expect(slots.entriesOfSlot('conversation.session')[0]).toBe(original)
  surface.setAttribute('data-arkme-native-history-ready', 'false'); await Promise.resolve()
  expect(slots.entriesOfSlot('conversation.session')[0]).not.toBe(original)
  select('local')
  expect(slots.entriesOfSlot('conversation.session')[0]).toBe(original)
  expect(slots.spec('arkme.projectedHistory.conversation.view.chat.conversation.chat.flow')).toBeUndefined()
  select('arkme:runtime:remote')
  surface.setAttribute('data-arkme-visible', 'false'); await Promise.resolve()
  expect(slots.entriesOfSlot('conversation.session')[0]).toBe(original)
  stop(); expect(listeners.size).toBe(0)
  expect(slots.entries('conversation.session.header')).toBe(header)
  expect(slots.entries('conversation.session.header.corner')).toBe(corner)
})

it('does not let a projected file path or fork action reach the local Host', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const slots = new SlotCore(), register = slots.register.bind(slots) as any
  register({ name: 'root', children: { 'conversation.session': { kind: 'single', scope: 'session' } } }, () => null)
  let rendered: any
  register({ name: 'conversation.session', children: { 'conversation.view': { kind: 'list', scope: 'session' } } },
    (props: any) => { rendered = props; return createElement('div', { 'data-native-view-area': true }, props.renderSlot('conversation.view', {}, { only: props.view })) })
  register({ name: 'conversation.view', id: 'chat', children: { 'conversation.chat.flow': { kind: 'single', scope: 'session' } } },
    () => null)
  const id = 'arkme:runtime:remote', state = { byId: { [id]: { id, retainedBy: { mainView: 1 } } } }
  const stop = installProjectedConversation({ slots, sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} }, subagentAddress: () => undefined } } as any, document.createElement('section'))
  const element = document.createElement('div'), root = createRoot(element), openFile = vi.fn(), forkAt = vi.fn()
  const renderSlot = vi.fn(() => null)
  try {
    await act(async () => root.render(createElement(slots.entriesOfSlot('conversation.session')[0]!.component as any,
      { sessionId: id, useSession: (select: any) => select({}), renderSlot, openFile, forkAt })))
    expect(element.querySelector('[data-native-view-area]')).not.toBeNull()
    expect(renderSlot).toHaveBeenCalledWith('arkme.projectedHistory.conversation.view', {}, { only: 'chat' })
    await expect(rendered.openFile('/source/project.txt')).rejects.toThrow('所属实例或电脑')
    expect(rendered.forkAt).toBeUndefined()
    expect(openFile).not.toHaveBeenCalled(); expect(forkAt).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()); stop() }
})

it('publishes displayed cloud readiness to the header independently of a failed native follow, including empty histories and disposal', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const { callArkme } = await import('../src/sdk/index.js')
  const { SessionHistoryStatus } = await import('../src/client/harness-session-summary.js')
  let complete!: (page: any) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const slots = new SlotCore(), register = slots.register.bind(slots) as any
  register({ name: 'root', children: { 'conversation.session': { kind: 'single', scope: 'session' } } }, () => null)
  register({ name: 'conversation.session', children: { 'conversation.view': { kind: 'list', scope: 'session' } } }, () => null)
  const id = 'arkme:runtime:remote', state = { byId: { [id]: { id, retainedBy: { mainView: 1 } } } }
  const surface = document.createElement('section'), container = document.createElement('div')
  surface.setAttribute('data-arkme-history-state', 'loading')
  const stop = installProjectedConversation({ slots, sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} }, subagentAddress: () => undefined } } as any, surface)
  const root = createRoot(container), header = createElement(SessionHistoryStatus, { surface, t: ((key: string) => key) as never })
  try {
    await act(async () => root.render(createElement('div', {}, header,
      createElement(slots.entriesOfSlot('conversation.session')[0]!.component as any,
        { sessionId: id, useSession: (select: any) => select({}), renderSlot: () => null }))))
    expect(container.textContent).toBe('historyLoading')
    await act(async () => complete({ nodes: [], complete: true, online: false }))
    expect(container.textContent).toBe('')
    await act(async () => surface.setAttribute('data-arkme-history-state', 'error'))
    expect(container.textContent).toBe('')
    await act(async () => root.render(header))
    expect(surface.hasAttribute('data-arkme-projected-history-state')).toBe(false)
    expect(container.textContent).toBe('historyError')
  } finally { act(() => root.unmount()); stop() }
})
