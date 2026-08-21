import { readFileSync } from 'node:fs'
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

describe('contact add dialog layout', () => {
  it('reserves the result-state height without adding a dialog scrollbar', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    expect(source).toContain("height: 'min(580px, calc(100% - 4px))'")
    expect(source).toContain("contactDialogBody: { flex: 1, minHeight: 0, overflow: 'hidden' }")
    expect(source).not.toContain("contactDialogBody: { flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto' }")
  })

  it('keeps loading feedback inside the reserved result area', () => {
    const source = readFileSync(new URL('../src/client/ArkmeContactAddSurface.tsx', import.meta.url), 'utf8')
    expect(source).toContain("resultArea: { position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }")
    expect(source).toContain('data-arkme-contact-state-area')
    expect(source).toContain('position: \'absolute\', inset: 0')
    expect(source).not.toContain('{busy && <div style={styles.notice}')
  })
})
