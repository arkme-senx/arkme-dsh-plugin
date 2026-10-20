import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkmeRecentEmojiStore } from '../src/client/emoji-recent-store.js'

const { callArkme } = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))
afterEach(() => { arkmeRecentEmojiStore.clear(); callArkme.mockReset() })

describe('recent emoji client persistence boundary', () => {
  it('reports a failed selection to its caller while letting readers and later selections recover', async () => {
    let fail!: (reason: Error) => void
    callArkme.mockImplementationOnce(async () => await new Promise((_resolve, reject) => { fail = reject }))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['joy_face'])
    const write = arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'angry_face')
    const read = arkmeRecentEmojiStore.recentEmojiIds('test:42')
    const result = Promise.allSettled([write, read])
    await Promise.resolve()
    fail(new Error('write not confirmed'))
    expect(await result).toEqual([
      { status: 'rejected', reason: new Error('write not confirmed') },
      { status: 'fulfilled', value: ['angry_face'] },
    ])
    await expect(arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'joy_face')).resolves.toEqual(['joy_face'])
  })

  it('keeps independent callers ordered without requiring a mounted picker', async () => {
    let finish!: () => void
    let ids: string[] = []
    callArkme.mockImplementation(async (operation: string, params: { emojiId: string }) => {
      if (operation === 'emoji.recent.list') return [...ids]
      if (params.emojiId === 'angry_face') await new Promise<void>(resolve => { finish = resolve })
      ids = [params.emojiId, ...ids.filter(id => id !== params.emojiId)]
      return [...ids]
    })
    const first = arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'angry_face')
    const second = arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'joy_face')
    const read = arkmeRecentEmojiStore.recentEmojiIds('test:42')
    await Promise.resolve()
    expect(callArkme).toHaveBeenCalledTimes(1)
    finish()
    await expect(first).resolves.toEqual(['angry_face'])
    await expect(second).resolves.toEqual(['joy_face', 'angry_face'])
    await expect(read).resolves.toEqual(['joy_face', 'angry_face'])
  })
})

it('shares pending loads and keeps unconfirmed selections when a panel is recreated', async()=>{
 let finish!:(ids:string[])=>void
 callArkme.mockImplementationOnce(()=>new Promise<string[]>(done=>{finish=done}))
 const first=arkmeRecentEmojiStore.recentEmojiIds('prod:7'),second=arkmeRecentEmojiStore.recentEmojiIds('prod:7')
 await Promise.resolve();expect(callArkme).toHaveBeenCalledTimes(1)
 finish(['joy_face']);await Promise.all([first,second])
 callArkme.mockRejectedValueOnce(new Error('disk'))
 await expect(arkmeRecentEmojiStore.recordRecentEmoji('prod:7','angry_face')).rejects.toThrow('disk')
 callArkme.mockResolvedValueOnce(['joy_face'])
 await arkmeRecentEmojiStore.recentEmojiIds('prod:7')
 expect(arkmeRecentEmojiStore.snapshot('prod:7')).toMatchObject({ids:['angry_face','joy_face'],failedId:'angry_face'})
 callArkme.mockResolvedValueOnce(['angry_face','joy_face'])
 await arkmeRecentEmojiStore.recordRecentEmoji('prod:7','angry_face')
 expect(arkmeRecentEmojiStore.snapshot('prod:7').failedId).toBeUndefined()
})
it('shares optimistic changes and durable acknowledgements with two mounted consumers', async()=>{
 const a=vi.fn(),b=vi.fn(),stopA=arkmeRecentEmojiStore.subscribe('prod:7',a),stopB=arkmeRecentEmojiStore.subscribe('prod:7',b)
 callArkme.mockResolvedValueOnce(['joy_face'])
 await arkmeRecentEmojiStore.recordRecentEmoji('prod:7','joy_face')
 expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(2)
 stopA();stopB();callArkme.mockResolvedValueOnce(['angry_face','joy_face'])
 await arkmeRecentEmojiStore.recordRecentEmoji('prod:7','angry_face');expect(a).toHaveBeenCalledTimes(2)
})
it('bounds pending selections rather than building an unbounded command chain', async()=>{
 let finish!:()=>void
 callArkme.mockImplementation(async()=>{await new Promise<void>(done=>{finish=done});return ['joy_face']})
 const writes=Array.from({length:64},()=>arkmeRecentEmojiStore.recordRecentEmoji('prod:7','joy_face'))
 await expect(arkmeRecentEmojiStore.recordRecentEmoji('prod:7','angry_face')).rejects.toThrow('繁忙')
 for(let i=0;i<64;i++){await vi.waitFor(()=>expect(callArkme).toHaveBeenCalledTimes(i+1));finish()}
 await Promise.all(writes)
})
it('does not let a stalled preference queue block the native draft exit barrier', async()=>{
 vi.useFakeTimers()
 let finish!:(ids:string[])=>void
 callArkme.mockImplementationOnce(()=>new Promise<string[]>(done=>{finish=done}))
 const write=arkmeRecentEmojiStore.recordRecentEmoji('test:42','joy_face')
 let closed=false
 const close=arkmeRecentEmojiStore.flush('test:42').then(()=>{closed=true})
 await vi.advanceTimersByTimeAsync(1999);expect(closed).toBe(false)
 await vi.advanceTimersByTimeAsync(1);await close;expect(closed).toBe(true)
 finish(['joy_face']);await write;expect(vi.getTimerCount()).toBe(0)
 vi.useRealTimers()
})
