// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeCopyLinkEntry, NATIVE_COPY_LINK_ENTRY, type NativeCopyLinkWindow } from '../src/client/native-copy-link-entry.js'
afterEach(() => { document.body.replaceChildren(); delete (window as NativeCopyLinkWindow)[NATIVE_COPY_LINK_ENTRY] })
function setup() {
  const surface = document.createElement('section'); surface.dataset.arkmeOwned = 'deepseek-harness-surface'; surface.dataset.arkmeVisible = 'true'
  const frame = document.createElement('iframe'); surface.append(frame); document.body.append(surface)
  const deps = { isCurrentAccount: vi.fn(() => true), generate: vi.fn(async () => ({ sid: 'sid', url: 'https://share.test/s/sid' })), copyText: vi.fn(async (_text: string) => {}) }
  const host = window as NativeCopyLinkWindow
  const entry = createNativeCopyLinkEntry(host, deps); host[NATIVE_COPY_LINK_ENTRY] = entry
  const attempt = { userId: 42, snapshot: { sessionId: 'session', messages: [{ key: 'm', role: 'user' as const, anchorSeq: 1, text: 'body', createdAtMillis: 1000 }] } }
  return { entry, deps, attempt, caller: frame.contentWindow!, surface }
}
describe('native link generation uses the existing Arkme clipboard owner', () => {
  it('retries only clipboard after generation succeeds', async () => {
    const s = setup(); s.deps.copyText.mockRejectedValueOnce(new Error('clipboard denied'))
    await expect(s.entry.copy(s.attempt, new AbortController().signal, s.caller)).rejects.toThrow('clipboard denied')
    await s.entry.copy(s.attempt, new AbortController().signal, s.caller)
    expect(s.deps.generate).toHaveBeenCalledTimes(1); expect(s.deps.copyText).toHaveBeenCalledTimes(2)
  })
  it('does not cache a failed generation', async () => {
    const s = setup(); s.deps.generate.mockRejectedValueOnce(new Error('busy'))
    await expect(s.entry.copy(s.attempt, new AbortController().signal, s.caller)).rejects.toThrow('busy')
    await s.entry.copy(s.attempt, new AbortController().signal, s.caller)
    expect(s.deps.generate).toHaveBeenCalledTimes(2)
  })
  it.each(['account', 'hidden', 'aborted', 'unmounted'])('does not copy stale completion after %s', async kind => {
    const s = setup(); const controller = new AbortController()
    let finish!: (value: {sid: string; url: string}) => void
    s.deps.generate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = s.entry.copy(s.attempt, controller.signal, s.caller)
    if (kind === 'account') s.deps.isCurrentAccount.mockReturnValue(false)
    if (kind === 'hidden') s.surface.dataset.arkmeVisible = 'false'
    if (kind === 'aborted') controller.abort()
    if (kind === 'unmounted') delete (window as NativeCopyLinkWindow)[NATIVE_COPY_LINK_ENTRY]
    finish({ sid: 'sid', url: 'https://share.test/s/sid' })
    await expect(pending).rejects.toThrow(); expect(s.deps.copyText).not.toHaveBeenCalled()
  })
  it('guards duplicate submission and foreign callers', async () => {
    const s = setup(); let finish!: (value: {sid: string; url: string}) => void
    await expect(s.entry.copy(s.attempt, new AbortController().signal, window)).rejects.toThrow('切换')
    s.deps.generate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = s.entry.copy(s.attempt, new AbortController().signal, s.caller)
    await expect(s.entry.copy(s.attempt, new AbortController().signal, s.caller)).rejects.toThrow('稍候')
    finish({ sid: 'sid', url: 'https://share.test/s/sid' }); await pending
    expect(s.deps.generate).toHaveBeenCalledTimes(1)
  })
})

it('releases a cancelled clipboard wait and reuses the generated link', async () => {
  const s = setup()
  s.deps.copyText.mockImplementationOnce(() => new Promise<void>(() => {}))
  const controller = new AbortController()
  const pending = s.entry.copy(s.attempt, controller.signal, s.caller)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(s.deps.copyText).toHaveBeenCalledTimes(1))
  controller.abort()
  await rejected
  await s.entry.copy(s.attempt, new AbortController().signal, s.caller)
  expect(s.deps.generate).toHaveBeenCalledTimes(1)
  expect(s.deps.copyText).toHaveBeenCalledTimes(2)
})

it('allows retry after cancelling generation and ignores its late result', async () => {
  const s = setup()
  let finish!: (value: { sid: string; url: string }) => void
  s.deps.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const controller = new AbortController()
  const pending = s.entry.copy(s.attempt, controller.signal, s.caller)
  const rejected = expect(pending).rejects.toThrow()
  controller.abort(); await rejected
  await s.entry.copy(s.attempt, new AbortController().signal, s.caller)
  finish({ sid: 'old', url: 'https://share.test/s/old' })
  await Promise.resolve()
  expect(s.deps.generate).toHaveBeenCalledTimes(2)
  expect(s.deps.copyText).toHaveBeenCalledTimes(1)
  expect(s.deps.copyText.mock.calls[0][0]).toBe('https://share.test/s/sid')
})
