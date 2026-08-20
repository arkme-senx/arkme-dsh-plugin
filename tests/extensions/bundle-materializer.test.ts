import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  arkmeSandboxEntryId, canonicalBundleJson, inspectBundleArtifact, packBundleFiles,
} from '../../src/extensions/bundle-artifact.js'
import { materializeCordisBundle } from '../../src/extensions/bundle-materializer.js'

describe('Cordis to DSH Bundle materializer', () => {
  it('materializes identical Cordis source into one deterministic sandboxed Bundle', () => {
    const input = {
      packageName: '@arkme-generated/weather-7f3a',
      name: '天气助手',
      description: '展示天气',
      version: '1.0.0',
      hostCode: 'return { name: "weather", apply() {} }',
      clientCode: 'return { name: "weather-client", apply() {} }',
    }

    const first = materializeCordisBundle(input)
    const second = materializeCordisBundle(input)

    expect(Buffer.from(first.bundle.bytes).equals(Buffer.from(second.bundle.bytes))).toBe(true)
    expect(first.bundle).toMatchObject({
      packageName: input.packageName,
      version: input.version,
      executionModel: 'arkme-sandboxed',
    })
    const inspected = inspectBundleArtifact(first.bundle.bytes)
    const packageJSON = JSON.parse(inspected.files.get('package/package.json')!.toString('utf8')) as Record<string, unknown>
    expect(packageJSON).toMatchObject({
      type: 'module', main: './lib/index.js',
      exports: { '.': './lib/index.js', './package.json': './package.json' },
    })
    expect(Object.keys(packageJSON.exports as Record<string, unknown>).sort()).toEqual(['.', './package.json'])
    expect(inspected.patchIds).toEqual([arkmeSandboxEntryId(input.packageName)])
    expect(Buffer.from(first.source.bytes).equals(Buffer.from(first.bundle.bytes))).toBe(true)
    expect(first.source.bytes.byteLength).toBe(first.bundle.bytes.byteLength)
    expect(first.source.sourceSha256).toBe(first.bundle.bundleSha256)
    expect(JSON.parse(inspected.files.get('package/arkme/source.json')!.toString('utf8'))).toMatchObject({
      format: 'arkme-cordis-source',
      formatVersion: 1,
      name: input.name,
      hostCode: input.hostCode,
      clientCode: input.clientCode,
    })
    expect(inspected.files.get('package/lib/index.js')?.toString('utf8')).toContain(
      '@senguoyun/dsh-arkme/bundle-runtime',
    )
    expect(inspected.files.get('package/lib/client.js')?.toString('utf8')).toContain('extensions.bundle.invoke')
    expect(inspected.files.get('package/lib/client.js')?.toString('utf8')).not.toContain('尚未加载')
  })

  it('rejects an arkme-sandboxed patch that loads a package subpath', () => {
    const source = materializeCordisBundle({
      packageName: '@arkme-generated/subpath-test', name: 'Subpath', description: '', version: '1.0.0',
      hostCode: 'return { apply() {} }',
    })
    const files = new Map(inspectBundleArtifact(source.bundle.bytes).files)
    files.set('package/cordis.patch.yml', Buffer.from([
      '- insert:',
      `    - id: ${arkmeSandboxEntryId('@arkme-generated/subpath-test')}`,
      "      name: '@arkme-generated/subpath-test/lib/index.js'",
      '',
    ].join('\n'), 'utf8'))

    expect(() => packBundleFiles(files)).toThrowError(expect.objectContaining({
      code: 'bundle-sandbox-patch-invalid',
    }))
  })

  it('rejects extra exports from an arkme-sandboxed package', () => {
    const source = materializeCordisBundle({
      packageName: '@arkme-generated/exports-test', name: 'Exports', description: '', version: '1.0.0',
      hostCode: 'return { apply() {} }',
    })
    const files = new Map(inspectBundleArtifact(source.bundle.bytes).files)
    const manifest = JSON.parse(files.get('package/package.json')!.toString('utf8')) as Record<string, any>
    manifest.exports['./internal'] = './lib/index.js'
    files.set('package/package.json', Buffer.from(canonicalBundleJson(manifest), 'utf8'))

    expect(() => packBundleFiles(files)).toThrowError(expect.objectContaining({
      code: 'bundle-sandbox-manifest-invalid',
    }))
  })
})
