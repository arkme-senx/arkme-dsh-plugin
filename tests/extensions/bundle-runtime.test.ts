import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyArkmeBundleHostExtension } from '../../src/extensions/bundle-runtime.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('Arkme sandboxed Bundle Host runtime', () => {
  it('mounts the packaged Cordis source through the guarded runtime without an external artifact path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-bundle-runtime-'))
    directories.push(root)
    const sourcePath = join(root, 'source.json')
    writeFileSync(sourcePath, JSON.stringify({
      format: 'arkme-cordis-source',
      formatVersion: 1,
      name: '测试 Bundle',
      description: '',
      hostCode: 'return { name: "bundle-test", apply() {} }',
    }))
    const plugin = vi.fn(async () => undefined)
    const effect = vi.fn(() => undefined)

    await applyArkmeBundleHostExtension(
      { plugin, effect } as never,
      pathToFileURL(sourcePath),
      '@arkme-generated/test-bundle',
    )

    expect(plugin).toHaveBeenCalledOnce()
    expect(effect).toHaveBeenCalledTimes(2)
  })
})
