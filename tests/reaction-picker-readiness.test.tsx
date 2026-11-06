import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeReactionPreview } from '../src/client/ArkmeReactionPreview.js'
import { ArkmeReactionPhrases } from '../src/client/ArkmeReactionPhrases.js'
import { ReactionPreviewStore } from '../src/client/reaction-preview-store.js'
import { ReactionLibraryStore } from '../src/client/reaction-library.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'
import type { ReactionRequest } from '../src/reaction-contract.js'
import { reactionFixture } from './reaction-fixture.js'

vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let view: ReactTestRenderer | undefined
const scopes: Array<{ setScope(scope?: string): void }> = []
beforeEach(() => { vi.useFakeTimers(); reactionFixture.reset() })
afterEach(async () => {
  await act(async () => view?.unmount()); view = undefined
  scopes.forEach(store => store.setScope(undefined)); scopes.length = 0; vi.useRealTimers()
})

it('keeps confirmed phrases usable during refresh without letting that read unlock a later save', async () => {
  const refresh = deferred<unknown>(), save = deferred<unknown>()
  const cached = { revision: 1, items: [{ text: '已有短语' }] }
  let queries = 0
  const library = new ReactionLibraryStore(request => request.action === 'library-query'
    ? ++queries === 1 ? Promise.resolve(cached) : refresh.promise : save.promise)
  scopes.push(library); library.setScope('test:1'); await library.load('test:1')
  const use = vi.fn(async () => true)
  await act(async () => { view = create(<ArkmeReactionPhrases scope="test:1" library={library} selected={[]} onUse={use} />) })
  expect(queries).toBe(2)
  expect(view!.root.findByProps({ 'aria-label': '已有短语' }).props.disabled).toBe(false)
  expect(view!.root.findByProps({ 'aria-label': '新建自定义短语' }).props.disabled).toBe(false)
  await act(async () => view!.root.findByProps({ 'aria-label': '已有短语' }).props.onClick())
  expect(use).toHaveBeenCalledWith('已有短语', { text: '已有短语' })
  await act(async () => view!.root.findByProps({ 'aria-label': '新建自定义短语' }).props.onClick())
  await act(async () => view!.root.findByProps({ 'aria-label': '自定义表态短语' }).props.onChange({ target: { value: '新的短语' } }))
  let saving!: Promise<void>
  await act(async () => { saving = view!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(view!.root.findByProps({ type: 'submit' }).props.disabled).toBe(true)
  await act(async () => refresh.resolve(cached))
  expect(view!.root.findByProps({ type: 'submit' }).props.disabled).toBe(true)
  await act(async () => { save.resolve({ outcome: 'updated', library: { revision: 2, items: [{ text: '新的短语' }] } }); await saving })
})

it('shows an explicit initial phrase load and never reuses a previous account library', async () => {
  const read = deferred<unknown>()
  const library = new ReactionLibraryStore(() => read.promise)
  scopes.push(library); library.setScope('test:2')
  await act(async () => { view = create(<ArkmeReactionPhrases scope="test:2" library={library} selected={[]} onUse={async () => true} />) })
  expect(view!.root.findByProps({ 'aria-label': '新建自定义短语' }).props.disabled).toBe(true)
  expect(JSON.stringify(view!.toJSON())).toContain('正在加载短语')
  await act(async () => { library.setScope('test:3'); read.resolve({ revision: 1, items: [{ text: '旧账号短语' }] }) })
  expect(JSON.stringify(view!.toJSON())).not.toContain('旧账号短语')
})

it.each(['success', 'failure'] as const)('shows pending emoji submission before its %s receipt', async outcome => {
  const write = deferred<unknown>()
  let command: ReactionRequest | undefined
  const library = new ReactionLibraryStore(input => reactionFixture.call('reactions', input))
  const store = new ReactionPreviewStore(input => {
    if (input.action === 'set') { command = input; return write.promise }
    return reactionFixture.call('reactions', input)
  }, library)
  scopes.push(store); store.setScope('test:1')
  const target = { id: 'clicked', source: '本地测试', text: '内容', sourceRef: 'fixture-source', messageActionRef: 'fixture-message' }
  await act(async () => { view = create(<ArkmeReactionPreview scope="test:1" target={target} store={store} library={library} />) })
  await act(async () => view!.root.findByProps({ 'aria-label': '表态' }).props.onClick())
  let clicking!: Promise<boolean>
  await act(async () => { clicking = view!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.onClick() })
  expect(command?.action).toBe('set')
  expect(view!.root.findByProps({ 'aria-label': '表态面板' }).props['aria-busy']).toBe(true)
  expect(JSON.stringify(view!.toJSON())).toContain('正在提交表态')
  expect(view!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.disabled).toBe(true)
  await act(async () => {
    if (outcome === 'success') write.resolve(await reactionFixture.call('reactions', command!))
    else write.reject(new Error('本地模拟提交失败'))
    await clicking
  })
  if (outcome === 'success') expect(view!.root.findAllByProps({ 'aria-label': '表态面板' })).toHaveLength(0)
  else {
    expect(view!.root.findByProps({ 'aria-label': '表态面板' }).props['aria-busy']).toBe(false)
    expect(JSON.stringify(view!.toJSON())).toContain('本地模拟提交失败')
    expect(view!.root.findByProps({ 'aria-label': arkmeDefaultEmojis[0]!.label }).props.disabled).toBe(false)
  }
})
