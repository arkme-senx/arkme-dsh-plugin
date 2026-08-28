import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { ArkmeWindowsCredentialManagerBackend } from './windows-credential-helper.js'

const execFileAsync = promisify(execFile)
const WINDOWS_CREDENTIAL_BLOB_MAX_BYTES = 5 * 512

export interface ArkmeSessionCredentials {
  accessToken: string
  refreshToken: string
  userId: number
}

export interface ArkmeSessionStore {
  read(): Promise<ArkmeSessionCredentials | undefined>
  write(session: ArkmeSessionCredentials): Promise<void>
  delete(): Promise<void>
}

function validSession(value: unknown): ArkmeSessionCredentials | undefined {
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

export class ArkmeKeychainStore implements ArkmeSessionStore {
  private readonly account = 'session'
  private cached: ArkmeSessionCredentials | undefined
  private loaded = false
  private persistence: Promise<void> = Promise.resolve()

  constructor(private readonly service: string) {}

  async read(): Promise<ArkmeSessionCredentials | undefined> {
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
      throw new Error('无法读取 Arkme 登录凭据', { cause: error })
    }
  }

  async write(session: ArkmeSessionCredentials): Promise<void> {
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
      console.warn('dsh-arkme: Keychain persistence failed; the in-memory session remains active')
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
      throw new Error('无法删除 Arkme 登录凭据', { cause: error })
    }
  }

  private requireMacOS(): void {
    if (process.platform !== 'darwin') {
      throw new Error('当前版本只支持使用 macOS Keychain 保存 Arkme 登录凭据')
    }
  }
}

export interface ArkmeWindowsCredentialBackend {
  read(service: string, account: string): Promise<string | undefined>
  write(service: string, account: string, payload: string): Promise<void>
  delete(service: string, account: string): Promise<void>
}

/** Generic account-scoped secret storage used by Host-only capabilities. */
export interface ArkmeSecureValueStore {
  read(account: string): Promise<string | undefined>
  write(account: string, payload: string): Promise<void>
  delete(account: string): Promise<void>
}

export type ArkmeMacOSSecureValueWriter = (args: readonly string[], payload: string) => Promise<void>
export type ArkmeMacOSSecureValueReader = (account: string, service: string) => Promise<string | undefined>
export type ArkmeMacOSSecureValueDeleter = (account: string, service: string) => Promise<void>

const MACOS_KEYCHAIN_JXA_SCRIPT = String.raw`
ObjC.import('Foundation')
ObjC.import('Security')
function run(argv) {
  if (argv.length !== 2) throw new Error('invalid Keychain coordinates')
  const query = $.NSMutableDictionary.dictionary
  query.setObjectForKey($("genp"), $("class"))
  query.setObjectForKey($(argv[0]), $("acct"))
  query.setObjectForKey($(argv[1]), $("svce"))
  const payload = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  const update = $.NSMutableDictionary.dictionary
  update.setObjectForKey(payload, $("v_Data"))
  let status = Number($.SecItemUpdate(query, update))
  if (status === -25300) {
    query.setObjectForKey(payload, $("v_Data"))
    status = Number($.SecItemAdd(query, null))
  }
  if (status !== 0) throw new Error('Keychain write failed with status ' + String(status))
}
`

const MACOS_KEYCHAIN_READ_JXA_SCRIPT = String.raw`
ObjC.import('Foundation')
ObjC.import('Security')
function run(argv) {
  if (argv.length !== 2) throw new Error('invalid Keychain coordinates')
  const query = $.NSMutableDictionary.dictionary
  query.setObjectForKey($("genp"), $("class"))
  query.setObjectForKey($(argv[0]), $("acct"))
  query.setObjectForKey($(argv[1]), $("svce"))
  query.setObjectForKey($.NSNumber.numberWithBool(true), $("r_Data"))
  query.setObjectForKey($("m_LimitOne"), $("m_Limit"))
  const result = Ref()
  const status = Number($.SecItemCopyMatching(query, result))
  if (status === -25300) return JSON.stringify({ found: false })
  if (status !== 0) throw new Error('Keychain read failed with status ' + String(status))
  const data = ObjC.castRefToObject(result[0])
  const encoded = data.base64EncodedStringWithOptions(0)
  return JSON.stringify({ found: true, payload: ObjC.unwrap(encoded) })
}
`

