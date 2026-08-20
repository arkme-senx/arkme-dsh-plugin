import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readDshRuntimeVersion } from '../src/index.js'

describe('readDshRuntimeVersion', () => {
  it('reads the version from the DSH installation that owns the active bin', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-dsh-version-'))
    const lib = join(root, 'lib')
    mkdirSync(lib)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-rc.8' }))

    expect(readDshRuntimeVersion(join(lib, 'bin.js'))).toBe('0.1.0-rc.8')
  })

  it('does not treat a source checkout package version as the released runtime version', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-dsh-source-version-'))
    const src = join(root, 'src')
    mkdirSync(src)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-rc.5' }))

    expect(readDshRuntimeVersion(join(src, 'bin.ts'))).toBeUndefined()
  })

  it('does not invent a version when the installation metadata is unavailable or invalid', () => {
    expect(readDshRuntimeVersion('')).toBeUndefined()
    expect(readDshRuntimeVersion(join(tmpdir(), 'missing-dsh', 'lib', 'bin.js'))).toBeUndefined()
  })
})
