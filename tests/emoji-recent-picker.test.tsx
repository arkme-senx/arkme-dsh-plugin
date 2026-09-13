import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeEmojiPicker } from '../src/client/ArkmeEmojiPicker.js'

const { callArkme } = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))
let renderer: ReactTestRenderer | undefined
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; callArkme.mockReset(); vi.restoreAllMocks(); vi.useRealTimers() })
async function mount(accountKey = 'prod:42', onError = vi.fn()) {
  await act(async () => { renderer = create(<ArkmeEmojiPicker disabled={false} accountKey={accountKey} scopeKey="chat:1" onSelect={() => undefined} onError={onError} />) })
}
async function toggle() { await act(async () => renderer!.root.findByProps({ 'aria-label': '选择表情' }).props.onClick()) }
function recentIds() {
  return renderer!.root.findAllByProps({ 'data-arkme-emoji-grid': 'compact' })
    .flatMap(grid => grid.findAllByType('button').map(button => button.props['data-arkme-emoji-id']))
}

describe('recent emoji picker', () => {
  it('does not make another account wait for a pending save', async () => {
    let finishSave!: (ids: string[]) => void
    callArkme.mockImplementation(async (operation: string, params: { accountKey: string }) => {
      if (operation === 'emoji.recent.list') return []
      if (params.accountKey === 'prod:42') return await new Promise<string[]>(resolve => { finishSave = resolve })
      return ['joy_face']
    })
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    await act(async () => renderer!.unmount())
    await mount('prod:43'); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'joy_face' }).props.onClick())
    expect(recentIds()).toEqual(['joy_face'])
    await act(async () => { finishSave(['angry_face']) })
    expect(recentIds()).toEqual(['joy_face'])
  })

  it('preserves selection order when the next conversation selects before the old save finishes', async () => {
    let finishSave!: () => void
    let persisted: string[] = []
    callArkme.mockImplementation(async (operation: string, params: { emojiId?: string }) => {
      if (operation === 'emoji.recent.list') return [...persisted]
      if (params.emojiId === 'angry_face') await new Promise<void>(resolve => { finishSave = resolve })
      persisted = [params.emojiId!, ...persisted]
      return [...persisted]
    })
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    await act(async () => renderer!.unmount())
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'joy_face' }).props.onClick())
    expect(callArkme).toHaveBeenCalledTimes(2)
    await act(async () => { finishSave() })
    expect(recentIds()).toEqual(['joy_face', 'angry_face'])
  })

  it('ignores an earlier open response after a later open has loaded', async () => {
    let finishFirst!: (ids: string[]) => void
    callArkme.mockImplementationOnce(async () => await new Promise<string[]>(resolve => { finishFirst = resolve }))
      .mockResolvedValueOnce(['joy_face'])
    await mount(); await toggle(); await toggle(); await toggle()
    expect(recentIds()).toEqual(['joy_face'])
    await act(async () => { finishFirst(['angry_face']) })
    expect(recentIds()).toEqual(['joy_face'])
  })

  it('waits for accepted selections across conversation panel remounts', async () => {
    let finishSave!: () => void
    let persisted: string[] = []
    callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'emoji.recent.list') return [...persisted]
      await new Promise<void>(resolve => { finishSave = resolve })
      persisted = ['angry_face']
      return persisted
    })
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    await act(async () => renderer!.unmount())
    await mount(); await toggle()
    await act(async () => { finishSave() })
    expect(recentIds()).toEqual(['angry_face'])
  })
  it('keeps a save failure visible when reopening starts a new read', async () => {
    let rejectSave!: (reason: Error) => void
    callArkme.mockResolvedValueOnce([])
      .mockImplementationOnce(async () => await new Promise((_resolve, reject) => { rejectSave = reject }))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['angry_face'])
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    await toggle(); await toggle()
    await act(async () => { rejectSave(new Error('disk full')) })
    expect(renderer!.root.findByProps({ 'aria-label': '重试保存最近表情' })).toBeDefined()
    await act(async () => renderer!.root.findByProps({ 'aria-label': '重试保存最近表情' }).props.onClick())
    expect(recentIds()).toEqual(['angry_face'])
  })
  it('retries only persistence without inserting a second emoji or surfacing a conversation error', async () => {
    const onSelect = vi.fn()
    const onError = vi.fn()
    callArkme.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(['angry_face'])
    await act(async () => { renderer = create(<ArkmeEmojiPicker disabled={false} accountKey="prod:42" scopeKey="chat:1" onSelect={onSelect} onError={onError} />) })
    await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    expect(onSelect).toHaveBeenCalledTimes(1)
    await act(async () => renderer!.root.findByProps({ 'aria-label': '重试保存最近表情' }).props.onClick())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(recentIds()).toEqual(['angry_face'])
    expect(renderer!.root.findAllByProps({ 'aria-label': '重试保存最近表情' })).toHaveLength(0)
  })

  it('bounds a stalled save so later selections recover while insertion remains immediate', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    })
    const onSelect = vi.fn()
    callArkme.mockResolvedValueOnce([])
      .mockImplementationOnce(async (_operation, _params, signal: AbortSignal | undefined) => await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }))
      .mockResolvedValueOnce(['joy_face'])
    await act(async () => { renderer = create(<ArkmeEmojiPicker disabled={false} accountKey="prod:42" scopeKey="chat:1" onSelect={onSelect} />) })
    await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'joy_face' }).props.onClick())
    expect(onSelect).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(callArkme).toHaveBeenCalledTimes(3)
    expect(recentIds()).toEqual(['joy_face'])
  })
  it('serializes rapid selections and continues after a failed save', async () => {
    let rejectFirst!: (reason: Error) => void
    callArkme.mockResolvedValueOnce([])
      .mockImplementationOnce(async () => await new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce(['joy_face'])
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'joy_face' }).props.onClick())
    expect(callArkme).toHaveBeenCalledTimes(2)
    await act(async () => { rejectFirst(new Error('write failed')) })
    expect(callArkme).toHaveBeenCalledTimes(3)
    expect(recentIds()).toEqual(['joy_face'])
  })
  it('restores without browser storage and refreshes on every open', async () => {
    callArkme.mockResolvedValueOnce(['angry_face']).mockResolvedValueOnce(['joy_face', 'angry_face'])
    await mount(); await toggle()
    expect(recentIds()).toEqual(['angry_face'])
    await toggle(); await toggle()
    expect(recentIds()).toEqual(['joy_face', 'angry_face'])
    expect(callArkme).toHaveBeenCalledWith('emoji.recent.list', { accountKey: 'prod:42' }, expect.any(AbortSignal))
  })

  it('does not let a late restore erase a newer selection', async () => {
    let finish!: (ids: string[]) => void
    callArkme.mockImplementation(async (operation: string) => operation === 'emoji.recent.list'
      ? await new Promise<string[]>(resolve => { finish = resolve }) : ['joy_face', 'angry_face'])
    await mount(); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'joy_face' }).props.onClick())
    await act(async () => { finish(['angry_face']) })
    expect(recentIds()).toEqual(['joy_face', 'angry_face'])
    expect(callArkme).toHaveBeenCalledWith('emoji.recent.record', { accountKey: 'prod:42', emojiId: 'joy_face' }, expect.any(AbortSignal))
  })

  it('clears the old account and ignores its late response', async () => {
    let finish!: (ids: string[]) => void
    callArkme.mockImplementation(async (_operation: string, params: { accountKey: string }) => params.accountKey === 'prod:42'
      ? await new Promise<string[]>(resolve => { finish = resolve }) : [])
    await mount(); await toggle()
    await act(async () => renderer!.update(<ArkmeEmojiPicker disabled={false} accountKey="prod:43" scopeKey="chat:1" onSelect={() => undefined} />))
    await act(async () => { finish(['angry_face']) })
    await toggle()
    expect(recentIds()).toEqual([])
  })

  it('keeps defaults usable on load failure and shows retry', async () => {
    callArkme.mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce(['joy_face'])
    await mount(); await toggle()
    expect(renderer!.root.findByProps({ 'data-arkme-emoji-grid': 'default' })).toBeDefined()
    await act(async () => renderer!.root.findByProps({ 'aria-label': '重试加载最近表情' }).props.onClick())
    expect(recentIds()).toEqual(['joy_face'])
  })

  it('reports failed persistence instead of silently implying durable success', async () => {
    callArkme.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('disk full'))
    const onError = vi.fn()
    await mount('prod:42', onError); await toggle()
    await act(async () => renderer!.root.findByProps({ 'data-arkme-emoji-id': 'angry_face' }).props.onClick())
    expect(onError).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ 'aria-label': '重试保存最近表情' })).toBeDefined()
  })
})
