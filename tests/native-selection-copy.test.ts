// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { nativeSelectionCopyText, type NativeChat } from '../src/client/harness-native-selection.js'
import { copyText } from '../src/client/clipboard-text.js'
afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'clipboard'); document.body.replaceChildren() })
const read = (node: unknown) => nativeSelectionCopyText({ nodes: { get: () => node } } as unknown as NativeChat, 'key')
const base = { key: 'key', target: 'chat', visibility: 'visible' }
it('reads user text content only, preserving markdown and internal whitespace', () => {
  expect(read({ ...base, kind: 'user', data: { content: [{ type: 'text', text: '  **hello**\n' }, { type: 'image', text: 'image secret' }, { kind: 'text', text: 'wrong family' }, { type: 'text', text: 'world  ' }] } })).toBe('**hello**\nworld')
})
it('reads settled assistant text blocks without reasoning or tools', () => {
  expect(read({ ...base, kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'reasoning', text: 'private' }, { kind: 'text', text: 'one\n' }, { type: 'text', text: 'wrong family' }, { kind: 'text', text: 'two' }] } })).toBe('one\ntwo')
})
it('keeps attachment-only user messages empty and rejects unavailable data', () => {
  expect(read({ ...base, kind: 'user', data: { content: [{ type: 'image' }] } })).toBe('')
  for (const node of [undefined, { ...base, key: 'other', kind: 'user' }, { ...base, kind: 'user', data: {} }, { ...base, kind: 'assistant-step', data: { status: 'running' } }]) expect(() => read(node)).toThrow()
})
it('uses the document clipboard and falls back on rejection', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await copyText('native text')
  expect(writeText).toHaveBeenCalledWith('native text')
  writeText.mockRejectedValueOnce(new Error('denied'))
  const exec = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  await copyText('fallback')
  expect(exec).toHaveBeenCalledWith('copy')
  expect(document.querySelector('textarea')).toBeNull()
})
it('cleans fallback textarea and restores focus even when copying throws', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => { throw new Error('copy denied') } })
  const button = document.createElement('button'); document.body.append(button); button.focus()
  await expect(copyText('text')).rejects.toThrow()
  expect(document.querySelector('textarea')).toBeNull()
  expect(document.activeElement).toBe(button)
})

it('uses the explicitly supplied iframe clipboard rather than the outer window', async () => {
  const outer = vi.fn(); const inner = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: outer } })
  const frame = document.createElement('iframe'); document.body.append(frame)
  Object.defineProperty(frame.contentWindow!.navigator, 'clipboard', { configurable: true, value: { writeText: inner } })
  await copyText('iframe text', frame.contentDocument!)
  expect(inner).toHaveBeenCalledWith('iframe text')
  expect(outer).not.toHaveBeenCalled()
})
