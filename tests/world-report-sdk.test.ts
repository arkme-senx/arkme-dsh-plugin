import { describe, expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'

const request = { action: 'submit' as const, confirmed: true as const, expectedUserId: 42, recordRef: 'public-ref', reportType: 6, reason: '说明', requestUid: 'original_report_0001' }

describe('World report SDK lifetime', () => {
  it('cancels an in-flight report when disposed and refuses subsequent calls before dispatch', async () => {
    let started!: () => void
    const admitted = new Promise<void>(resolve => { started = resolve })
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.operation === 'provider.capabilities') return Response.json({ ok: true, value: { contractVersion: 1, features: { worldReportsV1: true } } })
      started()
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      })
    })
    const sdk = createArkmeSdk({ fetchImpl })
    const pending = sdk.worldReport(request)
    const rejected = expect(pending).rejects.toBeDefined()
    await admitted; sdk.dispose(); await rejected
    const count = fetchImpl.mock.calls.length
    await expect(sdk.worldReport(request)).rejects.toBeDefined()
    expect(fetchImpl).toHaveBeenCalledTimes(count)
  })

  it('does not submit after disposal during a slow capability response', async () => {
    let complete!: (response: Response) => void
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { complete = resolve }))
    const sdk = createArkmeSdk({ fetchImpl })
    const pending = sdk.worldReport(request), rejected = expect(pending).rejects.toBeDefined()
    sdk.dispose()
    complete(Response.json({ ok: true, value: { contractVersion: 1, features: { worldReportsV1: true } } }))
    await rejected
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
