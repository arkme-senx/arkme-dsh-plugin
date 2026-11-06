import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { BLOCK_SIZE, PAGE_SIZE, RecorderProtocol, crc32 } from '../src/local-recorder/protocol.js'
import { syncRecorderVolume, parseRecorderPage, decodeRecorderAudio, type RecorderManifest } from '../src/local-recorder/volume.js'
import { recorderCatalog } from '../src/local-recorder/catalog.js'
import { LocalRecorderOwner } from '../src/local-recorder/owner.js'
import { isRecorderPort } from '../src/local-recorder/serial.js'
import { RecorderFirmware, firmwarePage } from './local-recorder-fixture.js'
import type { ArkmeService } from '../src/arkme-service.js'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
async function directory() { const path = await mkdtemp(join(tmpdir(), 'arkme-recorder-')); directories.push(path); return path }
const signal = () => new AbortController().signal

describe('cross-platform recorder protocol', () => {
  it('matches standard CRC and current device capacity layout', async () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    const firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    await protocol.info(signal())
    expect(await protocol.storage(signal())).toMatchObject({ status: 'ready', totalBytes: 409600, usedBytes: 16384, remainingBytes: 393216 })
    expect(firmware.commands.every(row => [1, 2, 3, 7, 10].includes(row.command))).toBe(true)
  })
  it('rejects corrupt response headers and payloads', async () => {
    const firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    firmware.corruptHeader = true; await expect(protocol.info(signal())).rejects.toThrow('校验')
    firmware.corruptHeader = false; firmware.corruptData = true; await expect(protocol.info(signal())).rejects.toThrow('校验')
  })
  it('falls back to bounded READ chunks when READ_STREAM is unsupported', async () => {
    const firmware = new RecorderFirmware(); firmware.noStream = true
    const protocol = new RecorderProtocol(firmware.transport())
    expect((await protocol.read(BLOCK_SIZE * 4 + PAGE_SIZE, PAGE_SIZE * 63, signal(), true)).length).toBe(PAGE_SIZE * 63)
    expect(firmware.commands.map(row => row.command)).toEqual([7, 1, 1, 1, 1])
    expect(Math.max(...firmware.commands.filter(row => row.command === 1).map(row => row.length))).toBe(65536)
  })
  it('rejects out-of-range reads before touching hardware and supports cancellation', async () => {
    const firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    await expect(protocol.read(-1, 10, signal())).rejects.toThrow('地址')
    const controller = new AbortController(); controller.abort()
    await expect(protocol.info(controller.signal)).rejects.toThrow()
    expect(firmware.commands).toHaveLength(0)
  })
  it('cancels a stalled write and rejects a corrupt stream trailer', async () => {
    const controller = new AbortController(), stalled = new RecorderFirmware().transport()
    stalled.write = () => new Promise<void>(() => {})
    const pending = new RecorderProtocol(stalled).info(controller.signal); controller.abort()
    await expect(pending).rejects.toThrow()
    const transport = new RecorderFirmware().transport(), read = transport.readExactly
    transport.readExactly = async (length, abort) => {
      const data = await read(length, abort)
      if (length === 16) { const copy = Buffer.from(data); copy[12] = copy[12]! ^ 1; return copy }
      return data
    }
    await expect(new RecorderProtocol(transport).read(BLOCK_SIZE * 4 + PAGE_SIZE, PAGE_SIZE * 63, signal(), true)).rejects.toThrow('校验')
  })
  it.each(['COM3', '/dev/cu.usbmodem12301'])('uses the same recognition rule on %s', path => {
    expect(isRecorderPort({ path, vendorId: '2FE3', productId: '0002', manufacturer: 'SQS' })).toBe(true)
    expect(isRecorderPort({ path, vendorId: '1915', productId: '0001' })).toBe(false)
    expect(isRecorderPort({ path, vendorId: '10c4', productId: 'ea60' })).toBe(false)
  })
  it('decodes both production codecs and rejects damaged pages', () => {
    const alaw = parseRecorderPage(firmwarePage(4, Buffer.from([0xd5, 0x55])))!
    expect(decodeRecorderAudio(alaw)).toEqual(Buffer.from([8, 0, 248, 255]))
    expect(decodeRecorderAudio(parseRecorderPage(firmwarePage(4, Buffer.from([1, 0, 255, 255]), { codec: 2 }))!)).toEqual(Buffer.from([1, 0, 255, 255]))
    const corrupt = firmwarePage(4, Buffer.from([1, 2])); corrupt[64] = 3
    expect(() => parseRecorderPage(corrupt)).toThrow('校验')
  })
  it('matches the original Swift decoder over all 256 A-law code words', () => {
    const page = parseRecorderPage(firmwarePage(4, Buffer.from(Array.from({ length: 256 }, (_, value) => value))))!
    // Generated by the existing RecorderAudioCodec.swift, independent of this port.
    expect(createHash('sha256').update(decodeRecorderAudio(page)).digest('hex')).toBe('e04788d110e58ff8c70c93b8480190d973e3b67876b6119abbaec766cc75c174')
  })
})