const MACOS_KEYCHAIN_DELETE_JXA_SCRIPT = String.raw`
ObjC.import('Foundation')
ObjC.import('Security')
function run(argv) {
  if (argv.length !== 2) throw new Error('invalid Keychain coordinates')
  const query = $.NSMutableDictionary.dictionary
  query.setObjectForKey($("genp"), $("class"))
  query.setObjectForKey($(argv[0]), $("acct"))
  query.setObjectForKey($(argv[1]), $("svce"))
  const status = Number($.SecItemDelete(query))
  if (status !== 0 && status !== -25300) {
    throw new Error('Keychain delete failed with status ' + String(status))
  }
}
`

async function runMacOSKeychainJXA(
  script: string,
  args: readonly string[],
  operation: '读取' | '写入' | '删除',
  stdin?: string,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', [
      '-l', 'JavaScript', '-e', script, ...args,
    ], {
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined) resolve(stdout.trim())
      else reject(error)
    }
    const terminate = (): void => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGKILL') }
        catch { child.kill('SIGKILL') }
      } else child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      terminate()
      finish(new Error(`${operation} macOS Keychain 超时`))
    }, 5_000)
    timer.unref()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (stdout.length + String(chunk).length > 1024 * 1024) {
        terminate()
        finish(new Error(`macOS Keychain ${operation}结果超出限制`))
        return
      }
      stdout += String(chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      if (stderr.length < 64 * 1024) stderr += String(chunk).slice(0, 64 * 1024 - stderr.length)
    })
    child.once('error', error => finish(new Error(`无法启动 macOS Keychain ${operation}命令`, { cause: error })))
    child.once('close', code => {
      if (code === 0) finish()
      else finish(new Error(`macOS Keychain ${operation}失败（退出码 ${String(code)}）：${stderr.trim().slice(0, 512)}`))
    })
    child.stdin.once('error', error => finish(new Error(`无法向 macOS Keychain ${operation}命令写入数据`, { cause: error })))
    child.stdin.end(stdin ?? '', 'utf8')
  })
}

function macOSSecureValueCoordinates(args: readonly string[]): { account: string; service: string } {
  if (args.length !== 7 || args[0] !== 'add-generic-password' || args[1] !== '-a'
    || args[3] !== '-s' || args[5] !== '-U' || args[6] !== '-w'
    || args[2]?.trim() === '' || args[4]?.trim() === '') {
    throw new Error('macOS Keychain 写入参数无效')
  }
  return { account: args[2]!, service: args[4]! }
}

export async function writeArkmeMacOSSecureValue(
  args: readonly string[],
  payload: string,
): Promise<void> {
  const coordinates = macOSSecureValueCoordinates(args)
  // `security ... -w` reads a terminal password field that truncates long
  // JSON credentials. JXA calls the native Security Framework and receives
  // the complete secret as NSData over stdin, never argv or a persisted file.
  await runMacOSKeychainJXA(
    MACOS_KEYCHAIN_JXA_SCRIPT,
    [coordinates.account, coordinates.service],
    '写入',
    payload,
  )
}

export async function readArkmeMacOSSecureValue(account: string, service: string): Promise<string | undefined> {
  const output = await runMacOSKeychainJXA(MACOS_KEYCHAIN_READ_JXA_SCRIPT, [account, service], '读取')
  let result: unknown
  try {
    result = JSON.parse(output)
  } catch (error) {
    throw new Error('macOS Keychain 读取结果无效', { cause: error })
  }
  if (result === null || typeof result !== 'object') throw new Error('macOS Keychain 读取结果无效')
  const record = result as Record<string, unknown>
  if (record.found === false) return undefined
  if (record.found !== true || typeof record.payload !== 'string') throw new Error('macOS Keychain 读取结果无效')
  return Buffer.from(record.payload, 'base64').toString('utf8')
}

export async function deleteArkmeMacOSSecureValue(account: string, service: string): Promise<void> {
  await runMacOSKeychainJXA(MACOS_KEYCHAIN_DELETE_JXA_SCRIPT, [account, service], '删除')
}

export class ArkmeMacOSSecureValueStore implements ArkmeSecureValueStore {
  constructor(
    private readonly service: string,
    private readonly writer: ArkmeMacOSSecureValueWriter = writeArkmeMacOSSecureValue,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly reader: ArkmeMacOSSecureValueReader = readArkmeMacOSSecureValue,
    private readonly deleter: ArkmeMacOSSecureValueDeleter = deleteArkmeMacOSSecureValue,
  ) {}

  async read(account: string): Promise<string | undefined> {
    this.requireMacOS()
    try {
      return await this.reader(account, this.service)
    } catch (error) {
      throw new Error('无法读取 macOS Keychain 中的 Arkme 安全数据', { cause: error })
    }
  }

