import { describe, expect, it } from 'vitest'
import { arkmePrivacyLockedRecord, arkmePrivacyLockedTopic } from '../src/services/privacy-visibility.js'

describe('Arkme privacy visibility', () => {
  it('recognizes protected records in both current and compatibility payload shapes', () => {
    expect(arkmePrivacyLockedRecord({ record_core: { content_access_state: 2 } })).toBe(true)
    expect(arkmePrivacyLockedRecord({ contentAccessState: '2' })).toBe(true)
    expect(arkmePrivacyLockedRecord({ record_core: { content_access_state: 1 } })).toBe(false)
  })

  it('recognizes privacy-locked topics before they reach a directory projection', () => {
    expect(arkmePrivacyLockedTopic({ topic_core: { privacy_state: 2 } })).toBe(true)
    expect(arkmePrivacyLockedTopic({ topic_core: { privacy_state: 1 } })).toBe(false)
  })
})
