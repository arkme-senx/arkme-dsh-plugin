import { useEffect, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({ mounts: { conversations: 0, contacts: 0 }, unmounts: { conversations: 0, contacts: 0 } }))
function DirectoryProbe({ kind }: { kind: 'contacts' | 'conversations' }) {
  const [value, setValue] = useState(0)
  useEffect(() => { lifecycle.mounts[kind]++; return () => { lifecycle.unmounts[kind]++ } }, [kind])
  return <button data-probe={kind} onClick={() => { setValue(value + 1) }}>{value}</button>
}
vi.mock('../src/client/ArkmeVirtualWorkspace.js', () => ({ ArkmeNavigation: () => <DirectoryProbe kind="conversations" /> }))
vi.mock('../src/client/redesign/contacts/ContactDirectorySurface.js', () => ({ ContactDirectorySurface: () => <DirectoryProbe kind="contacts" /> }))
vi.mock('../src/client/ArkmeProductNavigation.js', () => ({ ArkmeProductNavigation: () => null }))
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(async () => ({ items: [], hasMore: false })), ArkmeClientError: class extends Error {} }))
import { ArkmePersistentSidebar } from '../src/client/ArkmePersistentShell.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const props = { collapsed: false, width: 280, useSessions: (selector: (state: unknown) => unknown) => selector({ byId: {}, ids: [] }), renderSlot: () => null, closeDetails: () => {} }
let view: ReactTestRenderer
beforeEach(() => {
  lifecycle.mounts = { conversations: 0, contacts: 0 }; lifecycle.unmounts = { conversations: 0, contacts: 0 }
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10001 })
  arkmeUi.showConversations()
})
afterEach(async () => { await act(async () => { view?.unmount() }) })

it('lazily retains both directories and their local state through contacts, calendar and conversation switches', async () => {
  await act(async () => { view = create(<ArkmePersistentSidebar {...props as never} />) })
  expect(lifecycle.mounts).toEqual({ conversations: 1, contacts: 0 })
  await act(async () => { view.root.findByProps({ 'data-probe': 'conversations' }).props.onClick(); arkmeUi.showContacts() })
  expect(lifecycle.mounts).toEqual({ conversations: 1, contacts: 1 })
  const hiddenConversations = view.root.findByProps({ 'data-arkme-retained-directory': 'conversations' })
  expect(hiddenConversations.props.hidden).toBe(true)
  expect(hiddenConversations.props['data-arkme-directory-mode']).toBeUndefined()
  await act(async () => { view.root.findByProps({ 'data-probe': 'contacts' }).props.onClick(); arkmeUi.showCalendar() })
  expect(view.root.findByProps({ 'data-arkme-retained-directory': 'contacts' }).props.hidden).toBe(true)
  await act(async () => { arkmeUi.showConversations() })
  expect(view.root.findByProps({ 'data-probe': 'conversations' }).children).toEqual(['1'])
  await act(async () => { arkmeUi.showContacts() })
  expect(view.root.findByProps({ 'data-probe': 'contacts' }).children).toEqual(['1'])
  expect(lifecycle.mounts).toEqual({ conversations: 1, contacts: 1 })
  expect(lifecycle.unmounts).toEqual({ conversations: 0, contacts: 0 })
})

it('discards retained component state when the authenticated account changes', async () => {
  await act(async () => { view = create(<ArkmePersistentSidebar {...props as never} />) })
  await act(async () => { view.root.findByProps({ 'data-probe': 'conversations' }).props.onClick() })
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10002 }) })
  expect(lifecycle.mounts.conversations).toBe(2)
  expect(lifecycle.unmounts.conversations).toBe(1)
  expect(view.root.findByProps({ 'data-probe': 'conversations' }).children).toEqual(['0'])
})
