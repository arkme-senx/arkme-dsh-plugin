import { describe, expect, it } from 'vitest'
import { nativeSelectionSnapshot, nativeSelectionCopyText, type NativeChat } from '../src/client/harness-native-selection.js'
const user = (key: string, anchorSeq: number, text = key) => ({ key, anchorSeq, target: 'chat', visibility: 'visible', kind: 'user', data: { time: 1000, content: [{ type: 'text', text }] } })
const chat = (nodes: unknown[]) => ({ nodes: { get: (key: string) => nodes.find(value => (value as { key: string }).key === key) } }) as NativeChat

describe('DSH selected forwarding snapshot', () => {
  it('orders by host sequence rather than selection or DOM order and separates source kinds', () => {
    const a = user('user:a', 2)
    const b = { ...user('assistant:b', 3), kind: 'assistant-step', data: { time: 2000, status: 'settled', blocks: [{ kind: 'reasoning', text: 'secret' }, { kind: 'text', text: '**reply**' }] } }
    expect(nativeSelectionSnapshot(chat([b, a]), 'session', new Set([b.key, a.key]))).toEqual({ sessionId: 'session', messages: [
      { key: a.key, anchorSeq: 2, role: 'user', text: a.key, createdAtMillis: 1000 },
      { key: b.key, anchorSeq: 3, role: 'assistant', text: '**reply**', createdAtMillis: 2000 },
    ] })
  })
  it('rejects the whole batch on missing, empty or unordered nodes without silently dropping items', () => {
    for (const node of [undefined, user('a', 1, ''), user('a', NaN), { ...user('a', 1), visibility: 'hidden' }]) {
      expect(() => nativeSelectionSnapshot(chat(node ? [node] : []), 'session', new Set(['a']))).toThrow()
    }
    expect(() => nativeSelectionSnapshot(chat([user('a', 1), user('b', 1)]), 'session', new Set(['a', 'b']))).toThrow()
    expect(() => nativeSelectionSnapshot(chat([]), 'session', new Set())).toThrow()
  })
  it('copies immutable content and refuses oversized selections', () => {
    const node = user('a', 1)
    const snap = nativeSelectionSnapshot(chat([node]), 'session', new Set(['a']))
    node.data.content[0]!.text = 'changed'
    expect(snap.messages[0]?.text).toBe('a')
    expect(() => nativeSelectionSnapshot(chat([]), 'session', new Set(Array.from({ length: 101 }, (_, i) => String(i))))).toThrow()
  })
})

it('measures each native message as UTF-8 bytes rather than JavaScript characters', () => {
  const text = '😀'.repeat(65536)
  expect(nativeSelectionSnapshot(chat([user('a', 1, text)]), 'session', new Set(['a'])).messages[0]!.text).toBe(text)
  expect(() => nativeSelectionSnapshot(chat([user('a', 1, text + 'x')]), 'session', new Set(['a']))).toThrow('大小限制')
})
it('accepts the total snapshot byte boundary and rejects the whole oversized batch', () => {
  const nodes = Array.from({ length: 33 }, (_, i) => user(String(i), i, 'x'.repeat(256 * 1024)))
  const keys = new Set(nodes.slice(0, 32).map(node => node.key))
  expect(nativeSelectionSnapshot(chat(nodes), 'session', keys).messages).toHaveLength(32)
  keys.add('32')
  expect(() => nativeSelectionSnapshot(chat(nodes), 'session', keys)).toThrow('大小限制')
})

it('preserves Markdown whitespace in forwarding while keeping copy-text normalization separate', () => {
  const text = '    code_block()\n\n'
  const source = chat([user('a', 1, text)])
  expect(nativeSelectionSnapshot(source, 'session', new Set(['a'])).messages[0]?.text).toBe(text)
  expect(nativeSelectionCopyText(source, 'a')).toBe('code_block()')
  expect(() => nativeSelectionSnapshot(chat([user('a', 1, ' \n ')]), 'session', new Set(['a']))).toThrow()
})
