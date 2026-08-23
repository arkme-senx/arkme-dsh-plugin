import { describe, expect, it } from 'vitest'
import { arkmeRootDirectoryLoadState } from '../src/client/ArkmeVirtualWorkspace.js'

describe('Arkme conversation directory first load', () => {
  it('keeps the root directory in a visible loading state until the baseline arrives', () => {
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, error: '',
    })).toBe('loading')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, error: 'network unavailable',
    })).toBe('error')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: true, error: '',
    })).toBe('idle')
  })
})
