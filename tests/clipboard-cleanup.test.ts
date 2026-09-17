// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { arkmeCopyTextToClipboard } from '../src/client/ArkmeSidebar.js'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })
it.each(['throw', 'false', 'success'])('restores focus and selection after clipboard fallback: %s', async outcome => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  const command = vi.fn(() => { if (outcome === 'throw') throw new Error('copy denied'); return outcome === 'success' })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command })
  const button = document.createElement('button')
  const text = document.createTextNode('selected body')
  document.body.append(button, text); button.focus()
  const range = document.createRange(); range.selectNodeContents(text)
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  const result = arkmeCopyTextToClipboard('https://share.test/s/test')
  if (outcome === 'success') await result
  else await expect(result).rejects.toThrow()
  expect(document.querySelector('textarea')).toBeNull()
  expect(document.activeElement).toBe(button)
  expect(document.getSelection()!.toString()).toBe('selected body')
  Reflect.deleteProperty(document, 'execCommand')
})

it('does not start fallback copying after cancellation', async () => {
  let fail!: (error: Error) => void
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>((_, reject) => { fail = reject }) } })
  const command = vi.fn()
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command })
  const controller = new AbortController()
  const pending = arkmeCopyTextToClipboard('old link', controller.signal)
  controller.abort(); fail(new Error('permission denied'))
  await expect(pending).rejects.toThrow()
  expect(command).not.toHaveBeenCalled()
  expect(document.querySelector('textarea')).toBeNull()
  Reflect.deleteProperty(document, 'execCommand')
})