describe('durable incremental volume synchronization', () => {
  it('re-reads only the tail and new blocks; cached playback data stays local', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    firmware.addBlock(5, 2, 43)
    await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    firmware.commands = []; firmware.addBlock(6, 3, 44, true)
    const manifest = await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    expect(firmware.commands.filter(row => row.command === 7).map(row => row.address)).toEqual([5 * BLOCK_SIZE + PAGE_SIZE, 6 * BLOCK_SIZE + PAGE_SIZE])
    const catalog = await recorderCatalog(path, manifest)
    expect(catalog).toHaveLength(3); expect(catalog.every(row => row.complete && row.cached)).toBe(true)
    expect(catalog[0]?.startAtMillis).toBe(1700000044000)
  })
  it('does not advance checkpoint past a failed block, and resumes from the previous tail', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    firmware.addBlock(5, 2, 43); firmware.failBlock = 5
    let checkpoint: RecorderManifest | undefined
    await expect(syncRecorderVolume(protocol, path, signal(), async row => { checkpoint = row }, async () => {})).rejects.toThrow('disconnected')
    expect(checkpoint?.blocks.map(row => row.physical)).toEqual([4])
    firmware.failBlock = -1
    expect((await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})).blocks).toHaveLength(2)
  })
  it('separates reformatted volumes even if old firmware repeats generation 1', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    const old = await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    firmware.addBlock(4, 1, 99)
    const fresh = await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    expect(fresh.generation).toBe(old.generation); expect(fresh.volume).not.toBe(old.volume)
    expect((await recorderCatalog(path, old))[0]?.sessionId).toBe(42)
    expect((await recorderCatalog(path, fresh))[0]?.sessionId).toBe(99)
  })
  it('preserves successful blocks after cancellation and rejects bad payload CRC', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    firmware.addBlock(5, 2, 43)
    const controller = new AbortController()
    await expect(syncRecorderVolume(protocol, path, controller.signal, async () => { controller.abort() }, async () => {})).rejects.toThrow()
    firmware.pages.get(5 * BLOCK_SIZE + PAGE_SIZE * 2)![64] = 0
    await expect(syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})).rejects.toThrow('校验')
  })
  it('repairs an older missing local block instead of trusting a surviving index', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    firmware.addBlock(5, 2, 43)
    const manifest = await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    const first = manifest.blocks[0]!
    await writeFile(join(path, manifest.volume, `${first.physical}-${first.hash}.block`), Buffer.from('damaged'))
    firmware.commands = []
    const recovered = await syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})
    expect(firmware.commands.filter(row => row.command === 7).map(row => row.address)).toEqual([4 * BLOCK_SIZE + PAGE_SIZE, 5 * BLOCK_SIZE + PAGE_SIZE])
    expect(await recorderCatalog(path, recovered)).toHaveLength(2)
  })
  it('tolerates one damaged format copy and refuses a missing quorum', async () => {
    const path = await directory(), firmware = new RecorderFirmware(), protocol = new RecorderProtocol(firmware.transport())
    firmware.pages.get(0)![64] = 99
    await expect(syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})).resolves.toMatchObject({ generation: 1 })
    firmware.pages.get(BLOCK_SIZE)![64] = 99; firmware.pages.get(BLOCK_SIZE * 2)![64] = 99
    await expect(syncRecorderVolume(protocol, path, signal(), async () => {}, async () => {})).rejects.toThrow('两份')
  })
})

