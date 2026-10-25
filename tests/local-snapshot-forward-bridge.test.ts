// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { registerLocalSnapshotForward } from '../src/client/local-snapshot-forward.js'
import type { LocalSnapshotForward } from '../src/client/local-snapshot-forward.js'
it('admits only the current visible DSH frame and removes its bridge on teardown', async () => {
  const surface = document.createElement('div'), frame = document.createElement('iframe')
  surface.setAttribute('data-arkme-owned', 'deepseek-harness-surface'); surface.setAttribute('data-arkme-visible', 'true')
  surface.append(frame); document.body.append(surface)
  const present = vi.fn(async () => ({ completed: false })), cleanup = registerLocalSnapshotForward(present)
  const entry = (window as unknown as { __arkmeSelectedTextForwardEntry: { open(content: LocalSnapshotForward, signal: AbortSignal, caller: Window): Promise<unknown> } }).__arkmeSelectedTextForwardEntry
  const content = { userId: 11, preview: { title: '引用', subtitle: '选段' }, delivery: { comment: undefined, send: vi.fn() } }
  try {
    expect(() => entry.open(content, new AbortController().signal, window)).toThrow('DSH')
    await expect(entry.open(content, new AbortController().signal, frame.contentWindow!)).resolves.toEqual({ completed: false })
    surface.setAttribute('data-arkme-visible', 'false')
    expect(() => entry.open(content, new AbortController().signal, frame.contentWindow!)).toThrow('DSH')
    surface.setAttribute('data-arkme-visible', 'true')
    expect(() => entry.open(content, AbortSignal.abort(), frame.contentWindow!)).toThrow()
    expect(present).toHaveBeenCalledOnce()
  } finally { cleanup(); surface.remove() }
  expect(() => entry.open(content, new AbortController().signal, window)).toThrow()
})
