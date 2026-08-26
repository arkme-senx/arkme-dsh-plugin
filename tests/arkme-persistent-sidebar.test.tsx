import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const persistentShellSource = readFileSync(new URL('../src/client/ArkmePersistentShell.tsx', import.meta.url), 'utf8')

describe('Arkme persistent sidebar', () => {
  it('keeps the conversation directory visible while a Bot chat is focused', () => {
    expect(persistentShellSource).toContain("ui.mode === 'source' || ui.mode === 'bot' || ui.mode === 'arko' || harnessMode")
  })
})
