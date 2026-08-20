import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('resolves a launcher symlink before locating the DSH package manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-dsh-symlink-'))
    const lib = join(root, 'lib')
    const bin = join(root, 'bin')
    mkdirSync(lib); mkdirSync(bin)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-rc.8' }))
    writeFileSync(join(lib, 'bin.js'), '')
    const launcher = join(bin, 'dsh')
    symlinkSync(join(lib, 'bin.js'), launcher)

    expect(readDshRuntimeVersion(launcher)).toBe('0.1.0-rc.8')
  })

  it('does not invent a version when the installation metadata is unavailable or invalid', () => {
    expect(readDshRuntimeVersion('')).toBeUndefined()
    expect(readDshRuntimeVersion(join(tmpdir(), 'missing-dsh', 'lib', 'bin.js'))).toBeUndefined()
  })
})
