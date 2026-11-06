import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { BLOCK_COUNT, BLOCK_SIZE, PAGE_SIZE, MAX_PAYLOAD, crc32, safeUint64, type RecorderProtocol } from './protocol.js'
export const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
export async function atomicWrite(path: string, data: string | Buffer) {
  const temporary = `${path}.${randomUUID()}.part`
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(data); await handle.sync(); await handle.close(); await rename(temporary, path) }
  finally { await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined) }
}
export interface RecorderPage {
  type: number; sequence: number; blockSequence: number; sessionId: number
  unixMillis: number; sampleIndex: number; codec: number; payload: Buffer
}
export function parseRecorderPage(data: Buffer): RecorderPage | null {
  if (data.length < 64) throw new Error('录音页头不完整')
  if (data.subarray(0, 64).every(value => value === 255)) return null
  if (data.readUInt32LE(0) !== 0x41524b4d || data[4] !== 2 || data.readUInt16LE(6) !== 64) throw new Error('录音存储格式不受支持')
  const length = data.readUInt16LE(8), header = Buffer.from(data.subarray(0, 64))
  header.fill(0, 48, 52)
  if (length > MAX_PAYLOAD || data.length < 64 + length || crc32(header) !== data.readUInt32LE(48)) throw new Error('录音页头校验失败')
  const payload = data.subarray(64, 64 + length)
  if (length && crc32(payload) !== data.readUInt32LE(44)) throw new Error('录音页数据校验失败')
  if (data[5] === 4 && (!([1, 2].includes(data[52]!)) || data[53] !== 1 || data.readUInt32LE(56) !== 16000
    || ![8, 16].includes(data.readUInt16LE(54)) || data[52] === 2 && (length % 2 || data.readUInt16LE(54) !== 16))) throw new Error('录音编码不受支持')
  return { type: data[5]!, sequence: data.readUInt32LE(12), blockSequence: data.readUInt32LE(16), sessionId: data.readUInt32LE(20),
    unixMillis: safeUint64(data, 28), sampleIndex: safeUint64(data, 36), codec: data[52]!, payload }
}
export function decodeRecorderAudio(page: RecorderPage): Buffer {
  if (page.type !== 4 || ![1, 2].includes(page.codec)) throw new Error('不是有效音频页')
  if (page.codec === 2) return page.payload
  const pcm = Buffer.alloc(page.payload.length * 2)
  for (let index = 0; index < page.payload.length; index++) {
    const value = page.payload[index]! ^ 0x55, segment = (value & 0x70) >> 4
    let sample = (value & 15) << 4
    sample = segment === 0 ? sample + 8 : (sample + 0x108) << (segment - 1)
    pcm.writeInt16LE(value & 0x80 ? sample : -sample, index * 2)
  }
  return pcm
}
export interface CachedRecorderBlock { physical: number; sequence: number; hash: string }
export interface RecorderManifest {
  version: 1; volume: string; generation: number; identity: string; blocks: CachedRecorderBlock[]
}
const bad = (bitmap: Buffer, block: number) => Boolean(bitmap[Math.floor(block / 8)]! & (1 << (block % 8)))
export async function readRecorderVolume(protocol: RecorderProtocol, signal: AbortSignal) {
  const factory = await protocol.badBlocks(signal), candidates = new Map<string, { count: number; payload: Buffer }>()
  for (let block = 0; block < 4; block++) {
    if (bad(factory, block)) continue
    const bytes = await protocol.read(block * BLOCK_SIZE, 608, signal)
    let page: RecorderPage | null
    try { page = parseRecorderPage(bytes) } catch { continue }
    if (!page || page.type !== 1 || page.payload.length !== 544) continue
    const hash = digest(page.payload), previous = candidates.get(hash)
    candidates.set(hash, { count: (previous?.count ?? 0) + 1, payload: page.payload })
  }
  const winner = [...candidates.values()].sort((a, b) => b.count - a.count)[0]
  if (!winner || winner.count < 2) throw new Error('未找到至少两份一致的 V2 存储格式')
  const format = winner.payload, first = format.readUInt32LE(8)
  if (format.readUInt32LE(4) !== 4 || first < 4 || first >= BLOCK_COUNT || format.readUInt32LE(12) !== BLOCK_COUNT
    || format.readUInt32LE(16) !== PAGE_SIZE || format.readUInt32LE(20) !== 64) throw new Error('录音卷参数不受支持')
  const runtime = Buffer.from(format.subarray(288, 544))
  // Runtime bad blocks are journalled after the format page, independently in each copy.
  for (let block = 0; block < 4; block++) {
    if (bad(factory, block)) continue
    for (let pageIndex = 1; pageIndex < 64; pageIndex++) {
      const bytes = await protocol.read(block * BLOCK_SIZE + pageIndex * PAGE_SIZE, 80, signal)
      let page: RecorderPage | null
      try { page = parseRecorderPage(bytes) } catch { break }
      if (!page || page.type !== 6 || page.payload.length !== 16) break
      const failed = page.payload.readUInt32LE(0)
      if (failed < BLOCK_COUNT) runtime[Math.floor(failed / 8)]! |= 1 << (failed % 8)
    }
  }
  return { generation: format.readUInt32LE(0), first, formatHash: digest(format), bad: (block: number) => bad(factory, block) || bad(runtime, block) }
}
/** Checkpoint only complete validated blocks. Re-read the last indexed block on every sync. */
export async function syncRecorderVolume(protocol: RecorderProtocol, directory: string, signal: AbortSignal,
  checkpoint: (manifest: RecorderManifest, detail: string) => Promise<void>, guard: () => Promise<void>): Promise<RecorderManifest> {
  const volume = await readRecorderVolume(protocol, signal)
  let oldest = volume.first
  while (oldest < BLOCK_COUNT && volume.bad(oldest)) oldest++
  if (oldest >= BLOCK_COUNT) throw new Error('录音卷没有可用区块')
  const firstPage = await protocol.read(oldest * BLOCK_SIZE + PAGE_SIZE, 80, signal)
  const identity = digest(firstPage), key = digest(`${volume.formatHash}:${identity}`)
  const volumeDirectory = join(directory, key)
  await mkdir(volumeDirectory, { recursive: true, mode: 0o700 })
  let manifest: RecorderManifest = { version: 1, volume: key, generation: volume.generation, identity, blocks: [] }
  try {
    const cached = JSON.parse(await readFile(join(volumeDirectory, 'index.json'), 'utf8')) as RecorderManifest
    if (cached.version === 1 && cached.volume === key && cached.identity === identity
      && cached.blocks.length <= BLOCK_COUNT && cached.blocks.every(block => Number.isInteger(block.physical) && block.physical >= volume.first
        && block.physical < BLOCK_COUNT && /^[a-f0-9]{64}$/.test(block.hash))) manifest = cached
  } catch { /* A missing/corrupt index triggers reconstruction, never a device write. */ }
  const verified: CachedRecorderBlock[] = []
  for (const block of manifest.blocks) {
    signal.throwIfAborted(); await guard()
    try { await readRecorderBlock(directory, manifest, block); verified.push(block) }
    catch { break }
  }
  // A checkpoint may survive a missing/corrupt local block. Resume before the
  // first hole rather than skipping data simply because its index exists.
  manifest = { ...manifest, blocks: verified }
  const start = manifest.blocks.length ? Math.max(...manifest.blocks.map(block => block.physical)) : volume.first
  for (let physical = start; physical < BLOCK_COUNT; physical++) {
    signal.throwIfAborted(); await guard()
    if (volume.bad(physical)) continue
    const header = parseRecorderPage(await protocol.read(physical * BLOCK_SIZE, 80, signal))
    if (!header) break
    if (header.type !== 2 || header.payload.length !== 16 || header.payload.readUInt32LE(0) !== physical
      || header.payload.readUInt32LE(8) !== volume.generation) throw new Error(`录音块 ${physical} 身份不一致，已停止以保留进度`)
    const bytes = await protocol.read(physical * BLOCK_SIZE + PAGE_SIZE, PAGE_SIZE * 63, signal, true)
    for (const page of recorderBlockPages(bytes)) if (page.blockSequence !== header.blockSequence) throw new Error('录音块序号不一致')
    const hash = digest(bytes)
    await guard(); signal.throwIfAborted()
    await atomicWrite(join(volumeDirectory, `${physical}-${hash}.block`), bytes)
    const blocks = manifest.blocks.filter(block => block.physical !== physical)
    blocks.push({ physical, sequence: header.blockSequence, hash }); blocks.sort((a, b) => a.sequence - b.sequence)
    manifest = { ...manifest, blocks }
    await atomicWrite(join(volumeDirectory, 'index.json'), JSON.stringify(manifest))
    await checkpoint(manifest, `已同步 ${blocks.length} 个区块`)
  }
  await checkpoint(manifest, manifest.blocks.length ? '同步完成' : '设备中暂无录音')
  return manifest
}
export function* recorderBlockPages(bytes: Buffer): Generator<RecorderPage> {
  if (bytes.length !== PAGE_SIZE * 63) throw new Error('缓存区块不完整')
  for (let index = 0; index < 63; index++) {
    const page = parseRecorderPage(bytes.subarray(index * PAGE_SIZE, (index + 1) * PAGE_SIZE))
    if (!page) break
    yield page
  }
}
export async function readRecorderBlock(directory: string, manifest: RecorderManifest, block: CachedRecorderBlock) {
  const bytes = await readFile(join(directory, manifest.volume, `${block.physical}-${block.hash}.block`))
  if (digest(bytes) !== block.hash) throw new Error('本机音频缓存校验失败，请重新同步')
  return bytes
}
