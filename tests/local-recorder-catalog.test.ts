import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as volume from '../src/local-recorder/volume.js'
import { RecorderCatalog } from '../src/local-recorder/catalog.js'
import { BLOCK_SIZE, PAGE_SIZE, RecorderProtocol } from '../src/local-recorder/protocol.js'
import { LocalRecorderOwner } from '../src/local-recorder/owner.js'
import { firmwarePage, RecorderFirmware } from './local-recorder-fixture.js'
const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function directory() { const path = await mkdtemp(join(tmpdir(), 'recorder-catalog-')); directories.push(path); return path }
const signal = () => new AbortController().signal

describe('incremental catalog and native recorder metadata', () => {
  it('decodes the Swift-compatible start/end/gain/VAD layouts and reports verified cached bytes', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), base = 4 * BLOCK_SIZE
    const start = Buffer.alloc(32); start.writeUInt32LE(0x02011c); start.writeUInt32LE(4167, 4); start.set([48, 0, 80, 1], 24)
    firmware.pages.set(base + PAGE_SIZE, firmwarePage(3, start, { session: 42, time: 1700000000000 }))
    const vad = Buffer.alloc(8); vad[0] = 1; vad[1] = 0; vad.writeUInt16LE(200, 2)
    firmware.pages.set(base + PAGE_SIZE * 3, firmwarePage(13, vad, { session: 42 }))
    const end = Buffer.alloc(32); end.writeUInt32LE(3); end.writeUInt32LE(3990, 4); end.writeBigUInt64LE(16000n, 8)
    firmware.pages.set(base + PAGE_SIZE * 4, firmwarePage(5, end, { session: 42, time: 1700000001000 }))
    const manifest = await volume.syncRecorderVolume(new RecorderProtocol(firmware.transport()), path, signal(), async () => {}, async () => {})
    const catalog = new RecorderCatalog(); await catalog.update(path, manifest)
    expect(catalog.recordings(manifest)[0]).toMatchObject({ complete: true, durationMillis: 1000, info: { audioBytes: 2, batteryStartMV: 4167, batteryEndMV: 3990, firmwareVersion: 0x02011c, gainStartDb: 4, vadEnabled: false, vadThreshold: 200, stopReason: 3, blockCount: 1, crcVerified: true } })
  })
  it('only reads changed blocks, replaces tail contributions, and discards stale volume summaries', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    const first = await volume.syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    const read = vi.spyOn(volume, 'readRecorderBlock'), catalog = new RecorderCatalog()
    await catalog.update(path, first); expect(read).toHaveBeenCalledTimes(1)
    await catalog.update(path, first); expect(read).toHaveBeenCalledTimes(1)
    firmware.addBlock(5, 2, 43)
    const next = await volume.syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    read.mockClear(); await catalog.update(path, next); expect(read).toHaveBeenCalledTimes(1)
    expect(catalog.recordings(next)).toHaveLength(2)
    firmware.addBlock(5, 2, 99)
    const replaced = await volume.syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    read.mockClear(); await catalog.update(path, replaced); expect(read).toHaveBeenCalledTimes(1)
    expect(catalog.recordings(replaced).map(row => row.sessionId)).toEqual([99, 42])
    await expect(catalog.update(path, { ...replaced, blocks: [...replaced.blocks, replaced.blocks[0]!] })).rejects.toThrow('重复')
    expect(() => catalog.recordings({ ...replaced, volume: 'different-volume' })).toThrow('存储卷')
    firmware.addBlock(4, 1, 100)
    const fresh = await volume.syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    await catalog.update(path, fresh); expect(catalog.recordings(fresh).map(row => row.sessionId)).toEqual([100, 99])
  })
  it('publishes a playable catalog before the next block returns and retains it after stopping', async () => {
    const path = await directory(), firmware = new RecorderFirmware(); firmware.addBlock(5, 2, 43)
    let reached!: () => void
    const second = new Promise<void>(resolve => { reached = resolve })
    const transport = firmware.transport(), write = transport.write
    transport.write = async request => {
      if (request[5] === 7 && Number(request.readBigUInt64LE(8)) === 5 * BLOCK_SIZE + PAGE_SIZE) { reached(); return new Promise<void>(() => {}) }
      await write(request)
    }
    let syncing = false
    const provider = { list: async () => [{ path: 'COM3', serialNumber: 'TEST', vendorId: '2fe3', productId: '0002' }], open: async () => syncing ? transport : firmware.transport() }
    const owner = new LocalRecorderOwner(path, { recordingImportUserId: async () => 1, acceptRecordingImport: vi.fn(), recordingImportReceipt: vi.fn() }, provider, true)
    try {
      const device = (await owner.discover(signal())).devices[0]!
      // Use a fresh transport for the long-running sync, never the closed probe.
      syncing = true
      await owner.sync(device.id); await second
      const live = (await owner.snapshot()).devices[0]!
      expect(live.job?.state).toBe('syncing'); expect(live.recordings).toHaveLength(1)
      expect(live.recordings[0]?.info?.crcVerified).toBe(true)
      const audio = await owner.prepare(device.id, live.recordings[0]!.id); expect(audio.size).toBe(48)
      await owner.stop(device.id)
      await vi.waitFor(async () => expect((await owner.snapshot()).devices[0]?.job?.state).toBe('stopped'))
      expect((await owner.snapshot()).devices[0]?.recordings).toHaveLength(1)
    } finally { await owner.dispose() }
  })
  it('reports the actual scanned range when an erased block terminates the scan early', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), updates: volume.RecorderScanProgress[] = []
    await volume.syncRecorderVolume(new RecorderProtocol(firmware.transport()), path, signal(), async () => {}, async () => {}, async row => { updates.push(row) })
    expect(updates.at(-1)).toEqual({ phase: 'indexing', scannedBlocks: 2, totalBlocks: 2 })
  })
  it('keeps unsupported device dates unknown instead of sending invalid dates to the UI', async () => {
    const path = await directory(), firmware = new RecorderFirmware()
    firmware.pages.set(4 * BLOCK_SIZE + PAGE_SIZE, firmwarePage(3, Buffer.alloc(32), { session: 42, time: 9000000000000000 }))
    const manifest = await volume.syncRecorderVolume(new RecorderProtocol(firmware.transport()), path, signal(), async () => {}, async () => {})
    const catalog = new RecorderCatalog(); await catalog.update(path, manifest)
    expect(catalog.recordings(manifest)[0]?.startAtMillis).toBeNull()
  })
})
