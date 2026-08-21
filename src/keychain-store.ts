import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const WINDOWS_CREDENTIAL_BLOB_MAX_BYTES = 5 * 512
const WINDOWS_CREDENTIAL_OPERATION_TIMEOUT_MS = 10000
const WINDOWS_CREDENTIAL_OUTPUT_LIMIT_BYTES = 1024 * 1024

const WINDOWS_CREDENTIAL_VAULT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime] | Out-Null
[Windows.Security.Credentials.PasswordCredential, Windows.Security.Credentials, ContentType = WindowsRuntime] | Out-Null

function Get-CredentialOrNull([object]$Vault, [string]$Resource, [string]$UserName) {
  try {
    return $Vault.Retrieve($Resource, $UserName)
  } catch {
    $inner = $_.Exception.InnerException
    if ($null -ne $inner -and $inner.HResult -eq -2147023728) { return $null }
    throw
  }
}

$requestText = [Console]::In.ReadToEnd()
$request = $requestText | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($request.service) -or [string]::IsNullOrWhiteSpace($request.account)) {
  throw 'Credential service and account are required'
}
$vault = New-Object Windows.Security.Credentials.PasswordVault

switch ($request.operation) {
  'read' {
    $credential = Get-CredentialOrNull $vault $request.service $request.account
    if ($null -eq $credential) {
      $response = [ordered]@{ ok = $true; found = $false }
    } else {
      $credential.RetrievePassword()
      $response = [ordered]@{ ok = $true; found = $true; value = $credential.Password }
    }
  }
  'write' {
    if ($null -eq $request.payload) { throw 'Credential payload is required' }
    $credential = New-Object Windows.Security.Credentials.PasswordCredential(
      $request.service, $request.account, [string]$request.payload
    )
    $vault.Add($credential)
    $response = [ordered]@{ ok = $true }
  }
  'delete' {
    $credential = Get-CredentialOrNull $vault $request.service $request.account
    if ($null -ne $credential) { $vault.Remove($credential) }
    $response = [ordered]@{ ok = $true }
  }
  default { throw 'Unsupported credential operation' }
}

