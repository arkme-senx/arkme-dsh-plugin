import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalRecorderOwner } from '../src/local-recorder/owner.js'
import { RecorderProtocol } from '../src/local-recorder/protocol.js'
import { normalizeRecorderPort, recorderPortGroups, RecorderPortUnavailableError, assertRecorderPortsAvailable, recorderOpenFailure, type RecorderPort, type RecorderSerialProvider } from '../src/local-recorder/serial.js'
import { RecorderFirmware } from './local-recorder-fixture.js'

const directories: string[] = []
const owners: LocalRecorderOwner[] = []
afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const port = (path: string, serialNumber = 'RECORDER'): RecorderPort => ({ path, serialNumber, vendorId: '2fe3', productId: '0002', manufacturer: 'SQS' })
const signal = () => new AbortController().signal
async function setup(overrides: Partial<RecorderSerialProvider> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'recorder-discovery-')); directories.push(directory)
  let user = 1, visible = [port('/dev/cu.usbmodem31403'), port('/dev/cu.usbmodem31401')]
  const firmware = new RecorderFirmware(), open = vi.fn(async (_port: RecorderPort) => firmware.transport())
  const available = vi.fn(async () => {})
  const owner = new LocalRecorderOwner(directory, { recordingImportUserId: async () => user,
    acceptRecordingImport: vi.fn(), recordingImportReceipt: vi.fn() }, {
    list: async () => visible, open, assertAvailable: available, ...overrides,
  }, true)
  owners.push(owner)
  return { owner, firmware, open, available, setUser: (id: number) => { user = id }, setPorts: (ports: RecorderPort[]) => { visible = ports } }
}

describe('physical recorder discovery on both desktop platforms', () => {
  it('canonicalizes macOS callout aliases and leaves Windows COM ports intact', () => {
    expect(normalizeRecorderPort(port('/dev/tty.usbmodem31401'), 'darwin').path).toBe('/dev/cu.usbmodem31401')
    expect(normalizeRecorderPort(port('COM12'), 'win32').path).toBe('COM12')
    const mac = recorderPortGroups([port('/dev/tty.usbmodem31403'), port('/dev/cu.usbmodem31401'), port('/dev/tty.usbmodem31401')], 'darwin')
    expect(mac.map(group => group.map(value => value.path))).toEqual([['/dev/cu.usbmodem31401', '/dev/cu.usbmodem31403']])
    const win = recorderPortGroups([port('COM12'), port('COM11'), port('COM4', 'SECOND')], 'win32')
    expect(win).toHaveLength(2)
    expect(win[1]?.map(value => value.path)).toEqual(['COM11', 'COM12'])
  })
  it('does not invoke macOS process inspection on Windows', async () => {
    await expect(assertRecorderPortsAvailable([port('COM3')], 'win32')).resolves.toBeUndefined()
  })
  it('maps actual Windows and macOS binding errors to actionable occupancy feedback', () => {
    expect(recorderOpenFailure(new Error('Opening COM3: Access denied'))).toBeInstanceOf(RecorderPortUnavailableError)
    expect(recorderOpenFailure(Object.assign(new Error('busy'), { code: 'EBUSY' }))).toBeInstanceOf(RecorderPortUnavailableError)
    const removed = new Error('Opening COM3: File not found')
    expect(recorderOpenFailure(removed)).toBe(removed)
  })
  it('validates INFO on the first interface and does not probe its debug interface', async () => {
    const test = await setup()
    const result = await test.owner.discover(signal())
    expect(result.devices).toHaveLength(1)
    expect(result.devices[0]).toMatchObject({ serialNumber: 'RECORDER', connected: true, storage: { status: 'ready' } })
    expect(test.open).toHaveBeenCalledTimes(1)
    expect(test.open.mock.calls[0]?.[0]).toMatchObject({ path: '/dev/cu.usbmodem31401' })
    expect(test.firmware.commands.map(value => value.command)).toEqual([2, 10])
    expect(test.firmware.closed).toBe(test.firmware.opened)
  })
  it('blocks the whole dual-interface device before opening either port when another client owns it', async () => {
    const test = await setup({ assertAvailable: async ports => {
      expect(ports).toHaveLength(2)
      throw new RecorderPortUnavailableError('录音器正在被其他客户端使用')
    } })
    await expect(test.owner.discover(signal())).rejects.toThrow('其他客户端')
    expect(test.open).not.toHaveBeenCalled()
    expect(test.firmware.commands).toHaveLength(0)
  })
  it('tries the other interface after a failed handshake and reports failure instead of an empty list', async () => {
    const firmware = new RecorderFirmware()
    let attempts = 0
    const open = vi.fn(async () => { if (++attempts === 1) throw new Error('not the business interface'); return firmware.transport() })
    const test = await setup({ open })
    expect((await test.owner.discover(signal())).devices).toHaveLength(1)
    expect(open).toHaveBeenCalledTimes(2)
    const failed = await setup({ open: async () => { throw new Error('disconnected') } })
    await expect(failed.owner.discover(signal())).rejects.toThrow('未能读取设备信息')
  })
  it('does not probe after cancellation or an account switch during occupancy inspection', async () => {
    for (const scenario of ['cancel', 'account']) {
      let release!: () => void, entered!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      const started = new Promise<void>(resolve => { entered = resolve })
      const test = await setup({ assertAvailable: async () => { entered(); await pending } })
      const controller = new AbortController(), discovery = test.owner.discover(controller.signal)
      const rejected = expect(discovery).rejects.toThrow()
      await started
      if (scenario === 'cancel') controller.abort(); else test.setUser(2)
      release(); await rejected
      expect(test.open).not.toHaveBeenCalled()
    }
  })
  it('rejects a busy sync before creating a job and invalidates reused port identities', async () => {
    let busy = false
    const test = await setup({ assertAvailable: async () => { if (busy) throw new RecorderPortUnavailableError('录音器被占用') } })
    const device = (await test.owner.discover(signal())).devices[0]!
    busy = true
    await expect(test.owner.sync(device.id)).rejects.toThrow('被占用')
    expect((await test.owner.snapshot()).devices[0]?.job).toBeNull()
    expect(test.open).toHaveBeenCalledTimes(1)
    test.setPorts([port('/dev/cu.usbmodem31401', 'DIFFERENT')])
    expect((await test.owner.snapshot()).devices[0]?.connected).toBe(false)
  })
  it('refuses stale paths when a device reappears at a different port', async () => {
    const test = await setup(), device = (await test.owner.discover(signal())).devices[0]!
    test.setPorts([port('/dev/cu.usbmodem99901')])
    await expect(test.owner.sync(device.id)).rejects.toThrow('连接已变化')
    expect(test.open).toHaveBeenCalledTimes(1)
  })
  it('does not identify an unready device as a usable recorder', async () => {
    const firmware = new RecorderFirmware(); firmware.ready = false
    await expect(new RecorderProtocol(firmware.transport()).info(signal())).rejects.toThrow('尚未就绪')
  })
  it('recovers from a previous reader leaving one partial stream ahead of INFO', async () => {
    const firmware = new RecorderFirmware(); firmware.leadingBytes = Buffer.alloc(8192, 0xff)
    await expect(new RecorderProtocol(firmware.transport()).info(signal())).resolves.toBeUndefined()
    expect(firmware.commands.map(value => value.command)).toEqual([2])
    firmware.leadingBytes = Buffer.alloc(262144 + 28 + 16 + 4096 + 1, 0xff)
    await expect(new RecorderProtocol(firmware.transport()).info(signal())).rejects.toThrow('未收到')
  })
})
