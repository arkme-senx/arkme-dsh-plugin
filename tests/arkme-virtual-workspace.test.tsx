import { describe, expect, it } from 'vitest'
import { arkmeRootDirectoryLoadState } from '../src/client/ArkmeVirtualWorkspace.js'

describe('Arkme conversation directory load state', () => {
  it('shows a blocking loader only while there is no usable directory content', () => {
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, isRefreshing: true, hasSources: false, error: '',
    })).toBe('loading')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, isRefreshing: true, hasSources: true, error: '',
    })).toBe('updating')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: false, isRefreshing: false, hasSources: true, error: 'network unavailable',
    })).toBe('error')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: true, isRefreshing: true, hasSources: true, error: '',
    })).toBe('updating')
    expect(arkmeRootDirectoryLoadState({
      authenticated: true, directory: 'root', baselineReady: true, isRefreshing: false, hasSources: true, error: '',
    })).toBe('idle')
  })
})
