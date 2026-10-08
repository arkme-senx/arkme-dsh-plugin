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


describe('cancellation Host operations', () => {
  it('passes typed account and confirmation intent to AuthService', async () => {
    const service = {
      previewCancellation: vi.fn(async (expectedUserId: number) => ({ expectedUserId })),
      submitCancellation: vi.fn(async (expectedUserId: number, expectedMode: string) => ({ expectedUserId, expectedMode })),
      resolveCancellationLogin: vi.fn(async (continueLogin: boolean) => ({ continueLogin })),
    }
    await expect(dispatchArkmeHostOperation(service as never, 'auth.cancellation.preview', { expectedUserId: 7 })).resolves.toEqual({ expectedUserId: 7 })
    await expect(dispatchArkmeHostOperation(service as never, 'auth.cancellation.submit', { expectedUserId: 7, expectedMode: 'waiting' })).resolves.toEqual({ expectedUserId: 7, expectedMode: 'waiting' })
    await expect(dispatchArkmeHostOperation(service as never, 'auth.cancellation.login.resolve', { continueLogin: false })).resolves.toEqual({ continueLogin: false })
    await expect(dispatchArkmeHostOperation(service as never, 'auth.cancellation.login.resolve', {})).rejects.toThrow()
  })
})


describe('email binding Host operations', () => {
  it('forwards the expected account and email without exposing credentials', async () => {
    const service = { sendEmailBindCode: vi.fn(async () => ({ sent: true })), bindEmail: vi.fn(async () => ({ bound: true })) }
    await expect(dispatchArkmeHostOperation(service as never, 'auth.email.send', { expectedUserId: 7, email: 'a@example.com' })).resolves.toEqual({ sent: true })
    await expect(dispatchArkmeHostOperation(service as never, 'auth.email.bind', { expectedUserId: 7, email: 'a@example.com', code: '1234' })).resolves.toEqual({ bound: true })
    expect(service.sendEmailBindCode).toHaveBeenCalledWith(7, 'a@example.com')
    expect(service.bindEmail).toHaveBeenCalledWith(7, 'a@example.com', '1234')
  })
})
