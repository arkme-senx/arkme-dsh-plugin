// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { HARNESS_DOCUMENT_STARTED } from '../src/harness-embed-contract.js'
import { watchHarnessDocument } from '../src/client/harness-document.js'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('attaches a new document before iframe load, rejecting unrelated or foreign messages', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const seen = vi.fn()
  const stop = watchHarnessDocument(frame, seen)
  expect(seen).toHaveBeenCalledTimes(1)
  const next = new JSDOM('<main>Loading plugins…</main>', { url: `${location.origin}/arkme-self/harness-frame` })
  vi.spyOn(frame, 'contentDocument', 'get').mockReturnValue(next.window.document)
  const emit = (source: Window | null, origin: string, type = HARNESS_DOCUMENT_STARTED) => window.dispatchEvent(new MessageEvent('message', { source, origin, data: { type } }))
  emit(frame.contentWindow, 'https://untrusted.example')
  emit(window, location.origin)
  emit(frame.contentWindow, location.origin, 'other')
  expect(seen).toHaveBeenCalledTimes(1)
  emit(frame.contentWindow, location.origin)
  expect(seen).toHaveBeenLastCalledWith(next.window.document)
  expect(seen).toHaveBeenCalledTimes(2)
  frame.dispatchEvent(new Event('load'))
  expect(seen).toHaveBeenCalledTimes(2)
  stop()
  vi.mocked(Object.getOwnPropertyDescriptor(frame, 'contentDocument')!.get!).mockReturnValue(document)
  emit(frame.contentWindow, location.origin)
  expect(seen).toHaveBeenCalledTimes(2)
  next.window.close()
})

it('retains a load-event fallback for older embedded documents', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const seen = vi.fn(), stop = watchHarnessDocument(frame, seen)
  vi.spyOn(frame, 'contentDocument', 'get').mockReturnValue(document)
  frame.dispatchEvent(new Event('load'))
  expect(seen).toHaveBeenLastCalledWith(document)
  stop()
})
