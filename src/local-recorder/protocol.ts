/** Read-only implementation of Arkme Recorder AKRQ/AKRS v1, shared by both OSes. */
export interface RecorderTransport {
  write(data: Buffer): Promise<void>
  readExactly(length: number, signal: AbortSignal): Promise<Buffer>
  close(): Promise<void>
}
export const PAGE_SIZE = 4096
export const PAGES_PER_BLOCK = 64
export const BLOCK_SIZE = PAGE_SIZE * PAGES_PER_BLOCK
export const BLOCK_COUNT = 2048
export const MAX_PAYLOAD = 4032
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
export function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) value = table[(value ^ byte) & 255]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
export function safeUint64(data: Buffer, offset: number): number {
  const value = data.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('设备数值超出安全范围')
  return Number(value)
}
export class RecorderStatusError extends Error {
  constructor(readonly status: number) { super(`录音器返回状态 ${status}`) }
}
export class RecorderProtocol {
  private capacityBytes: number | undefined
  private sequence = 1
  private busy = false
  constructor(readonly transport: RecorderTransport) {}

  /** Deliberately no public arbitrary command, erase, clock or configuration API. */
  private async request(command: 1 | 2 | 3 | 7 | 10, address: number, length: number, signal: AbortSignal): Promise<Buffer> {
    if (this.busy) throw new Error('录音器正在处理另一读取请求')
    signal.throwIfAborted()
    this.busy = true
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    try {
      const sequence = this.sequence++ & 0xffff
      const request = Buffer.alloc(24)
      request.write('AKRQ'); request[4] = 1; request[5] = command
      request.writeUInt16LE(sequence, 6); request.writeBigUInt64LE(BigInt(address), 8)
      request.writeUInt32LE(length, 16); request.writeUInt32LE(crc32(request.subarray(0, 20)), 20)
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(deadline.reason)
        deadline.addEventListener('abort', abort, { once: true })
        if (deadline.aborted) { deadline.removeEventListener('abort', abort); reject(deadline.reason); return }
        this.transport.write(request).then(resolve, reject).finally(() => deadline.removeEventListener('abort', abort))
      })
      // A previous reader can close during one READ_STREAM block. Match the
      // native reader's magic scan while bounding stale input to one full
      // transfer (header + block + trailer) plus a small boot/debug allowance.
      let magic = Buffer.alloc(0)
      for (let count = 0; ; count++) {
        if (count > BLOCK_SIZE + 28 + 16 + 4096) throw new Error('未收到录音器响应')
        magic = Buffer.concat([magic.subarray(-3), await this.transport.readExactly(1, deadline)])
        if (magic.toString('ascii') === 'AKRS') break
      }
      const header = Buffer.concat([magic, await this.transport.readExactly(24, deadline)])
      if (header[4] !== 1 || crc32(header.subarray(0, 24)) !== header.readUInt32LE(24)
        || header.readUInt16LE(6) !== sequence || safeUint64(header, 8) !== address) throw new Error('录音器响应头校验失败')
      const size = header.readUInt32LE(16)
      if (size > BLOCK_SIZE) throw new Error('录音器响应长度异常')
      const status = header[5]!
      if (command === 7 && status === 0) {
        if (size !== length || header.readUInt32LE(20) !== 0) throw new Error('流式响应长度异常')
        const data = await this.transport.readExactly(size, deadline)
        const end = await this.transport.readExactly(16, deadline)
        if (end.toString('ascii', 0, 4) !== 'AKRE' || end[4] !== 0
          || end.readUInt32LE(8) !== size || end.readUInt32LE(12) !== crc32(data)) throw new Error('流式录音数据校验失败')
        return data
      }
      const data = await this.transport.readExactly(size, deadline)
      if (crc32(data) !== header.readUInt32LE(20)) throw new Error('录音器数据 CRC 校验失败')
      if (status !== 0) throw new RecorderStatusError(status)
      if (command === 1 && size !== length) throw new Error('录音器数据读取不完整')
      return data
    } finally { this.busy = false }
  }
  async info(signal: AbortSignal): Promise<void> {
    const data = await this.request(2, 0, 0, signal)
    if (data.length !== 24 || data.readUInt32LE(4) !== PAGE_SIZE || data.readUInt32LE(8) !== PAGES_PER_BLOCK
      || data.readUInt32LE(12) !== BLOCK_COUNT || safeUint64(data, 16) !== BLOCK_SIZE * BLOCK_COUNT) throw new Error('当前设备不是受支持的 Arkme 录音器')
    if (!data[2]) throw new Error('录音器存储尚未就绪')
    this.capacityBytes = safeUint64(data, 16)
  }
  async badBlocks(signal: AbortSignal): Promise<Buffer> {
    const data = await this.request(3, 0, 0, signal)
    if (data.length !== 256) throw new Error('坏块表长度异常')
    return data
  }
  async storage(signal: AbortSignal) {
    const data = await this.request(10, 0, 0, signal)
    if (data.length !== 32 || data[0] !== 1 || data[1]! > 3) throw new Error('容量信息格式异常')
    const total = data.readUInt32LE(4), used = data.readUInt32LE(8), remaining = data.readUInt32LE(12)
    if (total > BLOCK_COUNT * PAGES_PER_BLOCK || used > total || remaining > total
      || data[1] === 1 && used + remaining !== total) throw new Error('容量信息不一致')
    return { status: data[1] === 1 || data[1] === 2 ? 'ready' as const : data[1] === 0 ? 'unformatted' as const : 'unavailable' as const,
      totalBytes: total * PAGE_SIZE, usedBytes: used * PAGE_SIZE, remainingBytes: remaining * PAGE_SIZE,
      ...(this.capacityBytes !== undefined ? { physicalBytes: this.capacityBytes } : {}), audioRemainingBytes: safeUint64(data, 16),
      remainingSeconds: data.readUInt32LE(24), generation: data.readUInt32LE(28) }
  }
  async read(address: number, length: number, signal: AbortSignal, stream = false): Promise<Buffer> {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) || address < 0 || length < 1
      || address + length > BLOCK_SIZE * BLOCK_COUNT || length > BLOCK_SIZE) throw new Error('读取地址无效')
    if (stream) {
      try { return await this.request(7, address, length, signal) }
      catch (error) { if (!(error instanceof RecorderStatusError) || error.status !== 6) throw error }
    }
    const chunks: Buffer[] = []
    for (let offset = 0; offset < length; offset += 65536) chunks.push(await this.request(1, address + offset, Math.min(65536, length - offset), signal))
    return Buffer.concat(chunks)
  }
}
