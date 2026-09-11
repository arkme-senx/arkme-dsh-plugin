import { describe, expect, it } from 'vitest'
import { ArkmeHomeTourSession, homeTourAccountKey } from '../src/client/home-tour-session.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('home tour account and session memory', () => {
  it('only accepts an authenticated account with a valid user ID', () => {
    expect(homeTourAccountKey(undefined)).toBeUndefined()
    expect(homeTourAccountKey({ status: 'binding-required', environment: 'prod', userId: 1 })).toBeUndefined()
    expect(homeTourAccountKey({ status: 'authenticated', environment: 'prod' })).toBeUndefined()
    expect(homeTourAccountKey({ status: 'authenticated', environment: 'prod', userId: 0 })).toBeUndefined()
    expect(homeTourAccountKey({ status: 'authenticated', environment: 'prod', userId: 12 })).toBe('prod:12')
  })

  it('does not restart an interrupted tour in this page session, but starts on the next visit', () => {
    const storage = memoryStorage()
    const session = new ArkmeHomeTourSession(() => storage)
    expect(session.tryStart('prod:1')).toBe(true)
    expect(session.tryStart('prod:1')).toBe(false)
    expect(new ArkmeHomeTourSession(() => storage).tryStart('prod:1')).toBe(true)
  })

  it('remembers a dismissed tour across page sessions and isolates accounts and environments', () => {
    const storage = memoryStorage()
    const session = new ArkmeHomeTourSession(() => storage)
    session.tryStart('prod:1')
    session.finish('prod:1')
    const nextVisit = new ArkmeHomeTourSession(() => storage)
    expect(nextVisit.tryStart('prod:1')).toBe(false)
    expect(nextVisit.tryStart('prod:2')).toBe(true)
    expect(nextVisit.tryStart('test:1')).toBe(true)
  })

  it('keeps session memory when accessing or writing storage fails', () => {
    for (const getStorage of [
      () => undefined,
      () => { throw new Error('storage denied') },
      () => ({ getItem: () => null, setItem: () => { throw new Error('quota exceeded') } }),
    ]) {
      const session = new ArkmeHomeTourSession(getStorage)
      expect(session.tryStart('prod:1')).toBe(true)
      expect(() => session.finish('prod:1')).not.toThrow()
      expect(session.tryStart('prod:1')).toBe(false)
    }
  })
})
