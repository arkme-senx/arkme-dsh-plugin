import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeFileIcon, arkmeFileIconKind } from '../src/client/ArkmeFileIcon.js'
import { ArkmeAttachmentDraftTile, ArkmeFileCard } from '../src/client/ArkmeRichContent.js'

describe('user-selected Solid file icons', () => {
  it.each([
    ['report.PDF', 'pdf'], ['report.docx', 'word'], ['report.odt', 'word'],
    ['report.xlsx', 'excel'], ['report.ods', 'excel'], ['slides.pptx', 'ppt'], ['slides.odp', 'ppt'],
    ['notes.log', 'txt'], ['notes.markdown', 'md'], ['table.csv', 'csv'],
    ['recording.m4a', 'audio'], ['movie.webm', 'video'], ['archive.tar.gz', 'zip'],
    ['archive.7z', 'zip'], ['ChatGPT.dmg', 'dmg'], ['README', 'default'], ['file.constructor', 'default'],
  ])('uses the shared extension icon for %s', (fileName, kind) => {
    expect(arkmeFileIconKind(fileName, 'application/octet-stream')).toBe(kind)
  })

  it.each([
    ['application/pdf', 'pdf'], ['application/msword', 'word'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
    ['application/vnd.oasis.opendocument.spreadsheet', 'excel'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'ppt'],
    ['text/plain', 'txt'], ['text/markdown', 'md'], ['text/csv', 'csv'],
    ['audio/mpeg', 'audio'], ['video/mp4', 'video'], ['application/x-7z-compressed', 'zip'],
    ['application/x-apple-diskimage', 'dmg'],
  ])('prefers the client MIME classification %s to the extension', (mimeType, kind) => {
    expect(arkmeFileIconKind('misleading.pdf', mimeType)).toBe(kind)
  })

  it('retains all twelve static SVGs from the integrity-checked upstream Solid package', () => {
    const hashes = {
      audio: 'e783d540cf548e3d9298e0588cd49e56ebdf1efc6a8b5f194796cb694b198e48',
      csv: 'b974de782b21462593d7daa90362def1d92ad06132359419f4fb817313f357a8',
      default: '5616577e662fc917f84ba7ae92d1f2488d70cdf41f9425f38962becf88d205e2',
      dmg: '55ff9f5593591ec13542915e445d8eea1e13ed095e5485025b83c4286b0a8bd7',
      excel: '1e41b8e47d2ade389169ee4677e98a0bdf681040bdc929ef89aabdec8aae69ea',
      md: 'a21bef0bd332b31329a39d56f84bb94ff033a8665cd57eb812cf72061db05e46',
      pdf: 'd7c899cd33f02dd104f9378e62959c6e693ce17b6aac5fa30c2e0b922e19662a',
      ppt: 'f63771e273c1be2100321c91d37715e16af4d94381850849454873266903cf63',
      txt: 'd209b03a20b4f4ab8af3c4dfb2b44ee614428283e9d72f675355fd28fa488eda',
      video: '638a9a5852a0b99ed9df8258b9f2df9faea5be2da25d1c395e79b27ced5db301',
      word: '67c3d9f44df841f802dce9998afb8248ddb183ef5df24120757d394867d3cb16',
      zip: '4e840659a90c46b28c7556e2f3f6f54eec63a1e65c5d47eb936bf6242ab2fc01',
    }
    for (const [kind, hash] of Object.entries(hashes)) {
      const svg = readFileSync(new URL(`../assets/file_icons/file_icon_${kind}.svg`, import.meta.url))
      expect(createHash('sha256').update(svg).digest('hex')).toBe(hash)
      expect(svg.toString()).toContain('viewBox="0 0 40 40"')
      expect(svg.toString()).not.toMatch(/<script|<foreignObject|\son\w+=|\shref=|url\(["']?https?:/i)
    }
  })

  it.each([
    ['report.docx', 'application/msword', 'word'],
    ['ChatGPT.dmg', 'application/octet-stream', 'dmg'],
  ])('uses the same Solid icon for %s in draft, message/search card and enlarged preview', (fileName, mimeType, kind) => {
    const file = { fileName, fileKind: 4 as const, mimeType, size: 10 }
    const draft = renderToStaticMarkup(<ArkmeAttachmentDraftTile asset={file} onRemove={() => {}} />)
    const card = renderToStaticMarkup(<ArkmeFileCard block={{ ...file, mediaRef: 'example', sortOrder: 0, kind: 'file' }} />)
    const preview = renderToStaticMarkup(<ArkmeFileIcon {...file} size={64} />)
    for (const html of [draft, card, preview]) {
      expect(html).toContain(`data-arkme-file-icon="${kind}"`)
      expect(html).toContain('data-arkme-file-icon-set="untitled-solid"')
      expect(html).not.toContain('clip-path')
    }
    expect(draft).toContain('width="32"')
    expect(card).toContain('width="40"')
    expect(preview).toContain('width="64"')
  })
})
