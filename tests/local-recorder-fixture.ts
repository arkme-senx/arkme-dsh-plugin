import { BLOCK_SIZE, PAGE_SIZE, crc32, type RecorderTransport } from '../src/local-recorder/protocol.js'
export function firmwarePage(type: number, payload: Buffer, options: { session?: number; sequence?: number; blockSequence?: number; time?: number; sample?: number; codec?: number } = {}) {
  const page = Buffer.alloc(PAGE_SIZE, 255)
  page.fill(0, 0, 64); page.writeUInt32LE(0x41524b4d); page[4] = 2; page[5] = type
  page.writeUInt16LE(64, 6); page.writeUInt16LE(payload.length, 8)
  page.writeUInt32LE(options.sequence ?? 1, 12); page.writeUInt32LE(options.blockSequence ?? 1, 16)
  page.writeUInt32LE(options.session ?? 0, 20); page.writeBigUInt64LE(BigInt(options.time ?? 0), 28)
  page.writeBigUInt64LE(BigInt(options.sample ?? 0), 36); page[52] = options.codec ?? 1; page[53] = 1
  page.writeUInt16LE(16, 54); page.writeUInt32LE(16000, 56)
  page.writeUInt32LE(crc32(payload), 44); page.writeUInt32LE(crc32(page.subarray(0, 64)), 48)
  payload.copy(page, 64)
  return page
}
export class RecorderFirmware {
  pages = new Map<number, Buffer>()
  commands: Array<{ command: number; address: number; length: number }> = []
  generation = 1
  corruptHeader = false
  corruptData = false
  noStream = false
  failBlock = -1
  opened = 0
  closed = 0
  constructor() {
    const format = Buffer.alloc(544)
    format.writeUInt32LE(1, 0); format.writeUInt32LE(4, 4); format.writeUInt32LE(4, 8)
    format.writeUInt32LE(2048, 12); format.writeUInt32LE(PAGE_SIZE, 16); format.writeUInt32LE(64, 20)
    for (let block = 0; block < 4; block++) this.pages.set(block * BLOCK_SIZE, firmwarePage(1, format))
    this.addBlock(4, 1, 42)
  }
  addBlock(physical: number, sequence: number, session: number, pcm = false) {
    const info = Buffer.alloc(16); info.writeUInt32LE(physical); info.writeUInt32LE(this.generation, 8)
    this.pages.set(physical * BLOCK_SIZE, firmwarePage(2, info, { blockSequence: sequence }))
    this.pages.set(physical * BLOCK_SIZE + PAGE_SIZE, firmwarePage(3, Buffer.alloc(32), { session, blockSequence: sequence, time: 1700000000000 + session * 1000 }))
    this.pages.set(physical * BLOCK_SIZE + PAGE_SIZE * 2, firmwarePage(4, Buffer.from(pcm ? [1, 0, 255, 255] : [0xd5, 0x55]), { session, blockSequence: sequence, codec: pcm ? 2 : 1 }))
    this.pages.set(physical * BLOCK_SIZE + PAGE_SIZE * 3, firmwarePage(5, Buffer.alloc(32), { session, blockSequence: sequence }))
  }
  read(address: number, length: number) {
    const data = Buffer.alloc(length, 255)
    for (const [start, page] of this.pages) {
      const from = Math.max(start, address), to = Math.min(start + page.length, address + length)
      if (from < to) page.copy(data, from - address, from - start, to - start)
    }
    return data
  }
  transport(): RecorderTransport {
    this.opened++
    let response = Buffer.alloc(0), closed = false
    return {
      write: async request => {
        if (request.toString('ascii', 0, 4) !== 'AKRQ' || crc32(request.subarray(0, 20)) !== request.readUInt32LE(20)) throw new Error('bad request')
        const command = request[5]!, address = Number(request.readBigUInt64LE(8)), length = request.readUInt32LE(16)
        if (![1, 2, 3, 7, 10].includes(command)) throw new Error('FORBIDDEN DEVICE WRITE')
        this.commands.push({ command, address, length })
        if (Math.floor(address / BLOCK_SIZE) === this.failBlock && length > 80) throw new Error('disconnected')
        let data: Buffer, status = 0
        if (command === 2) {
          data = Buffer.alloc(24); data.writeUInt32LE(PAGE_SIZE, 4); data.writeUInt32LE(64, 8)
          data.writeUInt32LE(2048, 12); data.writeBigUInt64LE(BigInt(BLOCK_SIZE * 2048), 16)
        } else if (command === 3) data = Buffer.alloc(256)
        else if (command === 10) {
          data = Buffer.alloc(32); data[0] = 1; data[1] = 1
          data.writeUInt32LE(100, 4); data.writeUInt32LE(4, 8); data.writeUInt32LE(96, 12); data.writeUInt32LE(this.generation, 28)
        } else if (command === 7 && this.noStream) { data = Buffer.alloc(0); status = 6 }
        else data = this.read(address, length)
        const header = Buffer.alloc(28)
        header.write('AKRS'); header[4] = 1; header[5] = status; header.writeUInt16LE(request.readUInt16LE(6), 6)
        header.writeBigUInt64LE(BigInt(address), 8); header.writeUInt32LE(data.length, 16)
        header.writeUInt32LE(command === 7 && status === 0 ? 0 : crc32(data), 20)
        header.writeUInt32LE(crc32(header.subarray(0, 24)), 24)
        if (this.corruptHeader) header[24] = header[24]! ^ 1
        if (this.corruptData && data.length) data[0] = data[0]! ^ 1
        if (command === 7 && status === 0) {
          const end = Buffer.alloc(16); end.write('AKRE'); end.writeUInt32LE(data.length, 8); end.writeUInt32LE(crc32(data), 12)
          response = Buffer.concat([header, data, end])
        } else response = Buffer.concat([Buffer.from('boot\n'), header, data])
      },
      readExactly: async (length, signal) => {
        signal.throwIfAborted()
        if (closed || response.length < length) throw new Error('disconnected')
        const data = response.subarray(0, length); response = response.subarray(length); return data
      },
      close: async () => { if (!closed) { closed = true; this.closed++ } },
    }
  }
}
