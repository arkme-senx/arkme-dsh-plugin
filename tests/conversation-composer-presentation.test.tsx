import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const arkoSource = readFileSync(new URL('../src/client/ArkmeArkoSurface.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
const presentationModuleUrl = new URL('../src/client/conversation-composer-presentation.ts', import.meta.url)

describe('Arkme conversation composer presentation', () => {
  it('defines the private and group chat sizing contract once', async () => {
    expect(existsSync(fileURLToPath(presentationModuleUrl))).toBe(true)
    const presentation = await import(presentationModuleUrl.href) as {
      arkmeConversationComposerHeight: (scrollHeight: number) => number
      arkmeConversationComposerLayout: Record<string, Record<string, unknown>>
    }
    const { arkmeConversationComposerHeight, arkmeConversationComposerLayout } = presentation

    expect(arkmeConversationComposerLayout.composer).toMatchObject({
      justifyContent: 'stretch',
      padding: '0 24px 20px',
    })
    expect(arkmeConversationComposerLayout.composerInner).toMatchObject({
      width: '100%',
      gap: 8,
      padding: '12px 13px 9px',
      borderRadius: 15,
    })
    expect(arkmeConversationComposerLayout.textarea).toMatchObject({
      minHeight: 38,
      maxHeight: 336,
      padding: 0,
      fontSize: 13,
      lineHeight: '21px',
    })
    expect(arkmeConversationComposerLayout.tools).toMatchObject({
      justifyContent: 'space-between',
      gap: 4,
      padding: 0,
    })
    expect(arkmeConversationComposerHeight(28)).toBe(28)
    expect(arkmeConversationComposerHeight(630)).toBe(336)
  })

  it('keeps Agent behavior in the Arko surface while both surfaces consume shared presentation', () => {
    for (const source of [sidebarSource, arkoSource]) {
      expect(source).toContain("from './conversation-composer-presentation.js'")
      expect(source).toContain('...arkmeConversationComposerLayout.composer')
      expect(source).toContain('...arkmeConversationComposerLayout.composerInner')
      expect(source).toContain('...arkmeConversationComposerLayout.textarea')
      expect(source).toContain('...arkmeConversationComposerLayout.tools')
      expect(source).toContain('arkmeConversationComposerHeight(textarea.scrollHeight)')
      expect(source).not.toMatch(/Math\.min\(textarea\.scrollHeight,\s*(180|336)\)/)
    }

    expect(arkoSource).toContain("callArkme<ArkmeArkoAskResult>('arko.ask'")
    expect(arkoSource).toContain("callArkme<ArkmeArkoCancelResult>('arko.cancel'")
    expect(arkoSource).toContain("callArkme<ArkmeArkoModelCatalog>('arko.model.activate'")
  })
})