describe('account-owned local device workflow', () => {
  async function setup() {
    const path = await directory(), firmware = new RecorderFirmware()
    let userId = 1, connected = true
    const receipts = new Map<string, unknown>()
    const accept = vi.fn(async (source: string, metadata: { sha256: string; clientTaskId: string }, expectedUserId: number) => {
      const bytes = await readFile(source)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256)
      expect(expectedUserId).toBe(userId)
      const job = { importRef: `accepted-${metadata.clientTaskId}` }; receipts.set(metadata.clientTaskId, job); return job
    })
    const service = { requireSession: async () => ({ userId }), requestScope: (id: number) => `prod:${id}`,
      recordingImportUserId: async () => userId, acceptRecordingImport: accept,
      recordingImportReceipt: async (id: string) => receipts.get(id) ?? null } as unknown as ConstructorParameters<typeof LocalRecorderOwner>[1]
    const port = { path: 'COM3', serialNumber: 'TEST', vendorId: '2fe3', productId: '0002', manufacturer: 'SQS' }
    const owner = new LocalRecorderOwner(path, service, { list: async () => connected ? [port] : [], open: async () => firmware.transport() }, true)
    const finish = async () => { await vi.waitFor(async () => expect((await owner.snapshot()).devices[0]?.job?.state).toBe('completed')) }
    return { owner, firmware, accept, finish, setUser: (value: number) => { userId = value }, disconnect: () => { connected = false } }
  }
  it('discovers, synchronizes, plays offline, exports exact WAV and admits an idempotent import', async () => {
    const test = await setup()
    try {
      const device = (await test.owner.discover(signal())).devices[0]!
      await test.owner.sync(device.id); await test.finish()
      const recording = (await test.owner.snapshot()).devices[0]!.recordings[0]!
      test.disconnect()
      const before = test.firmware.commands.length, audio = await test.owner.prepare(device.id, recording.id)
      const media = await test.owner.resolveAudio(audio.ref), wav = await readFile(media.path)
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.subarray(44)).toEqual(Buffer.from([8, 0, 248, 255]))
      expect(test.firmware.commands).toHaveLength(before)
      expect((await test.owner.snapshot()).devices[0]?.connected).toBe(false)
      const input = [device.id, recording.id, recording.startAtMillis!, 'self'] as const
      const [a, b] = await Promise.all([test.owner.importAudio(...input), test.owner.importAudio(...input)])
      expect(a).toEqual(b); expect(test.accept).toHaveBeenCalledTimes(1)
      expect(await test.owner.importAudio(...input)).toEqual(a); expect(test.accept).toHaveBeenCalledTimes(1)
      expect(test.firmware.opened).toBe(test.firmware.closed)
    } finally { await test.owner.dispose() }
  })
  it('isolates accounts and rejects foreign media references and device paths', async () => {
    const test = await setup()
    try {
      const device = (await test.owner.discover(signal())).devices[0]!
      await test.owner.sync(device.id); await test.finish()
      const recording = (await test.owner.snapshot()).devices[0]!.recordings[0]!
      const audio = await test.owner.prepare(device.id, recording.id)
      test.setUser(2)
      expect((await test.owner.snapshot()).devices).toEqual([])
      await expect(test.owner.resolveAudio(audio.ref)).rejects.toThrow('失效')
      await expect(test.owner.prepare('../other-user', recording.id)).rejects.toThrow('标识')
    } finally { await test.owner.dispose() }
  })
})