[Console]::Out.Write(($response | ConvertTo-Json -Compress -Depth 3))
`

const WINDOWS_CREDENTIAL_VAULT_SCRIPT_BASE64 = Buffer
  .from(WINDOWS_CREDENTIAL_VAULT_SCRIPT, 'utf16le')
  .toString('base64')

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

interface ArkmeWindowsCredentialRequest {
  operation: 'read' | 'write' | 'delete'
  service: string
  account: string
  payload?: string
}

interface ArkmeWindowsCredentialResponse {
  ok: true
  found?: boolean
  value?: string
}

function windowsPowerShellPath(): string {
  return join(
    process.env.SystemRoot?.trim() || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
}

function invokeWindowsCredentialVault(
  request: ArkmeWindowsCredentialRequest,
): Promise<ArkmeWindowsCredentialResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(windowsPowerShellPath(), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      WINDOWS_CREDENTIAL_VAULT_SCRIPT_BASE64,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let settled = false
    let stdout = ''
    let stderrBytes = 0

    const finish = (error?: Error, response?: ArkmeWindowsCredentialResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error !== undefined) reject(error)
      else resolve(response as ArkmeWindowsCredentialResponse)
    }
    const failForOutputLimit = (): void => {
      child.kill()
      finish(new Error('Windows Credential Locker 返回内容过大'))
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('Windows Credential Locker 操作超时'))
    }, WINDOWS_CREDENTIAL_OPERATION_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout, 'utf8') > WINDOWS_CREDENTIAL_OUTPUT_LIMIT_BYTES) failForOutputLimit()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > WINDOWS_CREDENTIAL_OUTPUT_LIMIT_BYTES) failForOutputLimit()
    })
    child.stdin.on('error', () => undefined)
    child.on('error', error => { finish(new Error('无法启动 Windows Credential Locker', { cause: error })) })
    child.on('close', code => {
      if (settled) return
      if (code !== 0) {
        finish(new Error(`Windows Credential Locker 操作失败，退出码 ${String(code)}`))
        return
      }
      try {
        const response = JSON.parse(stdout.trim()) as Partial<ArkmeWindowsCredentialResponse>
        if (response.ok !== true) throw new Error('Credential Locker response is invalid')
        finish(undefined, response as ArkmeWindowsCredentialResponse)
      } catch (error) {
        finish(new Error('Windows Credential Locker 返回无效', { cause: error }))
      }
    })
    child.stdin.end(JSON.stringify(request), 'utf8')
  })
}

export class ArkmeWindowsCredentialVaultBackend implements ArkmeWindowsCredentialBackend {
  async read(service: string, account: string): Promise<string | undefined> {
    const response = await invokeWindowsCredentialVault({ operation: 'read', service, account })
    if (response.found !== true) return undefined
    if (typeof response.value !== 'string') throw new Error('Windows Credential Locker 缺少凭据内容')
    return response.value
  }

  async write(service: string, account: string, payload: string): Promise<void> {
    await invokeWindowsCredentialVault({ operation: 'write', service, account, payload })
  }

  async delete(service: string, account: string): Promise<void> {
    await invokeWindowsCredentialVault({ operation: 'delete', service, account })
  }
}

export class ArkmeWindowsCredentialStore implements ArkmeSessionStore {
  private readonly account = 'session'
  private cached: ArkmeSessionCredentials | undefined
  private loaded = false
  private persistence: Promise<void> = Promise.resolve()

  constructor(
    private readonly service: string,
    private readonly backend: ArkmeWindowsCredentialBackend = new ArkmeWindowsCredentialVaultBackend(),
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

function linuxCredentialFailureDetail(error: unknown): string {
  return error instanceof Error && error.message.startsWith('Linux Arkme ')
    ? `：${error.message.slice('Linux Arkme '.length)}`
    : ''
}

function assertLinuxCredentialOwner(uid: number, label: string): void {
  if (typeof process.geteuid === 'function' && uid !== process.geteuid()) {
    throw new Error(`Linux Arkme ${label}不属于当前用户`)
  }
}

async function assertLinuxCredentialDirectory(directory: string, create: boolean): Promise<boolean> {
  let created = false
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') throw error
    if (!create) return false
    await mkdir(directory, { recursive: true, mode: 0o700 })
    created = true
    metadata = await lstat(directory)
  }
  if (metadata.isSymbolicLink()) throw new Error('Linux Arkme 凭据目录不能是符号链接')
  if (!metadata.isDirectory()) throw new Error('Linux Arkme 凭据目录路径不是目录')
  assertLinuxCredentialOwner(metadata.uid, '凭据目录')
  if ((metadata.mode & 0o777) !== 0o700) {
    if (!created) throw new Error('Linux Arkme 凭据目录权限必须为 700')
    await chmod(directory, 0o700)
    metadata = await lstat(directory)
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) {
      throw new Error('Linux Arkme 凭据目录权限必须为 700')
    }
    assertLinuxCredentialOwner(metadata.uid, '凭据目录')
  }
  return true
}

export class ArkmeLinuxFileCredentialStore implements ArkmeSessionStore {
  private cached: ArkmeSessionCredentials | undefined
  private loaded = false
  private operations: Promise<void> = Promise.resolve()

  constructor(private readonly credentialPath: string) {}

  async read(): Promise<ArkmeSessionCredentials | undefined> {
    return await this.serial(async () => {
      if (this.loaded) return this.cached === undefined ? undefined : { ...this.cached }
      let credentialFile: Awaited<ReturnType<typeof open>> | undefined
      try {
        if (!await assertLinuxCredentialDirectory(dirname(this.credentialPath), false)) {
          this.cached = undefined
          this.loaded = true
          return undefined
        }
        credentialFile = await open(this.credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW)
        const file = await credentialFile.stat()
        if (!file.isFile()) throw new Error('Linux Arkme 登录凭据路径不是普通文件')
        assertLinuxCredentialOwner(file.uid, '登录凭据文件')
        if ((file.mode & 0o777) !== 0o600) throw new Error('Linux Arkme 登录凭据文件权限必须为 600')
        const session = validSession(JSON.parse(await credentialFile.readFile('utf8')))
        if (session === undefined) throw new Error('Linux Arkme 登录凭据格式无效')
        this.cached = session
        this.loaded = true
        return { ...this.cached }
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
          this.cached = undefined
          this.loaded = true
          return undefined
        }
        throw new Error(`无法读取 Linux 中的 Arkme 登录凭据${linuxCredentialFailureDetail(error)}`, { cause: error })
      } finally {
        await credentialFile?.close().catch(() => undefined)
      }
    })
  }

  async write(session: ArkmeSessionCredentials): Promise<void> {
    const payload = JSON.stringify(session)
    await this.serial(async () => {
      try {
        const directory = dirname(this.credentialPath)
        const temporaryPath = `${this.credentialPath}.${String(process.pid)}.${randomUUID()}.tmp`
        await assertLinuxCredentialDirectory(directory, true)
        let temporaryFile: Awaited<ReturnType<typeof open>> | undefined
        try {
          temporaryFile = await open(temporaryPath, 'wx', 0o600)
          await temporaryFile.chmod(0o600)
          await temporaryFile.writeFile(payload, 'utf8')
          await temporaryFile.sync()
          const temporaryMetadata = await temporaryFile.stat()
          assertLinuxCredentialOwner(temporaryMetadata.uid, '临时凭据文件')
          if ((temporaryMetadata.mode & 0o777) !== 0o600) {
            throw new Error('Linux Arkme 临时凭据文件权限必须为 600')
          }
          await temporaryFile.close()
          temporaryFile = undefined
          await rename(temporaryPath, this.credentialPath)
        } catch (error) {
          await temporaryFile?.close().catch(() => undefined)
          await unlink(temporaryPath).catch(() => undefined)
          throw error
        }
        this.cached = { ...session }
        this.loaded = true
      } catch (error) {
        throw new Error(`无法写入 Linux 中的 Arkme 登录凭据${linuxCredentialFailureDetail(error)}`, { cause: error })
      }
    })
  }

  async delete(): Promise<void> {
    await this.serial(async () => {
      try {
        if (!await assertLinuxCredentialDirectory(dirname(this.credentialPath), false)) {
          this.cached = undefined
          this.loaded = true
          return
        }
        await unlink(this.credentialPath)
        this.cached = undefined
        this.loaded = true
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
          this.cached = undefined
          this.loaded = true
          return
        }
        throw new Error(`无法删除 Linux 中的 Arkme 登录凭据${linuxCredentialFailureDetail(error)}`, { cause: error })
      }
    })
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation)
    this.operations = next.then(() => undefined, () => undefined)
    return await next
  }
}

export interface ArkmeSessionStoreFactoryOptions {
  platform?: NodeJS.Platform
  windowsBackend?: ArkmeWindowsCredentialBackend
  linuxCredentialPath?: string
}

export function createArkmeSessionStore(
  service: string,
  options: ArkmeSessionStoreFactoryOptions = {},
): ArkmeSessionStore {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return new ArkmeKeychainStore(service)
  if (platform === 'win32') return new ArkmeWindowsCredentialStore(service, options.windowsBackend)
  if (platform === 'linux') {
    if (options.linuxCredentialPath === undefined || options.linuxCredentialPath.trim() === '') {
      throw new Error('Linux Arkme 登录凭据文件路径不能为空')
    }
    return new ArkmeLinuxFileCredentialStore(options.linuxCredentialPath)
  }
  throw new Error(`当前平台不支持保存 Arkme 登录凭据：${platform}`)
}

export interface ArkmeSessionStores {
  sessionStore: ArkmeSessionStore
  pendingSessionStore: ArkmeSessionStore
}

export interface ArkmeSessionStoresFactoryOptions {
  platform?: NodeJS.Platform
  windowsBackend?: ArkmeWindowsCredentialBackend
}

export function createArkmeSessionStores(
  servicePrefix: string,
  environment: 'test' | 'prod',
  stateDirectory: string,
  options: ArkmeSessionStoresFactoryOptions = {},
): ArkmeSessionStores {
  const nativeOptions = {
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.windowsBackend === undefined ? {} : { windowsBackend: options.windowsBackend }),
  }
  const credentialDirectory = join(stateDirectory, 'credentials')
  return {
    sessionStore: createArkmeSessionStore(`${servicePrefix}.${environment}`, {
      ...nativeOptions,
      linuxCredentialPath: join(credentialDirectory, 'session.json'),
    }),
    pendingSessionStore: createArkmeSessionStore(`${servicePrefix}.${environment}.pending-binding`, {
      ...nativeOptions,
      linuxCredentialPath: join(credentialDirectory, 'pending-binding-session.json'),
    }),
  }
}
