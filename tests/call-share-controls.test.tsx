import { act, create } from 'react-test-renderer'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ArkmeCallShareControls } from '../src/client/ArkmeCallShareControls.js'
const api = vi.hoisted(() => vi.fn())
const copy = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: copy }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: (props: Record<string, unknown>) => <span data-viewer-avatar {...props} /> }))
afterEach(() => vi.useRealTimers())
beforeEach(() => { api.mockReset(); copy.mockReset() })
describe('call detail sharing', () => {
 it('copies the owner URL and loads viewers on hover', async () => {
  api.mockImplementation(async (action: string) => action.endsWith('ensure') ? { url: 'https://jiwo.cc/share/call/ref' } : { items: [{ viewId: 'a'.repeat(24), userId: 7, displayName: '外部访客', viewedAtMillis: 1750000000000 }], nextCursor: '' })
  copy.mockResolvedValue(undefined)
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="account-bound-ref" />) })
  expect(api).not.toHaveBeenCalled()
  expect(view.root.findAllByType('button')).toHaveLength(1)
  await act(async () => { view.root.findByProps({ 'aria-label': '分享' }).props.onClick() })
  expect(JSON.stringify(view.toJSON())).toContain('链接已复制')
  expect(copy).toHaveBeenCalledWith('https://jiwo.cc/share/call/ref')
  await act(async () => { view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter() })
  expect(JSON.stringify(view.toJSON())).toContain('外部访客')
  expect(api).toHaveBeenCalledWith('calls.share.viewers', expect.objectContaining({ callRef: 'account-bound-ref' }), expect.any(AbortSignal))
  act(() => view.unmount())
 })
 it('does not report clipboard failure as success and permits retry', async () => {
  api.mockResolvedValue({ url: 'https://jiwo.cc/share/call/ref' }); copy.mockRejectedValue(new Error('denied'))
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
  await act(async () => { view.root.findByProps({ 'aria-label': '分享' }).props.onClick() })
  expect(JSON.stringify(view.toJSON())).toContain('复制链接失败，请重试')
  expect(JSON.stringify(view.toJSON())).not.toContain('链接已复制')
  expect(view.root.findByProps({ 'aria-label': '分享' }).props['aria-disabled']).toBe(false)
  act(() => view.unmount())
 })
 it('ignores old requests and resets history when switching calls', async () => {
  let resolve!: (v: unknown) => void
  api.mockImplementation(() => new Promise(r => { resolve = r }))
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="a" />) })
  act(() => { view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter() })
  const signal = api.mock.calls[0][2] as AbortSignal
  await act(async () => { view.update(<ArkmeCallShareControls callRef="b" />) })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve({ items: [{ viewId: 'c'.repeat(24), userId: 1, displayName: '旧通话访客', viewedAtMillis: 1 }], nextCursor: '' }) })
  expect(JSON.stringify(view.toJSON())).not.toContain('旧通话访客')
  act(() => view.unmount())
 })
 it('copies once for repeated clicks while the share request is pending', async () => {
  let resolve!: (value: { url: string }) => void
  api.mockImplementation(() => new Promise(r => { resolve = r }))
  copy.mockResolvedValue(undefined)
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
  act(() => {
   const share = view.root.findByProps({ 'aria-label': '分享' })
   share.props.onClick()
   share.props.onClick()
  })
  expect(api).toHaveBeenCalledTimes(1)
  expect(copy).not.toHaveBeenCalled()
  expect(view.root.findByProps({ 'aria-label': '分享' }).props['aria-disabled']).toBe(true)
  await act(async () => { resolve({ url: 'https://jiwo.cc/share/call/stable' }) })
  expect(copy).toHaveBeenCalledExactlyOnceWith('https://jiwo.cc/share/call/stable')
  expect(JSON.stringify(view.toJSON())).toContain('链接已复制')
  expect(view.root.findByProps({ 'aria-label': '分享' }).props['aria-disabled']).toBe(false)
  act(() => view.unmount())
 })
 it('does not copy a late share URL after the detail is closed', async () => {
  let resolve!: (value: { url: string }) => void
  api.mockImplementation(() => new Promise(r => { resolve = r }))
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
  act(() => { view.root.findByProps({ 'aria-label': '分享' }).props.onClick() })
  const signal = api.mock.calls[0][2] as AbortSignal
  act(() => view.unmount())
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve({ url: 'https://jiwo.cc/share/call/late' }) })
  expect(copy).not.toHaveBeenCalled()
 })
 it('retries the failed viewer page and replaces all old pages when refreshed', async () => {
  const first = { viewId: 'a'.repeat(24), userId: 7, displayName: '较新访客', viewedAtMillis: 1750000000000 }
  const second = { viewId: 'b'.repeat(24), userId: 8, displayName: '较早访客', viewedAtMillis: 1749999999000 }
  api.mockResolvedValueOnce({ items: [first], nextCursor: '1750000000000:aaaaaaaaaaaaaaaaaaaaaaaa' })
   .mockRejectedValueOnce(new Error('owner unavailable'))
   .mockResolvedValueOnce({ items: [second], nextCursor: '' })
   .mockResolvedValueOnce({ items: [{ ...second, viewId: 'c'.repeat(24), displayName: '再次查看的访客', viewedAtMillis: 1750000001000 }], nextCursor: '' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
  const action = (label: string) => view.root.findAllByType('button').find(button => button.children.join('') === label)!
  await act(async () => { view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter() })
  await act(async () => { action('加载更多').props.onClick() })
  expect(JSON.stringify(view.toJSON())).toContain('查看记录加载失败')
  expect(JSON.stringify(view.toJSON())).toContain('较新访客')
  await act(async () => { action('重试').props.onClick() })
  expect(api.mock.calls.slice(1, 3).map(call => call[1])).toEqual([
   { callRef: 'ref', cursor: '1750000000000:aaaaaaaaaaaaaaaaaaaaaaaa' },
   { callRef: 'ref', cursor: '1750000000000:aaaaaaaaaaaaaaaaaaaaaaaa' },
  ])
  expect(view.root.findAllByType('li')).toHaveLength(2)
  expect(JSON.stringify(view.toJSON())).toContain('较早访客')
  expect(JSON.stringify(view.toJSON())).not.toContain('查看记录加载失败')
  await act(async () => { action('刷新').props.onClick() })
  expect(api).toHaveBeenLastCalledWith('calls.share.viewers', { callRef: 'ref', cursor: '' }, expect.any(AbortSignal))
  expect(view.root.findAllByType('li')).toHaveLength(1)
  expect(JSON.stringify(view.toJSON())).toContain('再次查看的访客')
  expect(JSON.stringify(view.toJSON())).not.toContain('较新访客')
  expect(JSON.stringify(view.toJSON())).not.toContain('较早访客')
  act(() => view.unmount())
 })
})

