import { describe, expect, it } from 'vitest'
import { inspectBundleArtifact } from '../../src/extensions/bundle-artifact.js'
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
})
