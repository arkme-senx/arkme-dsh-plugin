import { describe, expect, it } from 'vitest'
import * as appUpdateDialog from '../src/client/ArkmeAppUpdateDialog.js'

describe('ArkmeAppUpdateDialog', () => {
  it('hides a downloaded package after its version is dismissed', () => {
    const shouldShow = Reflect.get(appUpdateDialog, 'shouldShowArkmeAppUpdateDialog') as unknown
    expect(shouldShow).toBeTypeOf('function')
    if (typeof shouldShow !== 'function') return

    expect(shouldShow({
      status: 'downloaded', currentVersion: '0.1.0', latestVersion: '0.1.1',
    }, '0.1.1')).toBe(false)
  })
})
