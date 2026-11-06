import type { RecorderTransport } from './protocol.js'
export interface RecorderPort { path: string; serialNumber?: string | undefined; manufacturer?: string | undefined; vendorId?: string | undefined; productId?: string | undefined }
export interface RecorderSerialProvider {
  list(): Promise<RecorderPort[]>
  open(port: RecorderPort): Promise<RecorderTransport>
}
/** No serial hardware is opened until the user asks to discover/sync. */
export const recorderSerialProvider: RecorderSerialProvider = {
  async list() { return await (await import('serialport')).SerialPort.list() },
  async open(candidate) {
    const { SerialPort } = await import('serialport')
    const port = new SerialPort({ path: candidate.path, baudRate: 115200, autoOpen: false, lock: true, rtscts: false })
    let buffers: Buffer[] = [], buffered = 0, failure: Error | undefined, wake: (() => void) | undefined
    const notify = () => { const callback = wake; wake = undefined; callback?.() }
    port.on('data', (data: Buffer) => {
      buffered += data.length
      if (buffered > 2 * 262144) { failure = new Error('串口接收缓冲区超限'); void close() }
      else buffers.push(data)
      notify()
    })
    port.on('error', (error: Error) => { failure = error; notify() })
    port.on('close', () => { failure ??= new Error('录音器已断开'); notify() })
    const close = async () => { if (port.isOpen) await new Promise<void>(resolve => port.close(() => resolve())); notify() }
    try {
      await new Promise<void>((resolve, reject) => port.open(error => error ? reject(error) : resolve()))
      await new Promise<void>((resolve, reject) => port.set({ dtr: false, rts: false }, error => error ? reject(error) : resolve()))
    } catch (error) { await close(); throw error }
    return {
      async write(data) { await new Promise<void>((resolve, reject) => port.write(data, error => error ? reject(error) : resolve())) },
      async readExactly(length, signal) {
        const chunks: Buffer[] = []
        let received = 0
        while (received < length) {
          signal.throwIfAborted()
          if (failure) throw failure
          if (!buffered) {
            await new Promise<void>((resolve, reject) => {
              const aborted = () => { wake = undefined; reject(signal.reason) }
              wake = () => { signal.removeEventListener('abort', aborted); resolve() }
              signal.addEventListener('abort', aborted, { once: true })
              if (signal.aborted) { signal.removeEventListener('abort', aborted); aborted() }
            })
            continue
          }
          const chunk = buffers[0]!, count = Math.min(length - received, chunk.length)
          chunks.push(chunk.subarray(0, count)); received += count; buffered -= count
          if (count === chunk.length) buffers.shift(); else buffers[0] = chunk.subarray(count)
        }
        return Buffer.concat(chunks, length)
      },
      close,
    }
  },
}
export function isRecorderPort(port: RecorderPort): boolean {
  // CP210x charging cases and unrelated generic serial devices are never probed.
  return port.vendorId?.toLowerCase() === '1915' && port.productId?.toLowerCase() === '0001'
    || /arkme recorder/i.test(port.manufacturer ?? '')
}
