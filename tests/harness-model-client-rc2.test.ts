import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/harness-model-client.js'

describe('Harness rc2 model-seat injection', () => {
  it('declares the remote session service used by the injected model directory', () => {
    expect(inject).toEqual(expect.arrayContaining(['slots', 'sessions', 'remote', 'remote.session']))
  })
})

it('uses source model projections for remote sessions without constructing a local model directory', async () => {
  const { apply } = await import('../src/client/harness-model-client.js')
  const { vi } = await import('vitest')
  const directoryFor = vi.fn(() => ({})), projection = { getSnapshot: () => ({ next: { model: 'remote-model' } }), subscribe: () => () => {} }
  let registration: any
  const scope = {
    get: () => ({ directoryFor }),
    sessions: { subagentAddress: () => undefined, binding: () => ({ session: { projections: { faceOf: () => projection } } }) },
    slots: { inject: (_name: string, fn: () => void) => fn(), register: (options: any) => { registration = options } },
  }
  apply({ inject: (_deps: string[], fn: (ctx: any) => void) => fn(scope) } as never)
  expect(registration.inject('arkme:windows:same')).toEqual({ projection })
  expect(directoryFor).not.toHaveBeenCalled()
  registration.inject('local')
  expect(directoryFor).toHaveBeenCalledWith('local')
})
