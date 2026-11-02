import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { ArkmePluginError } from '../src/services/service.js'
import { createArkmeHostApi } from '../src/host-api.js'
const prepared = { accountScope: 'test:1', bucketDate: '2026-10-14', timezone: 'Asia/Shanghai', sourceKinds: ['self'], requestId: 'day-review-browser-request' }
  it('requires isolated-document navigation and a hidden one-time nonce at the real HTTP boundary', async () => {
    let scope = 'test:1'
    const create = vi.fn(async () => ({ supported: true, job: { id: 'job', status: 'queued' }, result: null, versions: [], hasNewContent: false }))
    const service = { createDayReview: create, dayReviewConfirmationAccount: async () => scope }
    const options = { expectedPort: 0, allowNonLoopback: false }
    const server = createServer(createArkmeHostApi(service as never, options));server.listen(0, '127.0.0.1');await once(server, 'listening')
    options.expectedPort = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${options.expectedPort}/arkme-self/api`, origin = new URL(base).origin
    const rpc = async (operation: string, params = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ operation, params }) })
    try {
      for (const action of ['create', 'resume', 'reconcile']) expect((await rpc(`calendar.day-review.${action}`, prepared)).status).toBe(403)
      const id = '00000000-0000-4000-8000-000000000000'
      const receipt = { value: { confirmationId: id } }
      const page = `${base}?dayReviewConfirmation=${id}&action=create&intent=${encodeURIComponent(JSON.stringify(prepared))}`
      expect((await fetch(page)).status).toBe(403)
      const headers = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-User': '?1' }
      // Node fetch owns Sec-Fetch-Mode; use the HTTP helper below to model browser headers.
      const displayed = await nativeRequest(page, 'GET', headers)
      expect(displayed.status).toBe(200)
      expect(displayed.headers['content-security-policy']).toContain('sandbox allow-forms;')
      expect(displayed.headers['content-security-policy']).not.toContain('allow-same-origin')
      expect(displayed.body).not.toContain('本次请求参数')
      expect(displayed.body).not.toContain(prepared.requestId)
      const nonce = /name="nonce" value="([a-f0-9]+)"/.exec(displayed.body)![1]
      expect((await nativeRequest(page, 'POST', { ...headers, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, `nonce=${nonce}`)).status).toBe(403)
      expect(create).not.toHaveBeenCalled()
      const postHeaders = { ...headers, Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' }
      const accepted = await nativeRequest(page, 'POST', postHeaders, `nonce=${nonce}`)
      expect(accepted.status).toBe(303)
      expect(accepted.headers.location).toContain('receipt=complete')
      expect((await nativeRequest(new URL(accepted.headers.location!, base).href, 'GET', headers)).body).toContain('请求已提交')
      expect(create).toHaveBeenCalledExactlyOnceWith(prepared)
      expect((await nativeRequest(page, 'POST', postHeaders, `nonce=${nonce}`)).status).toBe(403)
      expect((await (await rpc('calendar.day-review.confirmation', { confirmationId: receipt.value.confirmationId })).json()).value.result.job.id).toBe('job')
      create.mockRejectedValueOnce(new ArkmePluginError('calendar-review-not-accepted', '模型不可用，未受理', false, 409))
      const secondId = '00000000-0000-4000-8000-000000000001', secondPage = page.replace(id, secondId)
      const second = await nativeRequest(secondPage, 'GET', headers)
      const secondNonce = /name="nonce" value="([a-f0-9]+)"/.exec(second.body)![1]
      await nativeRequest(secondPage, 'POST', postHeaders, `nonce=${secondNonce}`)
      expect((await (await rpc('calendar.day-review.confirmation', { confirmationId: secondId })).json()).value).toMatchObject({ status: 'failed', error: { code: 'calendar-review-not-accepted', retryable: false } })
      const cancelId = '00000000-0000-4000-8000-000000000002', cancelPage = page.replace(id, cancelId)
      const cancel = await nativeRequest(cancelPage, 'GET', headers)
      const cancelNonce = /name="nonce" value="([a-f0-9]+)"/.exec(cancel.body)![1]
      const cancelled = await nativeRequest(cancelPage, 'POST', postHeaders, `nonce=${cancelNonce}&decision=cancel`)
      expect(cancelled.status).toBe(303)
      expect(cancelled.headers.location).toContain('receipt=complete')
      expect(create).toHaveBeenCalledTimes(2)
      expect((await (await rpc('calendar.day-review.confirmation', { confirmationId: cancelId })).json()).value).toMatchObject({ status: 'failed', error: { code: 'day-review-human-required', message: '已取消，本次操作未提交。' } })
      scope = 'test:2'
      expect((await rpc('calendar.day-review.confirmation', { confirmationId: receipt.value.confirmationId })).status).toBe(403)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })

async function nativeRequest(url: string, method: string, headers: Record<string, string>, body = '') {
  const { request } = await import('node:http')
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request(url, { method, headers }, res => { let text = '';res.on('data', x => { text += String(x) });res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text })) })
    req.on('error', reject);req.end(body)
  })
}

it('enforces the pending capacity after concurrent account checks settle', async () => {
 const { DayReviewConfirmation } = await import('../src/calendar-day-review-confirmation.js')
 let release!: (value:string)=>void
 const account = new Promise<string>(resolve => { release=resolve })
 const owner = new DayReviewConfirmation({ dayReviewConfirmationAccount:()=>account } as never)
 const requests=Array.from({length:40},(_,i)=>owner.prepare(prepared,'create',new AbortController().signal,`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`))
 const settled=Promise.allSettled(requests)
 release('test:1')
 const results=await settled
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(32)
 expect(results.filter(x=>x.status==='rejected')).toHaveLength(8)
})
