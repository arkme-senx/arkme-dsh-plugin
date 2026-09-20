import { writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: exec }))
import { ArkmeDesktopScreenshot } from '../src/desktop-screenshot.js'

it('invokes only native interactive region selection with a generated local path and cancellation signal', async () => {
  exec.mockImplementation((_command, args, options, callback) => {
    expect(args.slice(0, -1)).toEqual(['-i', '-s', '-x', '-t', 'png'])
    expect(args.at(-1)).toMatch(/\/arkme-screenshot-[^/]+\/capture\.png$/)
    expect(options.signal).toBeInstanceOf(AbortSignal)
    void writeFile(args.at(-1), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])).then(() => callback(null, '', ''))
  })
  const owner = new ArkmeDesktopScreenshot({ currentUser: async () => 11, maxImageBytes: () => 1024, platform: 'darwin', executableAvailable: async () => true })
  expect(await owner.capture(11)).toMatchObject({ status: 'captured', mimeType: 'image/png' })
  expect(exec).toHaveBeenCalledOnce()
  expect(exec.mock.calls[0]![0]).toBe('/usr/sbin/screencapture')
})
