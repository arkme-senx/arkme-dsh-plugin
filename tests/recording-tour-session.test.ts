import { expect, it } from 'vitest'
import { ArkmeRecordingTourSession } from '../src/client/recording-tour-session.js'
it('isolates recording completion from home and other environments/accounts, and retries interruptions next page', () => {
 const data = new Map([['dsh-arkme:home-tour:v1:prod:1', 'done']])
 const storage = () => ({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v) } })
 const session = new ArkmeRecordingTourSession(storage)
 expect(session.tryStart('prod:1')).toBe(true)
 expect(session.tryStart('prod:1')).toBe(false)
 expect(new ArkmeRecordingTourSession(storage).tryStart('prod:1')).toBe(true)
 session.finish('prod:1')
 expect(new ArkmeRecordingTourSession(storage).tryStart('prod:1')).toBe(false)
 expect(session.tryStart('test:1')).toBe(true)
 expect(session.tryStart('prod:2')).toBe(true)
 expect(data.get('dsh-arkme:home-tour:v1:prod:1')).toBe('done')
})
it('keeps completion and interruption memory when storage access throws', () => {
 const session = new ArkmeRecordingTourSession(() => { throw Error('denied') })
 expect(session.tryStart('prod:1')).toBe(true)
 session.finish('prod:1')
 expect(session.tryStart('prod:1')).toBe(false)
})
