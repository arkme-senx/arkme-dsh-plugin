// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('../src/client/harness-surface-viewport.js', () => ({ watchHarnessSurfaceViewport: () => () => {} }))
vi.mock('../src/client/harness-window-drag.js', () => ({ watchHarnessWindowDrag: () => () => {} }))
vi.mock('../src/client/BuiltinConversationPreview.js', () => ({ HarnessHistoryConversation: ({ session }: any) => <div data-history-conversation>{session.title}</div> }))
import { DeepSeekHarnessSurface } from '../src/client/DeepSeekHarnessSurface.js'
import { HARNESS_LOCAL_SESSION_OPEN } from '../src/client/harness-session-menu-bridge.js'
import { HARNESS_HISTORY_PREVIEW, HARNESS_NATIVE_OPEN } from '../src/client/harness-native-navigation.js'

it('keeps one native iframe while account-scoped history opens, closes and switches accounts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const send = (accountId = '42', accountScope = 'prod') => document.dispatchEvent(new CustomEvent(HARNESS_HISTORY_PREVIEW, { detail: { accountId, accountScope, session: { runtimeRef: 'other', sessionRef: 'same', title: '只读历史' } } }))
  try {
    await act(async () => root.render(<DeepSeekHarnessSurface accountId={42} accountScope="prod" />))
    const frame = document.querySelector('iframe'), url = frame?.src
    act(() => { send('7'); send('42', 'test') })
    expect(document.querySelector('[data-history-conversation]')).toBeNull()
    act(() => { send() })
    expect(document.querySelector('[data-history-conversation]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-arkme-history-session]')?.getAttribute('data-arkme-history-session')).toBe('arkme:other:same')
    expect(document.querySelector('[data-arkme-follow-session]')?.getAttribute('data-arkme-follow-session')).toBe('false')
    expect(document.querySelectorAll('iframe')).toHaveLength(1); expect(document.querySelector('iframe')).toBe(frame); expect(frame?.src).toBe(url)
    act(() => document.dispatchEvent(new CustomEvent(HARNESS_NATIVE_OPEN, { detail: { accountId: '42', accountScope: 'prod', runtimeRef: '', sessionRef: 'local' } })))
    expect(document.querySelector('[data-history-conversation]')).toBeNull()
    act(() => { send() })
    act(() => frame!.contentDocument!.dispatchEvent(new Event(HARNESS_LOCAL_SESSION_OPEN)))
    expect(document.querySelector('[data-history-conversation]')).toBeNull()
    act(() => { send() })
    await act(async () => root.render(<DeepSeekHarnessSurface accountId={7} accountScope="prod" />))
    expect(document.querySelector('[data-history-conversation]')).toBeNull()
    act(() => { send() }); expect(document.querySelector('[data-history-conversation]')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
