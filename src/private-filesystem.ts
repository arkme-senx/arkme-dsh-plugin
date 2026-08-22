import { execFile, execFileSync } from 'node:child_process'
import { chmod, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const WINDOWS_ACL_TIMEOUT_MS = 10_000
const WINDOWS_ACL_OUTPUT_LIMIT_BYTES = 1024 * 1024
const WINDOWS_SYSTEM_SID = 'S-1-5-18'
const WINDOWS_ADMINISTRATORS_SID = 'S-1-5-32-544'
let cachedWindowsUserSid: string | undefined

function windowsExecutable(name: string): string {
  return join(process.env.SystemRoot?.trim() || 'C:\\Windows', 'System32', name)
}

function windowsUserSid(): string {
  if (cachedWindowsUserSid !== undefined) return cachedWindowsUserSid
  const output = execFileSync(windowsExecutable('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: WINDOWS_ACL_TIMEOUT_MS,
    maxBuffer: WINDOWS_ACL_OUTPUT_LIMIT_BYTES,
  })
  const sid = output.match(/S-\d(?:-\d+)+/i)?.[0]
  if (sid === undefined) throw new Error('无法识别当前 Windows 用户 SID')
  cachedWindowsUserSid = sid
  return sid
}

function windowsAclArguments(path: string, directory: boolean): string[] {
  const inheritance = directory ? '(OI)(CI)' : ''
  return [
    path,
    '/inheritance:r',
    '/grant:r',
    `*${windowsUserSid()}:${inheritance}F`,
    `*${WINDOWS_SYSTEM_SID}:${inheritance}F`,
    `*${WINDOWS_ADMINISTRATORS_SID}:${inheritance}F`,
  ]
}

function secureWindowsPathSync(path: string, directory: boolean): void {
  execFileSync(windowsExecutable('icacls.exe'), windowsAclArguments(path, directory), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: WINDOWS_ACL_TIMEOUT_MS,
    maxBuffer: WINDOWS_ACL_OUTPUT_LIMIT_BYTES,
  })
}

async function secureWindowsPath(path: string, directory: boolean): Promise<void> {
  await execFileAsync(windowsExecutable('icacls.exe'), windowsAclArguments(path, directory), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: WINDOWS_ACL_TIMEOUT_MS,
    maxBuffer: WINDOWS_ACL_OUTPUT_LIMIT_BYTES,
  })
}

export function securePrivateDirectorySync(path: string): void {
  if (process.platform === 'win32') {
    secureWindowsPathSync(path, true)
    return
  }
  chmodSync(path, 0o700)
}

export function securePrivateFileSync(path: string): void {
  if (process.platform === 'win32') {
    secureWindowsPathSync(path, false)
    return
  }
  chmodSync(path, 0o600)
}

export async function securePrivateDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    await secureWindowsPath(path, true)
    return
  }
  await new Promise<void>((resolve, reject) => {
    chmod(path, 0o700, error => error === null ? resolve() : reject(error))
  })
}

export async function securePrivateFile(path: string): Promise<void> {
  if (process.platform === 'win32') {
    await secureWindowsPath(path, false)
    return
  }
  await new Promise<void>((resolve, reject) => {
    chmod(path, 0o600, error => error === null ? resolve() : reject(error))
  })
}
