import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024

export interface WindowsCredentialRequest {
  operation: 'read' | 'write' | 'delete'
  service: string
  account: string
  payload?: string
}

interface WindowsCredentialResponse {
  ok: true
  found?: boolean
  value?: string
}

export type SpawnWindowsCredentialHelper = (
  command: string,
  args: string[],
  options: {
    windowsHide: boolean
    stdio: ['pipe', 'pipe', 'pipe']
  },
) => ChildProcessWithoutNullStreams

export interface ArkmeWindowsCredentialManagerBackendOptions {
  helperPath?: string
  outputLimitBytes?: number
  spawn?: SpawnWindowsCredentialHelper
  timeoutMs?: number
}

function packagedHelperPath(): string {
  return fileURLToPath(new URL('../assets/windows/arkme-credential-helper.exe', import.meta.url))
}

function validResponse(value: unknown, operation: WindowsCredentialRequest['operation']): WindowsCredentialResponse {
  if (value === null || typeof value !== 'object') throw new Error('helper response must be an object')
  const response = value as Record<string, unknown>
  if (response.ok !== true) throw new Error('helper response is not successful')
  if (operation === 'read') {
    if (typeof response.found !== 'boolean') throw new Error('helper read response is missing found')
    if (response.found && typeof response.value !== 'string') {
      throw new Error('helper read response is missing value')
    }
  }
  return response as unknown as WindowsCredentialResponse
}

export class ArkmeWindowsCredentialManagerBackend {
  private readonly helperPath: string
  private readonly outputLimitBytes: number
  private readonly spawnHelper: SpawnWindowsCredentialHelper
  private readonly timeoutMs: number

  constructor(options: ArkmeWindowsCredentialManagerBackendOptions = {}) {
    this.helperPath = options.helperPath ?? packagedHelperPath()
    this.outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES
    this.spawnHelper = options.spawn ?? spawn
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async read(service: string, account: string): Promise<string | undefined> {
    const response = await this.invoke({ operation: 'read', service, account })
    if (response.found !== true) return undefined
    if (typeof response.value !== 'string') throw new Error('Windows Credential Manager 缺少凭据内容')
    return response.value
  }

  async write(service: string, account: string, payload: string): Promise<void> {
    await this.invoke({ operation: 'write', service, account, payload })
  }

  async delete(service: string, account: string): Promise<void> {
    await this.invoke({ operation: 'delete', service, account })
  }

  private invoke(request: WindowsCredentialRequest): Promise<WindowsCredentialResponse> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = this.spawnHelper(this.helperPath, [], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (error) {
        reject(new Error('无法启动 Windows Credential Manager helper', { cause: error }))
        return
      }

      let settled = false
      let stdout = ''
      let stderrBytes = 0
      const finish = (error?: Error, response?: WindowsCredentialResponse): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error !== undefined) reject(error)
        else resolve(response as WindowsCredentialResponse)
      }
      const failForOutputLimit = (): void => {
        child.kill()
        finish(new Error('Windows Credential Manager helper 返回内容过大'))
      }
      const timeout = setTimeout(() => {
        child.kill()
        finish(new Error('Windows Credential Manager helper 操作超时'))
      }, this.timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (Buffer.byteLength(stdout, 'utf8') > this.outputLimitBytes) failForOutputLimit()
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, 'utf8')
        if (stderrBytes > this.outputLimitBytes) failForOutputLimit()
      })
      child.stdin.on('error', () => undefined)
      child.on('error', error => {
        finish(new Error('无法启动 Windows Credential Manager helper', { cause: error }))
      })
      child.on('close', code => {
        if (settled) return
        if (code !== 0) {
          finish(new Error(`Windows Credential Manager helper 操作失败，退出码 ${String(code)}`))
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as unknown
          finish(undefined, validResponse(parsed, request.operation))
        } catch (error) {
          finish(new Error('Windows Credential Manager helper 返回无效', { cause: error }))
        }
      })
      child.stdin.end(`${JSON.stringify(request)}\n`, 'utf8')
    })
  }
}
