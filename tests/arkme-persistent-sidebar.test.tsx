import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const persistentShellSource = readFileSync(new URL('../src/client/ArkmePersistentShell.tsx', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n')

describe('Arkme persistent sidebar', () => {
  it('keeps the conversation directory visible while a Bot chat is focused', () => {
    expect(persistentShellSource).toContain("ui.mode === 'source' || ui.mode === 'bot' || ui.mode === 'arko' || harnessMode")
  })

  it('keeps a constrained Arkme workspace visible on Web after logout', () => {
    expect(persistentShellSource).toContain("const webLockedMode = loginMode && !startupAuthGateEnabled()")
    expect(persistentShellSource).toContain('data-arkme-web-locked')
    expect(persistentShellSource).toContain('data-arkme-workspace\n    data-arkme-login-mode="true"')
    expect(persistentShellSource).toContain('aria-label="Arkme 受限工作区导航"')
    expect(persistentShellSource).toContain('lockedDirectory')
    expect(persistentShellSource).toContain('nativeSettings={webLockedHarness}')
    expect(persistentShellSource).toContain('style={{ ...styles.sidebar, width: 0 }}')
  })

  it('opens the Web login above every AppFrame column while retaining Harness as the default logged-out view', () => {
    expect(persistentShellSource).toContain("const webLockedHarness = !startupAuthGateEnabled() && authState.auth?.status !== 'authenticated'")
    expect(persistentShellSource).toContain("const harnessVisible = ui.mode === 'harness' || webLockedHarness")
  })
})
