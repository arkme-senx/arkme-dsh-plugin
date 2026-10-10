import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
import { ArkmeLongArticleEditor } from '../src/client/ArkmeLongArticleEditor.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeLongArticleEditor.js', () => ({ ArkmeLongArticleEditor: () => null }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { confirm: () => true, addEventListener: vi.fn(), removeEventListener: vi.fn(), setInterval, clearInterval })
  mocks.call.mockImplementation(async (operation: string) => {
    if (operation === 'provider.capabilities') return { features: { markdownLongArticles: true } }
    return undefined
  })
})
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount())
  renderer = undefined
  vi.useRealTimers(); vi.unstubAllGlobals(); mocks.call.mockReset()
})
it('shows image insertion errors as an expiring overlay toast instead of a page alert', async () => {
  await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="source" onClose={() => {}} />) })
  const editor = renderer!.root.findByType(ArkmeLongArticleEditor)
  await act(async () => { editor.props.onError('large.png：超过单图上限 50 MiB') })
  expect(renderer!.root.findAll(node => node.props.role === 'alert')).toHaveLength(0)
  const toast = renderer!.root.find(node => node.props['data-arkme-file-action-toast'] === 'error')
  expect(toast.children).toContain('large.png：超过单图上限 50 MiB')
  expect(toast.parent!.props.style.position).toBe('fixed')
  await act(async () => { vi.advanceTimersByTime(4000) })
  await act(async () => { editor.props.onError('empty.png：文件为空') })
  await act(async () => { vi.advanceTimersByTime(1000) })
  expect(JSON.stringify(renderer!.toJSON())).toContain('empty.png：文件为空')
  await act(async () => { vi.advanceTimersByTime(4000) })
  expect(renderer!.root.findAll(node => node.props['data-arkme-file-action-toast'] === 'error')).toHaveLength(0)
})
