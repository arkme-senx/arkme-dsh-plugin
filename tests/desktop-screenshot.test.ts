import { access, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeDesktopScreenshot } from '../src/desktop-screenshot.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=', 'base64')
const base = { currentUser: async () => 11, maxImageBytes: () => 1024, platform: 'darwin', executableAvailable: async () => true }
const ok = { code: 0, stderr: '' }

describe('local interactive screenshots', () => {
  it('checks capabilities without capturing', async () => {
    const capture = vi.fn()
    expect(await new ArkmeDesktopScreenshot({ ...base, capture }).capability()).toEqual({ available: true })
    expect(await new ArkmeDesktopScreenshot({ ...base, platform: 'win32', capture }).capability()).toMatchObject({ available: false })
    expect(capture).not.toHaveBeenCalled()
  })
  it('returns only image bytes and cleans its temporary directory', async () => {
    let path = ''
    const owner = new ArkmeDesktopScreenshot({ ...base, capture: async output => {
      path = output; await writeFile(output, png); return ok
    } })
    expect(await owner.capture(11)).toMatchObject({ status: 'captured', mimeType: 'image/png', contentBase64: png.toString('base64') })
    await expect(access(dirname(path))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each([0, 1])('treats Esc with exit %s and no file as silent cancellation', async code => {
    const owner = new ArkmeDesktopScreenshot({ ...base, capture: async () => ({ code, stderr: '' }) })
    expect(await owner.capture(11)).toEqual({ status: 'cancelled' })
  })
  it('does not disguise permission failures as cancellation or leak diagnostics', async () => {
    const owner = new ArkmeDesktopScreenshot({ ...base, capture: async () => ({ code: 1, stderr: 'private: could not create image from display' }) })
    await expect(owner.capture(11)).rejects.toMatchObject({ code: 'screenshot-permission' })
    await expect(owner.capture(11)).rejects.not.toThrow('private:')
  })
  it.each([undefined, 0, -1, 1.2, 12])('refuses incorrect expected account %s before capture', async user => {
    const capture = vi.fn()
    const owner = new ArkmeDesktopScreenshot({ ...base, capture })
    await expect(owner.capture(user as number)).rejects.toBeInstanceOf(Error)
    expect(capture).not.toHaveBeenCalled()
  })
  it('rejects an account change after selection and removes captured bytes', async () => {
    let user = 11, path = ''
    const owner = new ArkmeDesktopScreenshot({ ...base, currentUser: async () => user, capture: async output => {
      path = output; await writeFile(output, png); user = 12; return ok
    } })
    await expect(owner.capture(11)).rejects.toMatchObject({ code: 'screenshot-account-changed' })
    await expect(access(dirname(path))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['size', 'format'])('validates %s and cleans temporary data', async mode => {
    let path = ''
    const owner = new ArkmeDesktopScreenshot({ ...base, maxImageBytes: () => mode === 'size' ? 2 : 1024, capture: async output => {
      path = output; await writeFile(output, mode === 'size' ? png : Buffer.from('not PNG')); return ok
    } })
    await expect(owner.capture(11)).rejects.toMatchObject({ code: mode === 'size' ? 'screenshot-too-large' : 'screenshot-invalid' })
    await expect(access(dirname(path))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['request', 'logout', 'timeout'])('aborts native selection on %s and releases the lock', async mode => {
    let started!: () => void, path = ''
    const ready = new Promise<void>(resolve => { started = resolve })
    const controller = new AbortController()
    const owner = new ArkmeDesktopScreenshot({ ...base, timeoutMs: mode === 'timeout' ? 30 : 5000, capture: (output, signal) => {
      path = output; started()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    } })
    const pending = owner.capture(11, controller.signal)
    const settled = mode === 'timeout'
      ? expect(pending).rejects.toMatchObject({ code: 'screenshot-timeout' })
      : expect(pending).resolves.toEqual({ status: 'cancelled' })
    await ready
    await expect(owner.capture(11)).rejects.toMatchObject({ code: 'screenshot-busy' })
    if (mode === 'request') controller.abort()
    if (mode === 'logout') owner.cancel()
    await settled
    await expect(access(dirname(path))).rejects.toMatchObject({ code: 'ENOENT' })
    const aborted = new AbortController(); aborted.abort()
    expect(await owner.capture(11, aborted.signal)).toEqual({ status: 'cancelled' })
  })
})
