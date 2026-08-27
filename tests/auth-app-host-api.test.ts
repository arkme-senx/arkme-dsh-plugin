import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('Jiwo scan login Host operations', () => {
  it('routes begin, poll and cancel without exposing backend operation details', async () => {
    const service = {
      beginJiwoLogin: vi.fn(async () => ({ status: 'pending' })),
      pollJiwoLogin: vi.fn(async (attemptId: string) => ({ status: 'pending', attemptId })),
      cancelJiwoLogin: vi.fn(async (attemptId: string) => ({ canceled: attemptId !== '' })),
    }

    await expect(dispatchArkmeHostOperation(service as never, 'auth.app.begin', {})).resolves.toEqual({ status: 'pending' })
    await expect(dispatchArkmeHostOperation(service as never, 'auth.app.poll', { attemptId: 'local-1' })).resolves.toEqual({
      status: 'pending', attemptId: 'local-1',
    })
    await expect(dispatchArkmeHostOperation(service as never, 'auth.app.cancel', { attemptId: 'local-1' })).resolves.toEqual({ canceled: true })
  })
})
