import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

const WINDOWS_PRIVATE_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:ARKME_TEST_PRIVATE_PATH
$entries = @($acl.Access | ForEach-Object {
  [ordered]@{
    sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    type = $_.AccessControlType.ToString()
    rights = [int]$_.FileSystemRights
    inherited = $_.IsInherited
  }
})
$owner = [Security.Principal.NTAccount]$acl.Owner
$result = [ordered]@{
  current_sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  owner_sid = $owner.Translate([Security.Principal.SecurityIdentifier]).Value
  entries = $entries
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 4))
`

interface WindowsAclEntry {
  sid: string
  type: string
  rights: number
  inherited: boolean
}

interface WindowsAclSnapshot {
  current_sid: string
  owner_sid: string
  entries: WindowsAclEntry[]
}

export function expectPrivatePath(path: string, posixMode: 0o600 | 0o700): void {
  if (process.platform !== 'win32') {
    expect(statSync(path).mode & 0o777).toBe(posixMode)
    return
  }
  const powershell = join(
    process.env.SystemRoot?.trim() || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const output = execFileSync(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_PRIVATE_ACL_SCRIPT,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ARKME_TEST_PRIVATE_PATH: path },
  })
  const snapshot = JSON.parse(output) as WindowsAclSnapshot
  const allowedSids = new Set([snapshot.current_sid, 'S-1-5-18', 'S-1-5-32-544'])
  expect(allowedSids.has(snapshot.owner_sid)).toBe(true)
  expect(snapshot.entries).toHaveLength(3)
  for (const entry of snapshot.entries) {
    expect(allowedSids.has(entry.sid)).toBe(true)
    expect(entry.type).toBe('Allow')
    expect(entry.rights).toBe(2_032_127)
    expect(entry.inherited).toBe(false)
  }
}
