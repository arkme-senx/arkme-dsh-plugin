import type { RecorderTransport } from './protocol.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
export interface RecorderPort { path: string; serialNumber?: string | undefined; manufacturer?: string | undefined; vendorId?: string | undefined; productId?: string | undefined }
export interface RecorderSerialProvider {
  list(): Promise<RecorderPort[]>
  open(port: RecorderPort): Promise<RecorderTransport>
  assertAvailable?(ports: readonly RecorderPort[]): Promise<void>
}
const execFileAsync = promisify(execFile)
export class RecorderPortUnavailableError extends Error {}
export function recorderOpenFailure(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error('无法打开录音器串口')
  // bindings-cpp's Windows CreateFile failure exposes "Access denied" without
  // a POSIX error code; macOS reports EBUSY/EACCES/EPERM.
  if (['EBUSY', 'EACCES', 'EPERM'].includes((failure as NodeJS.ErrnoException).code ?? '')
    || /access denied|permission denied|resource busy|cannot lock/i.test(failure.message)) {
    return new RecorderPortUnavailableError('录音器串口被占用或没有访问权限，请结束其他客户端的读取并检查权限后重试')
  }
  return failure
}

export function normalizeRecorderPort(port: RecorderPort, platform: string = process.platform): RecorderPort {
  // SerialPort enumerates the dial-in alias on macOS; the native reader uses
  // the callout alias of the same CDC interface. COM names remain unchanged.
  return platform === 'darwin' && port.path.startsWith('/dev/tty.usbmodem')
    ? { ...port, path: port.path.replace('/dev/tty.', '/dev/cu.') } : port
}
export function recorderPortGroupKey(port: RecorderPort): string {
  if (port.serialNumber) return `${port.vendorId?.toLowerCase()}:${port.productId?.toLowerCase()}:${port.serialNumber}`
  const location = /^\/dev\/(?:cu|tty)\.usbmodem(.{3,})$/.exec(port.path)?.[1]
  return location ? `mac-usb:${location.slice(0, -2)}` : port.path
}
export function recorderPortGroups(ports: readonly RecorderPort[], platform: string = process.platform): RecorderPort[][] {
  const groups = new Map<string, RecorderPort[]>(), seen = new Set<string>()
  for (const port of ports.filter(isRecorderPort).map(port => normalizeRecorderPort(port, platform)).sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }))) {
    if (seen.has(port.path)) continue
    seen.add(port.path)
    const key = recorderPortGroupKey(port), group = groups.get(key) ?? []
    group.push(port); groups.set(key, group)
  }
  return [...groups.values()]
}
export async function assertRecorderPortsAvailable(ports: readonly RecorderPort[], platform: string = process.platform): Promise<void> {
  if (platform !== 'darwin' || !ports.length) return
  const paths = [...new Set(ports.flatMap(port => {
    const path = normalizeRecorderPort(port, platform).path
    return path.startsWith('/dev/cu.usbmodem') ? [path, path.replace('/dev/cu.', '/dev/tty.')] : [path]
  }))]
  let stdout = ''
  try {
    stdout = (await execFileAsync('/usr/sbin/lsof', ['-w', '-nP', '-Fpcn', '--', ...paths], { encoding: 'utf8', timeout: 2500, maxBuffer: 262144 })).stdout
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    if (failure.code === 1 && !failure.stdout && !failure.stderr?.trim()) return
    if (failure.stdout) stdout = failure.stdout
    else throw new RecorderPortUnavailableError('暂时无法确认录音器的串口占用状态，请检查连接后重试')
  }
  const owners = [...stdout.matchAll(/^p(\d+)$/gm)].map(match => Number(match[1]))
  if (owners.some(pid => pid !== process.pid)) {
    throw new RecorderPortUnavailableError('录音器正在被其他客户端使用，请等待当前读取完成并退出该客户端后重试')
  }
}
/** No serial hardware is opened until the user asks to discover/sync. */
export const recorderSerialProvider: RecorderSerialProvider = {
  async list() { return await (await import('serialport')).SerialPort.list() },
  assertAvailable: assertRecorderPortsAvailable,
  async open(candidate) {
    await assertRecorderPortsAvailable([candidate])
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
      // Keep the driver's default control lines, like the native reader; do
      // not forcibly lower DTR/RTS after opening a CDC recorder.
      // Match the native reader's initial TCIFLUSH. A previous client may have
      // closed during a block transfer, leaving bytes in the host input queue.
      await new Promise<void>((resolve, reject) => port.flush(error => error ? reject(error) : resolve()))
      buffers = []; buffered = 0
    } catch (error) {
      await close()
      throw recorderOpenFailure(error)
    }
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
  return port.vendorId?.toLowerCase() === '2fe3' && port.productId?.toLowerCase() === '0002'
    || /arkme recorder/i.test(port.manufacturer ?? '')
}
