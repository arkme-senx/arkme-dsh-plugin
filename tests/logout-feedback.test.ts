import { describe, expect, it } from 'vitest'
import { LogoutFeedback } from '../src/logout-feedback.js'

describe('logout failure across page navigation', () => {
  it('retains the credential failure and nested reason after the caller disappears', async () => {
    const feedback = new LogoutFeedback()
    const failure = new Error('无法删除 Windows 登录凭据', { cause: new Error('操作超时') })
    await expect(feedback.run(async () => { throw failure })).rejects.toMatchObject({ code: 'logout-failed', message: '退出登录失败：无法删除 Windows 登录凭据；操作超时' })
    expect(feedback.snapshot()).toMatchObject({ status: 'failed', message: '退出登录失败：无法删除 Windows 登录凭据；操作超时' })
    expect(feedback.snapshot().id).toBeTruthy()
  })
  it('exposes pending during restoration, and clears the failure on successful retry', async () => {
    const feedback = new LogoutFeedback()
    await feedback.run(async () => { throw new Error('first') }).catch(() => {})
    const task = Promise.withResolvers<string>()
    const retry = feedback.run(() => task.promise)
    expect(feedback.snapshot()).toEqual({ status: 'pending' })
    task.resolve('done')
    await expect(retry).resolves.toBe('done')
    expect(feedback.snapshot()).toEqual({ status: 'idle' })
  })
  it('bounds cyclic causes and redacts credentials', async () => {
    const feedback = new LogoutFeedback()
    const error = new Error('request failed Authorization: Bearer secret-value access_token=secret-two')
    error.cause = error
    await feedback.run(async () => { throw error }).catch(() => {})
    expect(feedback.snapshot().message).not.toContain('secret-value')
    expect(feedback.snapshot().message).not.toContain('secret-two')
  })
})

it('preserves the detailed failure through the real Host HTTP error envelope', async () => {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const { createArkmeHostApi } = await import('../src/host-api.js')
  const feedback = new LogoutFeedback()
  const service = {
    logout: () => feedback.run(async () => {
      throw new Error('无法删除 Windows 登录凭据', { cause: new Error('操作超时') })
    }),
    logoutFailureFeedback: () => feedback.snapshot(),
  }
  const server = createServer(createArkmeHostApi(service as never, { expectedPort: 0, allowNonLoopback: false }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing test address')
  const request = async (operation: string) => await fetch(`http://127.0.0.1:${address.port}/arkme-self/api`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, params: {} }),
  })
  try {
    const response = await request('auth.logout')
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: {
      code: 'logout-failed', message: '退出登录失败：无法删除 Windows 登录凭据；操作超时',
    } })
    const restoredPage = await request('auth.logout.feedback')
    expect(await restoredPage.json()).toMatchObject({ ok: true, value: {
      status: 'failed', message: '退出登录失败：无法删除 Windows 登录凭据；操作超时',
    } })
  } finally {
    server.close()
    await once(server, 'close')
  }
})
