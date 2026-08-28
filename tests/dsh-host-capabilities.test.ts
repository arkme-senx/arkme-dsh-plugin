import { describe, expect, it, vi } from 'vitest'
import { openDshHostPath, type DshServiceContextLike } from '../src/dsh-host-capabilities.js'

function context(services: Record<string, unknown>): DshServiceContextLike {
  return { get: name => services[name] }
}

describe('DSH Host capability compatibility', () => {
  it('uses the v0.1.2 sessionController operation when available', async () => {
    const openWorkspacePath = vi.fn(async () => ({ opened: true as const }))
    const signal = new AbortController().signal

    await openDshHostPath(context({ sessionController: { openWorkspacePath } }), '/tmp/arkme file.pdf', signal)

    expect(openWorkspacePath).toHaveBeenCalledWith({ path: '/tmp/arkme file.pdf' }, signal)
  })

  it('falls back to the v0.1.1 and rc.8 apiProxy operation', async () => {
    const openPath = vi.fn(async () => ({ result: { ok: true as const, value: { opened: true as const } } }))
    const signal = new AbortController().signal

    await openDshHostPath(context({ apiProxy: { host: { openPath } } }), '/tmp/legacy.pdf', signal)

    expect(openPath).toHaveBeenCalledWith({
      rpcId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      payload: { path: '/tmp/legacy.pdf' },
    }, signal)
  })

  it('prefers the current operation and never retries an operational failure through the legacy service', async () => {
    const failure = new Error('native opener failed')
    const openWorkspacePath = vi.fn(async () => { throw failure })
    const openPath = vi.fn()

    await expect(openDshHostPath(context({
      sessionController: { openWorkspacePath },
      apiProxy: { host: { openPath } },
    }), '/tmp/file.pdf', new AbortController().signal)).rejects.toBe(failure)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('normalizes legacy failures and rejects malformed Host responses', async () => {
    const refused = context({
      apiProxy: { host: { openPath: async () => ({ result: { ok: false, error: { message: 'not allowed' } } }) } },
    })
    await expect(openDshHostPath(refused, '/tmp/file.pdf', new AbortController().signal))
      .rejects.toThrow('not allowed')

    const malformed = context({ sessionController: { openWorkspacePath: async () => ({ opened: false }) } })
    await expect(openDshHostPath(malformed, '/tmp/file.pdf', new AbortController().signal))
      .rejects.toThrow('返回了无效响应')
  })

  it('fails only the requested operation when neither Host generation is available', async () => {
    await expect(openDshHostPath(context({}), '/tmp/file.pdf', new AbortController().signal))
      .rejects.toThrow('当前 DSH 宿主未提供本机文件打开能力')
  })

  it('honors cancellation before probing Host services', async () => {
    const get = vi.fn()
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))

    await expect(openDshHostPath({ get }, '/tmp/file.pdf', abort.signal)).rejects.toThrow('cancelled')
    expect(get).not.toHaveBeenCalled()
  })
})
