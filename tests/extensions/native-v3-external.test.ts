import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectBundleArtifact, inspectNativeBundleArtifactV3 } from '../../src/extensions/bundle-artifact.js'

const externalTarball = process.env.ARKME_NATIVE_V3_TGZ?.trim() ?? ''

describe('native V3 external package gate', () => {
  it.skipIf(externalTarball === '')('accepts an exact npm tgz that V2 rejects', () => {
    const bytes = readFileSync(externalTarball)
    const inspected = inspectNativeBundleArtifactV3(bytes)

    expect(inspected.executionModel).toBe('dsh-native')
    expect(inspected.packageName).not.toBe('')
    expect(inspected.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(inspected.nativeCapabilities.length).toBeGreaterThan(0)
    expect(() => inspectBundleArtifact(bytes)).toThrow()
  })
})
