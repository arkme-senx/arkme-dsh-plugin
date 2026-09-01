import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { applyQQ2006HarnessSkinToDocument } from '../src/client/qq2006-harness-skin.js'

const harnessCss = readFileSync(
  new URL('../src/client/redesign/qq2006-harness.css', import.meta.url),
  'utf8',
)

function harnessDocument() {
  const attrs = new Map<string, string>()
  const body = {
    dataset: {} as DOMStringMap,
    setAttribute: vi.fn((name: string, value: string) => { attrs.set(name, value) }),
    getAttribute: vi.fn((name: string) => attrs.get(name) ?? null),
    removeAttribute: vi.fn((name: string) => { attrs.delete(name) }),
  }
  const style = {
    dataset: {} as DOMStringMap,
    textContent: '',
    remove: vi.fn(),
  }
  let installed = false
  const documentRef = {
    body,
    head: { append: vi.fn(() => { installed = true }) },
    createElement: vi.fn(() => style),
    querySelector: vi.fn(() => installed ? style : null),
  } as unknown as Document
  return { body, documentRef, style }
}

describe('QQ2006 DeepSeek Harness skin bridge', () => {
  it('installs the skin marker, token sheet, and native Harness adapter', () => {
    const { body, documentRef, style } = harnessDocument()

    applyQQ2006HarnessSkinToDocument(documentRef, true)

    expect(body.dataset.arkmeSkin).toBe('qq2006')
    expect(body.setAttribute).toHaveBeenCalledWith('data-ds-skin', 'qq2006')
    expect(style.dataset.pluginCss).toBe('@senguoyun/dsh-arkme/qq2006-harness')
    expect(style.textContent).toEqual(expect.any(String))
    expect(harnessCss).toContain("body[data-ds-skin='qq2006'] [data-slot='root']")
    expect(harnessCss).toContain("[data-slot='conversation.composer.bar']")
    expect(harnessCss).toContain("[data-slot='sidebar'] > [class*='_root']:not([class*='_collapsed'])::before")
    expect(harnessCss).toContain("[data-slot='conversation.session.header'] > header:not([class*='_headerHidden'])::after")
    expect(harnessCss).toContain("[data-slot='details'] > [class*='_root']::before")
  })

  it('retracts only the QQ2006 markers and injected sheet', () => {
    const { body, documentRef, style } = harnessDocument()
    applyQQ2006HarnessSkinToDocument(documentRef, true)

    applyQQ2006HarnessSkinToDocument(documentRef, false)

    expect(body.dataset.arkmeSkin).toBeUndefined()
    expect(body.removeAttribute).toHaveBeenCalledWith('data-ds-skin')
    expect(style.remove).toHaveBeenCalledOnce()
  })
})
