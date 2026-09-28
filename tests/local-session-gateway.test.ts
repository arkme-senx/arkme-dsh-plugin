import { expect, it, vi } from 'vitest'
const sourceSlot = vi.hoisted(() => ({ source: undefined as any, invoke: vi.fn() }))
vi.mock('@deepseek-ai/dsh-api-gateway', () => ({ TypertGatewayService: class {
  constructor(readonly ctx: unknown) {}
  registerRemoteEvents(source: unknown) { sourceSlot.source = source; return async () => {} }
  invoke(request: unknown) { return sourceSlot.invoke(request) }
} }))
import LocalSessionGateway from '../src/local-session-gateway.js'

it('keeps handed-off sessions visible while forwarding genuine removals and other native events', async () => {
  const gateway = new LocalSessionGateway({ agents: { retainsSession: (id: string) => id === 'handoff' } } as never, {})
  const events = [
    { event: 'api-session/removed', args: ['handoff'] },
    { event: 'api-session/removed', args: ['deleted'] },
    { event: 'api-session/status', args: ['handoff', false] },
  ]
  gateway.registerRemoteEvents(async function* () { yield* events } as never, {} as never)
  const received = []
  for await (const frame of sourceSlot.source(new AbortController().signal)) received.push(frame)
  expect(received).toEqual(events.slice(1))
})

it('notifies the catalog after native create finishes attaching, never on failed create or another write', async () => {
  let finishAttach!: () => void
  const emit = vi.fn()
  const local = { invoke: (_request: unknown, next: () => Promise<unknown>) => next() }
  const gateway = new LocalSessionGateway({ get: () => local, emit } as never, {})
  sourceSlot.invoke.mockImplementationOnce(() => new Promise(resolve => { finishAttach = () => resolve({ sessionId: 'created' }) }))
  const request = { namespace: 'session', method: 'create', args: { request: { sessionId: 'created', workspaceId: 'workspace' } } }
  const pending = gateway.invoke(request)
  expect(emit).not.toHaveBeenCalled()
  finishAttach()
  await expect(pending).resolves.toEqual({ sessionId: 'created' })
  expect(emit).toHaveBeenCalledExactlyOnceWith('arkme/session-created', 'created')
  sourceSlot.invoke.mockRejectedValueOnce(new Error('attach failed'))
  await expect(gateway.invoke(request)).rejects.toThrow('attach failed')
  sourceSlot.invoke.mockResolvedValueOnce({ sessionId: 'created' })
  await gateway.invoke({ ...request, method: 'rename' })
  expect(emit).toHaveBeenCalledOnce()
})
