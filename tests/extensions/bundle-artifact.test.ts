import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARKME_BUNDLE_CONTRACT_VERSION,
  arkmeSandboxEntryId,
  canonicalBundleJson,
  inspectBundleArtifact,
  packBundleFiles,
  packLocalBundleDirectory,
  readLocalBundleTarball,
  renderArkmeSandboxHostEntry,
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

const sandboxPackageName = '@example/sandbox-client'

function sandboxFiles(options: {
  clientDeclaration?: Record<string, unknown>
  clientExport?: unknown
  clientFile?: boolean
  extraExport?: boolean
} = {}): Map<string, Buffer> {
  const exports: Record<string, unknown> = {
    '.': './lib/index.js',
    './package.json': './package.json',
  }
  if (options.clientExport !== undefined) exports['./client'] = options.clientExport
  if (options.extraExport === true) exports['./extra'] = './lib/index.js'
  const manifest = {
    name: sandboxPackageName,
    version: '1.0.0',
    type: 'module',
    main: './lib/index.js',
    files: ['lib', 'arkme', 'cordis.patch.yml'],
    exports,
    peerDependencies: { '@senguoyun/dsh-arkme': '^0.1.8' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      arkme: { executionModel: 'arkme-sandboxed', runtimeContract: ARKME_BUNDLE_CONTRACT_VERSION },
      ...(options.clientDeclaration === undefined ? {} : { client: options.clientDeclaration }),
    },
  }
  const files = new Map<string, Buffer>([
    ['package/package.json', Buffer.from(canonicalBundleJson(manifest), 'utf8')],
    ['package/cordis.patch.yml', Buffer.from([
      '- insert:',
      `    - id: ${arkmeSandboxEntryId(sandboxPackageName)}`,
      `      name: '${sandboxPackageName}'`,
      '',
    ].join('\n'), 'utf8')],
    ['package/arkme/source.json', Buffer.from('{"format":"arkme-cordis-source","formatVersion":1}\n', 'utf8')],
    ['package/lib/index.js', Buffer.from(renderArkmeSandboxHostEntry(sandboxPackageName), 'utf8')],
  ])
  if (options.clientFile === true) files.set('package/lib/client.js', Buffer.from('export default {}\n', 'utf8'))
  return files
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

  it('accepts the exact Host-only sandbox Client consistency shape', () => {
    const packed = packBundleFiles(sandboxFiles())

    expect(packed.bundle.executionModel).toBe('arkme-sandboxed')
    expect(inspectBundleArtifact(packed.bundle.bytes).files.has('package/lib/client.js')).toBe(false)
  })

  it('accepts the exact Host+Client sandbox consistency shape', () => {
    const packed = packBundleFiles(sandboxFiles({
      clientDeclaration: { platform: 'web', inject: [] },
      clientExport: './lib/client.js',
      clientFile: true,
    }))

    expect(packed.bundle.executionModel).toBe('arkme-sandboxed')
    expect(inspectBundleArtifact(packed.bundle.bytes).files.has('package/lib/client.js')).toBe(true)
  })

  it.each([
    {
      name: 'declaration without file or export',
      options: { clientDeclaration: { platform: 'web', inject: [] } },
    },
    {
      name: 'declaration and file without export',
      options: { clientDeclaration: { platform: 'web', inject: [] }, clientFile: true },
    },
    {
      name: 'declaration and export without file',
      options: { clientDeclaration: { platform: 'web', inject: [] }, clientExport: './lib/client.js' },
    },
    {
      name: 'declaration with wrong export target',
      options: {
        clientDeclaration: { platform: 'web', inject: [] },
        clientExport: './lib/index.js',
        clientFile: true,
      },
    },
    {
      name: 'file without declaration or export',
      options: { clientFile: true },
    },
    {
      name: 'export without declaration or file',
      options: { clientExport: './lib/client.js' },
    },
    {
      name: 'non-web declaration with otherwise complete Client bundle',
      options: {
        clientDeclaration: { platform: 'desktop', inject: [] },
        clientExport: './lib/client.js',
        clientFile: true,
      },
    },
    {
      name: 'extra export in a complete Client bundle',
      options: {
        clientDeclaration: { platform: 'web', inject: [] },
        clientExport: './lib/client.js',
        clientFile: true,
        extraExport: true,
      },
    },
  ])('rejects sandbox Client mismatch: $name', ({ options }) => {
    expect(() => packBundleFiles(sandboxFiles(options))).toThrowError(expect.objectContaining({
      code: 'bundle-sandbox-client-invalid',
    }))
  })
})
