import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import type { OfflineContextEntry, OfflineContextList } from '../src/offline-context-contract.js'

// This is a component → public SDK → real Host → native services test, not a
// browser/layout or model-quality test. The caller supplies an isolated DSH
// with synthetic auth/ASR/provider fixtures; never point it at a real account.
vi.mock('../src/sdk/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/sdk/index.js')>()
  return { ...actual, createArkmeSdk: () => actual.createArkmeSdk({
    fetchImpl: (input, init) => {
      const origin = process.env.ARKME_OFFLINE_CONTEXT_NATIVE_HOST!
      const url = new URL(origin)
      if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('isolated loopback Host required')
      const headers = new Headers(init?.headers)
      headers.set('Origin', origin)
      return fetch(new URL(String(input), origin), { ...init, headers })
    },
  }) }
})
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: {} }))

import { createArkmeSdk } from '../src/sdk/index.js'
import { OfflineContextConnected } from '../src/client/offline-context/OfflineContextConnected.js'

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'props' in value) return text((value as { props: { children?: unknown } }).props.children)
  return typeof value === 'string' ? value : ''
}

it.skipIf(!process.env.ARKME_OFFLINE_CONTEXT_NATIVE_HOST)('executes the existing card confirmation, frozen preview, sharing and withdrawal through native services', async () => {
  const sdk = createArkmeSdk()
  const title = process.env.ARKME_OFFLINE_CONTEXT_NATIVE_CHAT
  expect(title, 'unique synthetic conversation title is required').toBeTruthy()
  const directory = await sdk.listSources('root', { refresh: true })
  const source = directory.items.find(item => item.displayName === title)
  expect(source).toBeDefined()
  const list = await sdk.offlineContext({ operation: 'list', sourceRef: source!.sourceRef, state: 'suggested' }) as OfflineContextList
  expect(list.entries).toHaveLength(1)
  const initial = list.entries[0]!
  let renderer!: ReactTestRenderer
  const button = (label: string) => renderer.root.findAllByType('button').find(node => text(node.props.children).trim() === label)
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 30000
    while (!check() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
    expect(check()).toBe(true)
  }
  const click = async (label: string) => {
    await until(() => !!button(label) && !button(label)!.props.disabled)
    await act(async () => { button(label)!.props.onClick() })
  }
  try {
    await act(async () => { renderer = create(<OfflineContextConnected entryRef={initial.id} revision={initial.revision} title={initial.title} source={source!} />) })
    await until(() => !!button('是这次交流'))
    expect(renderer.root.findByType('article').props['data-offline-context-id']).toBe(initial.id)
    await click('是这次交流')
    await until(() => !!button('分享到此对话') && !button('分享到此对话')!.props.disabled)
    await click('分享到此对话')
    await until(() => !!button('确认分享') && !button('确认分享')!.props.disabled)
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    expect(text(dialog.findByType('ul'))).toContain('还没有实施')
    expect((await sdk.offlineContext({ operation: 'read', entryRef: initial.id }) as OfflineContextEntry).hasSharedSnapshot).toBe(false)
    await click('确认分享')
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (button('核对状态')) await click('核对状态')
      const current = await sdk.offlineContext({ operation: 'read', entryRef: initial.id }) as OfflineContextEntry
      if (current.hasSharedSnapshot && !button('核对状态')) break
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    }
    expect((await sdk.offlineContext({ operation: 'read', entryRef: initial.id }) as OfflineContextEntry).hasSharedSnapshot).toBe(true)
    await until(() => !renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.disabled)
    await act(async () => { renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.onClick() })
    await click('撤回已分享消息')
    await click('确认撤回')
    await until(() => !button('确认撤回'))
    const final = await sdk.offlineContext({ operation: 'read', entryRef: initial.id }) as OfflineContextEntry
    expect(final.hasSharedSnapshot).toBe(false)
    expect(final.state).toBe('linked')
    expect(final.evidence[0]?.text).toContain('还没有实施')
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
  }
}, 90000)
