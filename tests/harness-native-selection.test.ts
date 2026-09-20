import { describe, expect, it, vi } from 'vitest'
import { EMPTY_NATIVE_SELECTION, nativeSelectionReducer, isSelectableNativeNode, observeSelectedNativeNodes, readNativeChat } from '../src/client/harness-native-selection.js'

describe('native message selection', () => {
  it('uses whole stable keys, keeps zero-selection mode, and clears on exit', () => {
    let state = nativeSelectionReducer(EMPTY_NATIVE_SELECTION, { type: 'enter' })
    state = nativeSelectionReducer(state, { type: 'toggle', key: '13:input-message:one' })
    state = nativeSelectionReducer(state, { type: 'toggle', key: '13:input-message:two' })
    expect([...state.keys]).toEqual(['13:input-message:one', '13:input-message:two'])
    state = nativeSelectionReducer(state, { type: 'toggle', key: '13:input-message:one' })
    state = nativeSelectionReducer(state, { type: 'toggle', key: '13:input-message:two' })
    expect(state.active).toBe(true)
    state = nativeSelectionReducer(state, { type: 'exit' })
    state = nativeSelectionReducer(state, { type: 'toggle', key: '13:input-message:one' })
    expect(state).toBe(EMPTY_NATIVE_SELECTION)
  })
  it('only accepts visible user and settled assistant text, never reasoning/tools', () => {
    const node = { key: 'opaque', target: 'chat', visibility: 'visible', kind: 'user', data: {} }
    expect(isSelectableNativeNode(node)).toBe(true)
    expect(isSelectableNativeNode({ ...node, visibility: 'hidden' })).toBe(false)
    for (const kind of ['tool-call', 'turn-tail', 'turn-process', 'system-prompt', 'context', 'steering']) {
      expect(isSelectableNativeNode({ ...node, kind })).toBe(false)
    }
    const assistant = { ...node, kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: 'answer' }] } }
    expect(isSelectableNativeNode(assistant)).toBe(true)
    for (const status of ['running', 'interrupted']) expect(isSelectableNativeNode({ ...assistant, data: { ...assistant.data, status } })).toBe(false)
    for (const blocks of [[], [{ kind: 'reasoning', text: 'reason' }], [{ kind: 'text', text: '  ' }]]) {
      expect(isSelectableNativeNode({ ...assistant, data: { ...assistant.data, blocks } })).toBe(false)
    }
    expect(isSelectableNativeNode(undefined)).toBe(false)
  })
  it('rejects changed host contracts rather than treating them as empty chat', () => {
    expect(readNativeChat({ order: [], nodes: [] })).toBeUndefined()
    expect(readNativeChat(undefined)).toBeUndefined()
    const value = { order: ['key'], nodes: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) } }
    expect(readNativeChat(value)).toBe(value)
  })
  it('retains missing projections but removes explicit ineligibility, even without mounted rows', () => {
    let node: unknown = undefined
    let changed = () => {}
    const unsubscribe = vi.fn()
    const remove = vi.fn(); const fail = vi.fn()
    const dispose = observeSelectedNativeNodes({ nodes: {
      get: () => node,
      source: () => ({ subscribe: cb => { changed = cb; return unsubscribe } }),
    } }, new Set(['opaque']), remove, fail)
    expect(remove).not.toHaveBeenCalled()
    node = { key: 'opaque', target: 'chat', kind: 'user', visibility: 'visible' }; changed()
    expect(remove).not.toHaveBeenCalled()
    node = { key: 'opaque', target: 'chat', kind: 'user', visibility: 'hidden' }; changed()
    expect(remove).toHaveBeenCalledWith('opaque')
    expect(fail).not.toHaveBeenCalled()
    dispose(); dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('contains a failing host node read instead of throwing into the host publisher', () => {
    let broken = false; let changed = () => {}
    const fail = vi.fn(); const unsubscribe = vi.fn()
    const dispose = observeSelectedNativeNodes({ nodes: {
      get: () => { if (broken) throw new Error('changed contract'); return undefined },
      source: () => ({ subscribe: cb => { changed = cb; return unsubscribe } }),
    } }, new Set(['opaque']), () => {}, fail)
    broken = true
    expect(changed).not.toThrow()
    expect(fail).toHaveBeenCalledOnce()
    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

it('does not require host ordering for an in-place selection that only reads nodes', () => {
  const value = { nodes: { get: () => undefined, source: () => ({ subscribe: () => () => {} }) } }
  expect(readNativeChat(value)).toBe(value)
})
