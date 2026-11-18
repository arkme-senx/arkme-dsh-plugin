import { describe, expect, it, vi } from 'vitest'
import { openDshHostPath, pickDshHostDirectory, type DshServiceContextLike } from '../src/dsh-host-capabilities.js'
import { resolve } from 'node:path'

function context(services: Record<string, unknown>): DshServiceContextLike {
  return { get: name => services[name] }
}

describe('DSH Host capability compatibility', () => {
  const pickerEnv = { ARKME_DIRECTORY_PICKER_BRIDGE_URL: 'http://127.0.0.1:4321/choose-directory', ARKME_DIRECTORY_PICKER_BRIDGE_TOKEN: 'a'.repeat(48) }
  it('uses the desktop native picker with its private credential and preserves paths with spaces', async () => {
    const path = resolve('chosen folder'), get = vi.fn(), signal = new AbortController().signal
    const request = vi.fn<typeof fetch>(async () => Response.json({ canceled: false, path }))
    expect(await pickDshHostDirectory({ get }, signal, pickerEnv, request)).toBe(path)
    expect(get).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(new URL(pickerEnv.ARKME_DIRECTORY_PICKER_BRIDGE_URL), expect.objectContaining({
      signal, redirect: 'error', headers: { 'content-type': 'application/json', 'x-arkme-picker-token': pickerEnv.ARKME_DIRECTORY_PICKER_BRIDGE_TOKEN },
    }))
  })
  it('preserves cancellation and never retries a desktop failure using another picker', async () => {
    const get = vi.fn(), signal = new AbortController().signal
    expect(await pickDshHostDirectory({ get }, signal, pickerEnv, async () => Response.json({ canceled: true }))).toBeNull()
    await expect(pickDshHostDirectory({ get }, signal, pickerEnv, async () => new Response('', { status: 500 }))).rejects.toThrow('目录选择失败')
    await expect(pickDshHostDirectory({ get }, signal, pickerEnv, async () => Response.json({ canceled: false, path: 'relative' }))).rejects.toThrow('无效响应')
    const controller = new AbortController(); controller.abort()
    const request = vi.fn()
    await expect(pickDshHostDirectory({ get }, controller.signal, pickerEnv, request)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled()
  })
  it.each(['https://example.com/choose-directory', 'http://127.0.0.1:4321/other', 'http://user:pass@127.0.0.1:4321/choose-directory', 'http://127.0.0.1:4321/choose-directory?redirect=1'])('rejects unsafe picker endpoints before sending credentials: %s', async endpoint => {
    const request = vi.fn()
    await expect(pickDshHostDirectory(context({}), new AbortController().signal, { ...pickerEnv, ARKME_DIRECTORY_PICKER_BRIDGE_URL: endpoint }, request)).rejects.toThrow('配置无效')
    expect(request).not.toHaveBeenCalled()
  })
  it('uses the official native capability when no desktop bridge is configured', async () => {
    const pick = vi.fn(async () => resolve('folder')), signal = new AbortController().signal
    expect(await pickDshHostDirectory(context({ directoryPicker: { capability: () => ({ kind: 'native', pick }) } }), signal, {})).toBe(resolve('folder'))
    expect(pick).toHaveBeenCalledWith(signal)
    await expect(pickDshHostDirectory(context({}), signal, {})).rejects.toThrow('没有本机目录选择能力')
  })
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