describe('viewer hover lifecycle', () => {
 it('closes on pointer leave and ignores late results before a fresh hover', async () => {
  let resolve!: (value: unknown) => void
  api.mockImplementationOnce(() => new Promise(r => { resolve = r }))
   .mockResolvedValueOnce({ items: [], nextCursor: '' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
  act(() => view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter())
  const signal = api.mock.calls[0][2] as AbortSignal
  act(() => view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseLeave())
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ items: [{ viewId: 'a'.repeat(24), userId: 7, displayName: '迟到访客', viewedAtMillis: 1 }], nextCursor: '' }))
  expect(view.root.findAllByProps({ role: 'region' })).toHaveLength(0)
  await act(async () => view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter())
  expect(api).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(view.toJSON())).not.toContain('迟到访客')
  expect(JSON.stringify(view.toJSON())).toContain('暂无外部人员查看')
  act(() => view.unmount())
 })
 it('supports keyboard focus, internal focus movement and Escape', async () => {
  api.mockResolvedValue({ items: [], nextCursor: '' })
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
  await act(async () => view.root.findByProps({ 'data-call-share-trigger': true }).props.onFocusCapture())
  expect(view.root.findByProps({ 'aria-label': '分享' }).props['aria-expanded']).toBe(true)
  act(() => view.root.findByProps({ 'data-call-share-trigger': true }).props.onBlurCapture({ currentTarget: { contains: () => true }, relatedTarget: {} }))
  expect(view.root.findAllByProps({ role: 'region' })).toHaveLength(1)
  act(() => view.root.findByProps({ 'data-call-share-trigger': true }).props.onKeyDown({ key: 'Escape', stopPropagation: vi.fn() }))
  expect(view.root.findAllByProps({ role: 'region' })).toHaveLength(0)
  await act(async () => view.root.findByProps({ 'data-call-share-trigger': true }).props.onFocusCapture())
  act(() => view.root.findByProps({ 'data-call-share-trigger': true }).props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null }))
  expect(view.root.findAllByProps({ role: 'region' })).toHaveLength(0)
  act(() => view.unmount())
 })
})

