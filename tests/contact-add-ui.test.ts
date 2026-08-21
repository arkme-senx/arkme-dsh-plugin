import { describe, expect, it } from 'vitest'
import {
  buildArkmePersonalShareUrl,
  extractArkmeContactIdentifierFromQr,
} from '../src/client/ArkmeContactAddSurface.js'

describe('contact add QR interoperability', () => {
  it('builds the same personal share URL used by the Jiwo mobile client', () => {
    expect(buildArkmePersonalShareUrl('Lin-ccc', 'https://jiwo.cc')).toBe('https://jiwo.cc/Lin-ccc')
  })

  it('extracts supported mobile personal QR routes', () => {
    expect(extractArkmeContactIdentifierFromQr('https://jiwo.cc/Lin-ccc', 'https://jiwo.cc')).toBe('Lin-ccc')
    expect(extractArkmeContactIdentifierFromQr('https://jiwo.cc/shijie/Lin-ccc', 'https://jiwo.cc')).toBe('Lin-ccc')
    expect(extractArkmeContactIdentifierFromQr('https://jiwo.cc/app/shijie/Lin-ccc', 'https://jiwo.cc')).toBe('Lin-ccc')
  })

  it('rejects raw identifiers and unrelated QR URLs', () => {
    expect(extractArkmeContactIdentifierFromQr('Lin-ccc', 'https://jiwo.cc')).toBe('')
    expect(extractArkmeContactIdentifierFromQr('https://example.com/Lin-ccc', 'https://jiwo.cc')).toBe('')
    expect(extractArkmeContactIdentifierFromQr('http://jiwo.cc/Lin-ccc', 'https://jiwo.cc')).toBe('')
    expect(extractArkmeContactIdentifierFromQr('https://jiwo.cc:444/Lin-ccc', 'https://jiwo.cc')).toBe('')
    expect(extractArkmeContactIdentifierFromQr('https://app.arkme.ai/Lin-ccc', 'https://jiwo.cc')).toBe('')
  })
})
