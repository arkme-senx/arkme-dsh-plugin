import { describe, expect, it } from 'vitest'
import { effectiveExtensionPublisherRole } from '../../src/extensions/publisher-role.js'

describe('extension publisher role compatibility', () => {
  const source = {
    type: 'github_repository' as const,
    url: 'https://github.com/example/plugin',
    label: 'GitHub',
    verification: 'publisher_attested' as const,
  }

  it('keeps explicit author even when GitHub provenance exists', () => {
    expect(effectiveExtensionPublisherRole({ publisher_role: 'author', source })).toBe('author')
  })

  it('uses read-only legacy fallbacks', () => {
    expect(effectiveExtensionPublisherRole({ source })).toBe('importer')
    expect(effectiveExtensionPublisherRole({})).toBe('author')
    expect(effectiveExtensionPublisherRole({ publisher_role: 'importer' })).toBe('importer')
  })
})
