import { describe, expect, it } from 'vitest'
import {
  extensionProfileRollbackArgs,
  parseExtensionProfileRestartPlan,
} from '../../src/extensions/profile-restart-helper.js'

function v2Plan() {
  return {
    schemaVersion: 2,
    parentPid: 123,
    execPath: '/runtime/node',
    dshBinPath: '/runtime/dsh/bin.js',
    execArgv: [],
    restartArgv: ['/runtime/dsh/bin.js', '--profile', 'web'],
    dshHome: '/isolated/dsh home',
    profileName: 'web',
    packageName: '@example/install-bundle',
    extensionId: 'ext-bundle',
    expectActive: true,
    targetBundlePath: '/isolated/artifacts/new bundle.tgz',
    previousBundlePath: '/isolated/artifacts/old bundle.tgz',
    cleanupPaths: [],
    installStoreDirectory: '/isolated/state',
    healthUrl: 'http://127.0.0.1:39123/arkme-self/api',
    logPath: '/isolated/state/restart.log',
  }
}

describe('Bundle v2 profile restart plan', () => {
  it('accepts a real package name and restores the previous tgz without link conversion', () => {
    const parsed = parseExtensionProfileRestartPlan(v2Plan())

    expect(parsed.schemaVersion).toBe(2)
    expect(extensionProfileRollbackArgs(parsed)).toEqual([
      'add', '/isolated/artifacts/old bundle.tgz',
    ])
  })

  it('removes the exact package when a first installation has no previous tgz', () => {
    const parsed = parseExtensionProfileRestartPlan({ ...v2Plan(), previousBundlePath: undefined })
    expect(extensionProfileRollbackArgs(parsed)).toEqual(['remove', '@example/install-bundle'])
  })
})
