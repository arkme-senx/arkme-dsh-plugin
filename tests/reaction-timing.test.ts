import { afterEach, expect, it, vi } from 'vitest'
import { withReactionTrace, measureReaction, bindReactionTrace, reactionQueueObserver } from '../src/reaction-host-diagnostics.js'
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
it('correlates concurrent stages without logging reaction bodies or account identifiers', async () => {
 vi.stubEnv('ARKME_REACTION_DIAGNOSTICS', '1')
 const log = vi.spyOn(console, 'info').mockImplementation(() => {})
 const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
 await Promise.all(ids.map(traceId => withReactionTrace({ action: 'notifications', accountKey: 'secret-account', limit: 50, traceId }, async () => measureReaction('upstream-http', { route: '/api/v1/reactions/notifications/query' }, async () => { await Promise.resolve(); return 'not-logged' }))))
 const rows = log.mock.calls.map(([line]) => JSON.parse(String(line).split('] ')[1]))
 for (const id of ids) expect(rows.filter(row => row.traceId === id).map(row => row.stage)).toEqual(['upstream-http', 'host-total'])
 expect(JSON.stringify(rows)).not.toMatch(/secret-account|not-logged/)
})
it('keeps timing disabled outside an explicitly enabled diagnostic run', async () => {
 vi.stubEnv('ARKME_REACTION_DIAGNOSTICS', '0'); const log = vi.spyOn(console, 'info')
 await withReactionTrace({ action: 'notifications', accountKey: 'test:7', limit: 50 }, async () => measureReaction('upstream-http', {}, async () => undefined))
 expect(log).not.toHaveBeenCalled()
})

it('keeps the admitted trace when a shared queue dispatches from another request', async () => {
 vi.stubEnv('ARKME_REACTION_DIAGNOSTICS', '1')
 const log = vi.spyOn(console, 'info').mockImplementation(() => {})
 const admitted = '11111111-1111-4111-8111-111111111111', dispatcher = '22222222-2222-4222-8222-222222222222'
 let queued!: (signal: AbortSignal) => Promise<void>
 await withReactionTrace({ action: 'notifications', accountKey: 'test:7', limit: 50, traceId: admitted }, async () => {
   queued = bindReactionTrace(async () => measureReaction('upstream-http', {}, async () => undefined))
 })
 await withReactionTrace({ action: 'notifications', accountKey: 'test:7', limit: 50, traceId: dispatcher }, async () => queued(new AbortController().signal))
 const row = log.mock.calls.map(([line]) => JSON.parse(String(line).split('] ')[1])).find(row => row.stage === 'upstream-http')
 expect(row.traceId).toBe(admitted)
})

it('keeps queue callbacks on their originating trace', async () => {
 vi.stubEnv('ARKME_REACTION_DIAGNOSTICS', '1')
 const log = vi.spyOn(console, 'info').mockImplementation(() => {})
 let observer: ReturnType<typeof reactionQueueObserver>
 const traceId = '11111111-1111-4111-8111-111111111111'
 await withReactionTrace({ action: 'notifications', accountKey: 'test:7', limit: 50, traceId }, async () => { observer = reactionQueueObserver('/api/v1/reactions/query') })
 observer!('start', { blockedBy: 'service-rate', queueWaitMs: 120 })
 const row = log.mock.calls.map(([line]) => JSON.parse(String(line).split('] ')[1])).find(row => row.stage === 'queue-start')
 expect(row).toMatchObject({ traceId, blockedBy: 'service-rate', queueWaitMs: 120 })
 expect(reactionQueueObserver('/disabled')).toBeUndefined()
})
