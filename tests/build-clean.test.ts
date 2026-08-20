import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('build output cleanup', () => {
  it('removes only the selected lib directory before a portable build', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-clean-build-'))
    directories.push(root)
    const lib = join(root, 'lib')
    mkdirSync(lib)
    writeFileSync(join(lib, 'stale-hash.js'), 'stale')
    writeFileSync(join(root, 'keep.txt'), 'keep')

    execFileSync(process.execPath, ['scripts/clean-lib.mjs', lib], { cwd: process.cwd(), stdio: 'pipe' })

    expect(existsSync(lib)).toBe(false)
    expect(existsSync(join(root, 'keep.txt'))).toBe(true)
  })
})
