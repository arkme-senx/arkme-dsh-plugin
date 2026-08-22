import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmePersonalTestEditionBanner } from '../src/client/ArkmeVirtualWorkspace.js'
import {
  ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY,
  arkmePersonalTestEditionLabel,
  parseArkmePersonalTestEdition,
  parseArkmePersonalTestEditionSearch,
  readArkmePersonalTestEdition,
} from '../src/client/personal-test-edition.js'

describe('Arkme personal test edition', () => {
  it('reads a valid profile-local edition without hard-coding an owner in the plugin', () => {
    const edition = readArkmePersonalTestEdition({
      getItem: key => key === ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY
        ? JSON.stringify({ version: 1, owner: ' 汤慧玲 ', defaultSurface: 'calls' })
        : null,
    })

    expect(edition).toEqual({ version: 1, owner: '汤慧玲', defaultSurface: 'calls' })
    expect(arkmePersonalTestEditionLabel(edition!)).toBe('汤慧玲 · 个人测试版')
  })

  it('ignores malformed, unsupported, or inaccessible local settings', () => {
    expect(parseArkmePersonalTestEdition('{bad json')).toBeUndefined()
    expect(parseArkmePersonalTestEdition(JSON.stringify({ version: 2, owner: '测试', defaultSurface: 'calls' }))).toBeUndefined()
    expect(parseArkmePersonalTestEdition(JSON.stringify({ version: 1, owner: '测试', defaultSurface: 'search' }))).toBeUndefined()
    expect(readArkmePersonalTestEdition({ getItem: () => { throw new Error('blocked') } })).toBeUndefined()
  })

  it('bootstraps and persists an edition from an explicit profile setup link', () => {
    let stored = ''
    const edition = readArkmePersonalTestEdition({
      getItem: () => null,
      setItem: (_key, value) => { stored = value },
    }, '?arkmePersonalTestOwner=%E6%B1%A4%E6%85%A7%E7%8E%B2&arkmePersonalTestSurface=calls')

    expect(edition).toEqual({ version: 1, owner: '汤慧玲', defaultSurface: 'calls' })
    expect(JSON.parse(stored)).toEqual(edition)
    expect(parseArkmePersonalTestEditionSearch('?arkmePersonalTestOwner=测试&arkmePersonalTestSurface=search')).toBeUndefined()
  })

  it('renders a visible personal test marker and default landing hint', () => {
    const markup = renderToStaticMarkup(<ArkmePersonalTestEditionBanner edition={{
      version: 1, owner: '汤慧玲', defaultSurface: 'calls',
    }} />)

    expect(markup).toContain('aria-label="汤慧玲个人测试版"')
    expect(markup).toContain('汤慧玲 · 个人测试版')
    expect(markup).toContain('首次打开默认进入通话测试页')
  })
})
