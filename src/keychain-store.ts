import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface JotmoSessionCredentials {
  accessToken: string
  refreshToken: string
  userId: number
}

function validSession(value: unknown): JotmoSessionCredentials | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (typeof source.accessToken !== 'string' || source.accessToken === '') return undefined
  if (typeof source.refreshToken !== 'string' || source.refreshToken === '') return undefined
  if (typeof source.userId !== 'number' || !Number.isSafeInteger(source.userId) || source.userId <= 0) {
    return undefined
  }
  return {
    accessToken: source.accessToken,
    refreshToken: source.refreshToken,
    userId: source.userId,
  }
}

export class JotmoKeychainStore {
  private readonly account = 'session'
  private cached: JotmoSessionCredentials | undefined
  private loaded = false
  private persistence: Promise<void> = Promise.resolve()

  constructor(private readonly service: string) {}

  async read(): Promise<JotmoSessionCredentials | undefined> {
    if (this.loaded) return this.cached === undefined ? undefined : { ...this.cached }
    this.requireMacOS()
    try {
      const { stdout } = await execFileAsync('/usr/bin/security', [
        'find-generic-password',
        '-a', this.account,
        '-s', this.service,
        '-w',
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
      this.cached = validSession(JSON.parse(stdout.trim()))
      this.loaded = true
      return this.cached === undefined ? undefined : { ...this.cached }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === 44 || code === 45) {
        this.loaded = true
        this.cached = undefined
        return undefined
      }
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      if (stderr.includes('could not be found')) {
        this.loaded = true
        this.cached = undefined
        return undefined
      }
      throw new Error('无法读取即我登录凭据', { cause: error })
    }
  }

  async write(session: JotmoSessionCredentials): Promise<void> {
    this.requireMacOS()
    this.cached = { ...session }
    this.loaded = true
    const payload = JSON.stringify(this.cached)
    const persist = async (): Promise<void> => {
      await execFileAsync('/usr/bin/security', [
        'add-generic-password',
        '-a', this.account,
        '-s', this.service,
        '-U',
        '-w', payload,
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5000 })
    }
    const next = this.persistence.then(persist, persist)
    this.persistence = next.catch(() => undefined)
    void next.catch(() => {
      console.warn('dsh-jotmo: Keychain persistence failed; the in-memory session remains active')
    })
  }

  async delete(): Promise<void> {
    this.requireMacOS()
    this.cached = undefined
    this.loaded = true
    await this.persistence
    try {
      await execFileAsync('/usr/bin/security', [
        'delete-generic-password',
        '-a', this.account,
        '-s', this.service,
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5000 })
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      if (code === 44 || code === 45 || stderr.includes('could not be found')) return
      throw new Error('无法删除即我登录凭据', { cause: error })
    }
  }

  private requireMacOS(): void {
    if (process.platform !== 'darwin') {
      throw new Error('当前版本只支持使用 macOS Keychain 保存即我登录凭据')
    }
  }
}