  async write(account: string, payload: string): Promise<void> {
    this.requireMacOS()
    await this.writer([
      'add-generic-password', '-a', account, '-s', this.service, '-U', '-w',
    ], payload)
  }

  async delete(account: string): Promise<void> {
    this.requireMacOS()
    try {
      await this.deleter(account, this.service)
    } catch (error) {
      throw new Error('无法删除 macOS Keychain 中的 Arkme 安全数据', { cause: error })
    }
  }

  private requireMacOS(): void {
    if (this.platform !== 'darwin') throw new Error('macOS Keychain 只能在 macOS 使用')
  }
}

export class ArkmeWindowsSecureValueStore implements ArkmeSecureValueStore {
  constructor(
    private readonly service: string,
    private readonly backend: ArkmeWindowsCredentialBackend = new ArkmeWindowsCredentialManagerBackend(),
  ) {}

  async read(account: string): Promise<string | undefined> {
    return await this.backend.read(this.service, account)
  }

  async write(account: string, payload: string): Promise<void> {
    if (Buffer.byteLength(payload, 'utf16le') > WINDOWS_CREDENTIAL_BLOB_MAX_BYTES) {
      throw new Error('Arkme 安全数据超出 Windows Credential Manager 容量限制')
    }
    await this.backend.write(this.service, account, payload)
  }

  async delete(account: string): Promise<void> {
    await this.backend.delete(this.service, account)
  }
}

export function createArkmeSecureValueStore(
  service: string,
  options: ArkmeSessionStoreFactoryOptions = {},
): ArkmeSecureValueStore {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return new ArkmeMacOSSecureValueStore(service)
  if (platform === 'win32') return new ArkmeWindowsSecureValueStore(service, options.windowsBackend)
  throw new Error(`当前版本只支持在 macOS 或 Windows 保存 Arkme 安全数据，当前平台：${platform}`)
}

export class ArkmeWindowsCredentialVaultBackend extends ArkmeWindowsCredentialManagerBackend {}

export class ArkmeWindowsCredentialStore implements ArkmeSessionStore {
  private readonly account = 'session'
  private cached: ArkmeSessionCredentials | undefined
  private loaded = false
  private persistence: Promise<void> = Promise.resolve()

  constructor(
    private readonly service: string,
    private readonly backend: ArkmeWindowsCredentialBackend = new ArkmeWindowsCredentialManagerBackend(),
  ) {}

  async read(): Promise<ArkmeSessionCredentials | undefined> {
    if (this.loaded) return this.cached === undefined ? undefined : { ...this.cached }
    try {
      const payload = await this.backend.read(this.service, this.account)
      this.cached = payload === undefined ? undefined : validSession(JSON.parse(payload))
      this.loaded = true
      return this.cached === undefined ? undefined : { ...this.cached }
    } catch (error) {
      throw new Error('无法读取 Windows Credential Locker 中的 Arkme 登录凭据', { cause: error })
    }
  }

  async write(session: ArkmeSessionCredentials): Promise<void> {
    const payload = JSON.stringify(session)
    if (Buffer.byteLength(payload, 'utf16le') > WINDOWS_CREDENTIAL_BLOB_MAX_BYTES) {
      throw new Error('Arkme 登录凭据超出 Windows Credential Locker 容量限制')
    }
    const persist = async (): Promise<void> => {
      await this.backend.write(this.service, this.account, payload)
    }
    const next = this.persistence.then(persist, persist)
    this.persistence = next.catch(() => undefined)
    try {
      await next
      this.cached = { ...session }
      this.loaded = true
    } catch (error) {
      throw new Error('无法写入 Windows Credential Locker 中的 Arkme 登录凭据', { cause: error })
    }
  }

  async delete(): Promise<void> {
    await this.persistence
    try {
      await this.backend.delete(this.service, this.account)
      this.cached = undefined
      this.loaded = true
    } catch (error) {
      throw new Error('无法删除 Windows Credential Locker 中的 Arkme 登录凭据', { cause: error })
    }
  }
}

export interface ArkmeSessionStoreFactoryOptions {
  platform?: NodeJS.Platform
  windowsBackend?: ArkmeWindowsCredentialBackend
}

export function createArkmeSessionStore(
  service: string,
  options: ArkmeSessionStoreFactoryOptions = {},
): ArkmeSessionStore {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return new ArkmeKeychainStore(service)
  if (platform === 'win32') return new ArkmeWindowsCredentialStore(service, options.windowsBackend)
  throw new Error(`当前版本只支持在 macOS 或 Windows 保存 Arkme 登录凭据，当前平台：${platform}`)
}
