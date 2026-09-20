import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArkmePluginError } from './services/service.js'
import type { ArkmeDesktopScreenshotCapability, ArkmeDesktopScreenshotResult } from './desktop-screenshot-contract.js'

const executable = '/usr/sbin/screencapture'
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
type CaptureProcess = (path: string, signal: AbortSignal) => Promise<{ code: number; stderr: string }>

/** Always interactive: no full-screen capture, shell, caller paths or clipboard mutation. */
const captureProcess: CaptureProcess = (path, signal) => new Promise((resolve, reject) => {
  execFile(executable, ['-i', '-s', '-x', '-t', 'png', path], { signal, maxBuffer: 64 * 1024 }, (error, _stdout, stderr) => {
    if (signal.aborted) { reject(signal.reason); return }
    if (error !== null && typeof error.code !== 'number') { reject(error); return }
    resolve({ code: typeof error?.code === 'number' ? error.code : 0, stderr })
  })
})

export class ArkmeDesktopScreenshot {
  private active: AbortController | undefined
  constructor(private readonly options: {
    currentUser: () => Promise<number>
    maxImageBytes: () => number
    platform?: string
    executableAvailable?: () => Promise<boolean>
    capture?: CaptureProcess
    timeoutMs?: number
  }) {}

  async capability(): Promise<ArkmeDesktopScreenshotCapability> {
    if ((this.options.platform ?? process.platform) !== 'darwin') return { available: false, reason: '截屏暂仅支持 macOS，可使用系统截屏后粘贴图片' }
    const available = await (this.options.executableAvailable ?? (async () => {
      try { await access(executable, constants.X_OK); return true } catch { return false }
    }))()
    return available ? { available: true } : { available: false, reason: '系统截屏暂不可用，可使用系统截屏后粘贴图片' }
  }

  cancel(): void { this.active?.abort() }

  async capture(expectedUserId: number, requestSignal?: AbortSignal): Promise<ArkmeDesktopScreenshotResult> {
    if (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0) throw new ArkmePluginError('screenshot-account-required', '请先登录后再截屏', false, 400)
    if (this.active !== undefined) throw new ArkmePluginError('screenshot-busy', '正在截屏，请先完成或按 Esc 取消', false, 409)
    const controller = new AbortController()
    this.active = controller
    const abort = () => controller.abort()
    requestSignal?.addEventListener('abort', abort, { once: true })
    if (requestSignal?.aborted) abort()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; abort() }, this.options.timeoutMs ?? 120_000)
    let directory: string | undefined
    const check = async () => {
      controller.signal.throwIfAborted()
      if (await this.options.currentUser() !== expectedUserId) throw new ArkmePluginError('screenshot-account-changed', '账号已切换，请重新截屏', false, 409)
      controller.signal.throwIfAborted()
    }
    try {
      await check()
      const capability = await this.capability()
      if (!capability.available) throw new ArkmePluginError('screenshot-unavailable', capability.reason!, false, 501)
      directory = await mkdtemp(join(tmpdir(), 'arkme-screenshot-'))
      const path = join(directory, 'capture.png')
      controller.signal.throwIfAborted()
      const result = await (this.options.capture ?? captureProcess)(path, controller.signal)
      await check()
      const info = await stat(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      // macOS returns 1 without diagnostics on Esc; a permission error must not
      // be silently treated as cancellation. Some versions return 0 with no file.
      if (info === undefined && (result.code === 0 || result.code === 1) && result.stderr.trim() === '') return { status: 'cancelled' }
      if (result.code !== 0 || info === undefined) throw new ArkmePluginError('screenshot-permission', '无法截屏。请在系统设置 → 隐私与安全性 → 屏幕录制中允许当前运行环境，然后重试', false, 403)
      if (!info.isFile() || info.size > this.options.maxImageBytes()) throw new ArkmePluginError('screenshot-too-large', '截图过大，请缩小框选区域后重试', false, 413)
      const bytes = await readFile(path)
      if (!bytes.subarray(0, 8).equals(pngSignature)) throw new ArkmePluginError('screenshot-invalid', '未能生成有效截图，请重试', true, 502)
      await check()
      return { status: 'captured', fileName: `截图-${Date.now()}.png`, mimeType: 'image/png', contentBase64: bytes.toString('base64') }
    } catch (error) {
      if (timedOut) throw new ArkmePluginError('screenshot-timeout', '截屏已超时，请重新点击截屏', true, 408)
      if (controller.signal.aborted) return { status: 'cancelled' }
      if (error instanceof ArkmePluginError) throw error
      throw new ArkmePluginError('screenshot-failed', '截屏失败，请检查系统屏幕录制权限后重试', true, 502)
    } finally {
      clearTimeout(timer)
      requestSignal?.removeEventListener('abort', abort)
      // Only the fresh, private directory created above is ever removed.
      try { if (directory !== undefined) await rm(directory, { recursive: true, force: true }) }
      finally { if (this.active === controller) this.active = undefined }
    }
  }
}