it('dismisses copy success after three seconds and resets the timer on another copy', async () => {
 vi.useFakeTimers()
 api.mockResolvedValue({ url: 'https://jiwo.cc/share/call/ref' }); copy.mockResolvedValue(undefined)
 let view!: ReturnType<typeof create>
 await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
 const share = () => view.root.findByProps({ 'aria-label': '分享' }).props.onClick()
 await act(async () => share())
 act(() => vi.advanceTimersByTime(2000))
 await act(async () => share())
 act(() => vi.advanceTimersByTime(1000))
 expect(JSON.stringify(view.toJSON())).toContain('链接已复制')
 act(() => vi.advanceTimersByTime(2000))
 expect(JSON.stringify(view.toJSON())).not.toContain('链接已复制')
 await act(async () => share())
 act(() => view.update(<ArkmeCallShareControls callRef="next" />))
 expect(vi.getTimerCount()).toBe(0)
 expect(JSON.stringify(view.toJSON())).not.toContain('链接已复制')
 act(() => view.unmount())
})
it('renders viewer avatars and names without displaying internal IDs', async () => {
 api.mockResolvedValue({ items: [{ viewId: 'd'.repeat(24), userId: 987654321, displayName: '访客甲', avatarRef: 'avatar-ref', viewedAtMillis: 1750000000000 }], nextCursor: '' })
 let view!: ReturnType<typeof create>
 await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
 await act(async () => view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter())
 expect(view.root.findByProps({ 'data-viewer-avatar': true }).props.avatarRef).toBe('avatar-ref')
 expect(JSON.stringify(view.toJSON())).not.toContain('987654321')
 expect(JSON.stringify(view.toJSON())).toContain('访客甲')
 act(() => view.unmount())
})

it('keeps separate visits by the same person across pages and deduplicates only an identical event', async () => {
 const first = { viewId: 'a'.repeat(24), userId: 7, displayName: '同一访客', viewedAtMillis: 1750000000000 }
 const second = { ...first, viewId: 'b'.repeat(24) }
 api.mockResolvedValueOnce({ items: [first], nextCursor: 'next' }).mockResolvedValueOnce({ items: [first, second], nextCursor: '' })
 let view!: ReturnType<typeof create>
 await act(async () => { view = create(<ArkmeCallShareControls callRef="ref" />) })
 await act(async () => view.root.findByProps({ 'data-call-share-trigger': true }).props.onMouseEnter())
 await act(async () => view.root.findAllByType('button').find(button => button.children.join('') === '加载更多')!.props.onClick())
 expect(view.root.findAllByType('li')).toHaveLength(2)
 act(() => view.unmount())
})
