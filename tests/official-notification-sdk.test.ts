import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'
const success = (value: unknown) =>
  new Response(JSON.stringify({ ok: true, value }), {
    headers: { 'Content-Type': 'application/json' },
  })
it('SDK discovers capability and forwards the same public account-scoped Host operations', async () => {
  const calls: unknown[] = []
  const sdk = createArkmeSdk({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      calls.push(body)
      return success(
        body.operation === 'provider.capabilities'
          ? { contractVersion: 1, features: { officialNotificationsV1: true } }
          : {},
      )
    },
  })
  await sdk.listOfficialNotifications('next')
  await sdk.officialNotificationSummary()
  await sdk.officialNotificationDetail('notice-one')
  await sdk.readOfficialNotifications({
    accountKey: 'test:42',
    ids: ['notice-one'],
  })
  expect(calls).toContainEqual({
    operation: 'official-notifications.list',
    params: { cursor: 'next' },
  })
  expect(calls).toContainEqual({
    operation: 'official-notifications.read',
    params: { accountKey: 'test:42', ids: ['notice-one'] },
  })
})
it('SDK reports an unsupported Host without issuing a business request', async () => {
  const fetchImpl = vi.fn(async () =>
    success({ contractVersion: 1, features: {} }),
  )
  await expect(
    createArkmeSdk({ fetchImpl }).listOfficialNotifications(),
  ).rejects.toThrow()
  expect(fetchImpl).toHaveBeenCalledOnce()
})
it('Host forwards only current-account input and request cancellation', async () => {
  const readOfficialNotifications = vi.fn(async () => ({
    total: 2,
    unreadCount: 1,
  }))
  const service = { readOfficialNotifications } as unknown as ArkmeService
  await dispatchArkmeHostOperation(service, 'official-notifications.read', {
    accountKey: 'test:42',
    ids: ['notice-one'],
    userId: 99,
  })
  expect(readOfficialNotifications).toHaveBeenCalledWith(
    { accountKey: 'test:42', ids: ['notice-one'] },
    undefined,
  )
})
