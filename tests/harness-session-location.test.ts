// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionComputerLocation } from '../src/client/harness-session-summary.js'
import { accountSessionKey, installHarnessAccountSessions } from '../src/client/harness-account-sessions.js'
import { callArkme } from '../src/sdk/index.js'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'

vi.mock('../src/sdk/index.js', () => ({ callArkme: vi.fn() }))
let root: Root | undefined
let stop: (() => void) | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { act(() => root?.unmount()); root = undefined; stop?.(); stop = undefined; document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers() })
const remote = { runtimeRef: 'remote', sessionRef: 'same', desktopName: 'DESKTOP-MQ3A4TB', local: false, sameDesktop: false, capabilities: [], archived: false } as unknown as DshAccountSession
const t = ((key: string) => ({ remote: '非本机' })[key]) as Parameters<typeof SessionComputerLocation>[0]['t']

it('uses runtime/session identity, hides same-computer instances, and follows rename/offline without another poller', async () => {
  vi.useFakeTimers()
  const surface = document.createElement('section'), container = document.createElement('div')
  document.body.append(surface, container)
  surface.dataset.arkmeAccountId = '1'; surface.dataset.arkmeAccountScope = 'test'
  let rows = [remote, { ...remote, runtimeRef: 'other-local', sameDesktop: true }]
  let localDesktopName: string | undefined = 'Mac.local'
  vi.mocked(callArkme).mockImplementation(async () => ({ contractVersion: 1, items: rows, localRuntime: { desktopName: localDesktopName } }))
  stop = installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface)
  root = createRoot(container)
  const render = async (sessionId: string) => { await act(async () => root!.render(createElement(SessionComputerLocation, { surface, sessionId, t }))) }
  await render(accountSessionKey(remote))
  expect(container.textContent).toBe('非本机 · DESKTOP-MQ3A4TB')
  expect(vi.getTimerCount()).toBe(1)
  await render('same')
  expect(container.textContent).toBe('')
  await render(accountSessionKey(rows[1]!))
  expect(container.textContent).toBe('')
  await render('arkme:missing:same')
  expect(container.textContent).toBe('')
  await render(accountSessionKey(remote))
  localDesktopName = remote.desktopName
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(container.textContent).toBe('')
  expect(rows[0]!.sameDesktop).toBe(false)
  localDesktopName = undefined
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(container.textContent).toBe('')
  localDesktopName = 'Mac.local'
  rows = [{ ...remote, desktopName: '<img src=x onerror=alert(1)>'.repeat(10), presence: 'offline' }]
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('[data-arkme-session-computer-name]')?.getAttribute('title')).toBe(rows[0]!.desktopName)
  expect(container.textContent).toContain('非本机')
  rows = [{ ...remote, desktopName: ' ' }]
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(container.textContent).toBe('')
  act(() => root!.unmount()); root = undefined
  stop(); stop = undefined
  expect(vi.getTimerCount()).toBe(0)
})

it('withdraws old computer information on account/environment changes and ignores the old pending response', async () => {
  vi.useFakeTimers()
  const surface = document.createElement('section'), container = document.createElement('div')
  document.body.append(surface, container)
  surface.dataset.arkmeAccountId = '1'; surface.dataset.arkmeAccountScope = 'test'
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [remote], localRuntime: { desktopName: 'Mac.local' } })
  root = createRoot(container)
  await act(async () => root!.render(createElement(SessionComputerLocation, { surface, sessionId: accountSessionKey(remote), t })))
  expect(container.textContent).toContain('DESKTOP-MQ3A4TB')
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [] })
  await act(async () => { surface.dataset.arkmeAccountId = '2'; surface.dataset.arkmeAccountScope = 'prod' })
  expect(container.textContent).toBe('')
  await act(async () => finish({ contractVersion: 1, items: [remote] }))
  expect(container.textContent).toBe('')
  expect(vi.getTimerCount()).toBe(1)
})
