import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectBundleArtifact,
  packLocalBundleDirectory,
  readLocalBundleTarball,
} from '../../src/extensions/bundle-artifact.js'

const directories: string[] = []

function bundleDirectory(scripts?: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arkme bundle source '))
  directories.push(root)
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: '@example/weather-bundle',
    version: '1.2.3',
    type: 'module',
    files: ['lib', 'cordis.patch.yml'],
    ...(scripts === undefined ? {} : { scripts }),
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(root, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: arkme-aa1dd81f3dd3960b-weather',
    "      name: '@example/weather-bundle'",
    '',
  ].join('\n'))
  writeFileSync(join(root, 'lib', 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(root, '.env'), 'MUST_NOT_SHIP=secret\n')
  return root
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('standard DSH Bundle artifact', () => {
  it('packs a local Bundle deterministically without files outside package.json files', () => {
    const root = bundleDirectory()

    const first = packLocalBundleDirectory(root)
    const second = packLocalBundleDirectory(root)

    expect(Buffer.from(first.bundle.bytes).equals(Buffer.from(second.bundle.bytes))).toBe(true)
    expect(first.bundle).toMatchObject({
      packageName: '@example/weather-bundle',
      version: '1.2.3',
      executionModel: 'dsh-native',
      bundleSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      packageJsonSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(first.source.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    const inspected = inspectBundleArtifact(first.bundle.bytes)
    expect(inspected.files.has('package/.env')).toBe(false)
    expect(inspected.files.get('package/lib/index.js')?.toString('utf8')).toBe('export function apply() {}\n')
  })

  it('rejects lifecycle scripts before packaging a local Bundle', () => {
    const root = bundleDirectory({ install: 'node install.js' })
    expect(() => packLocalBundleDirectory(root)).toThrowError(expect.objectContaining({
      code: 'bundle-scripts-forbidden',
    }))
  })

  it('reuses a validated local tgz without changing its bytes', () => {
    const root = bundleDirectory()
    const packed = packLocalBundleDirectory(root)
    const tarballPath = join(root, 'weather.tgz')
    writeFileSync(tarballPath, packed.bundle.bytes)

    const reread = readLocalBundleTarball(tarballPath)

    expect(Buffer.from(reread.bundle.bytes).equals(Buffer.from(readFileSync(tarballPath)))).toBe(true)
    expect(reread.bundle.bundleSha256).toBe(packed.bundle.bundleSha256)
    expect(reread.bundle.executionModel).toBe('dsh-native')
  })

  it('rejects a forged sandbox marker whose Host entry bypasses the Arkme runtime', () => {
    const root = bundleDirectory()
    mkdirSync(join(root, 'arkme'), { recursive: true })
    writeFileSync(join(root, 'arkme', 'source.json'), JSON.stringify({
      format: 'arkme-cordis-source', formatVersion: 1,
    }))
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, any>
    manifest.files = ['lib', 'arkme', 'cordis.patch.yml']
    manifest.type = 'module'
    manifest.main = './lib/index.js'
    manifest.exports = { '.': './lib/index.js', './package.json': './package.json' }
    manifest.dsh.arkme = { executionModel: 'arkme-sandboxed', runtimeContract: 2 }
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(root, 'lib', 'index.js'), 'export function apply() { process.exit(1) }\n')

    expect(() => packLocalBundleDirectory(root)).toThrowError(expect.objectContaining({
      code: 'bundle-sandbox-entry-invalid',
    }))
  })
})
