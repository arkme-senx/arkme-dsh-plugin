import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('Arkme settings architecture', () => {
  it('keeps DSH settings as the only account settings entrypoint', () => {
    expect(existsSync(new URL('../src/client/ArkmeAccountMenu.tsx', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../src/client/ArkmeSettingsRow.tsx', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../src/client/redesign/ArkmeRootFrame.tsx', import.meta.url))).toBe(false)

    const adapter = source('../src/client/index.tsx')
    expect(adapter).toContain("ctx.slots.inject('settings.section'")
    expect(adapter).toContain("id: 'arkme-account'")
    expect(adapter).not.toContain('ArkmeAccountMenu')
    expect(adapter).not.toContain('ArkmeSettingsRow')
    expect(adapter).not.toContain('ArkmeRootFrame')
    expect(adapter).not.toContain('export { ArkmeSettingsSurface }')
  })

  it('does not retain a parallel settings state machine', () => {
    const controller = source('../src/client/ui-controller.ts')
    const shell = source('../src/client/ArkmePersistentShell.tsx')
    const sidebar = source('../src/client/ArkmeSidebar.tsx')
    const surface = source('../src/client/ArkmeSettingsSurface.tsx')

    expect(controller).not.toContain("| 'settings'")
    expect(controller).not.toContain('settingsSection')
    expect(controller).not.toContain('showSettings(')
    expect(shell).not.toContain("ui.mode === 'settings'")
    expect(sidebar).not.toContain("ui.mode === 'settings'")
    expect(surface).not.toContain('ArkmeSettingsHost')
    expect(surface).not.toContain('settingsSection')
  })

  it('keeps account migration local instead of refactoring unrelated profile consumers', () => {
    expect(existsSync(new URL('../src/client/account-application.ts', import.meta.url))).toBe(false)
    for (const path of [
      '../src/client/ArkmeArkoSurface.tsx',
      '../src/client/ArkmeCalendarSurface.tsx',
      '../src/client/ArkmeProductNavigation.tsx',
      '../src/client/ArkmeSidebar.tsx',
    ]) {
      expect(source(path)).not.toContain('account-application')
    }
  })

  it('documents the current DSH settings section contract', () => {
    const consumerContract = source('../docs/consumer-plugin-contract.md')
    const directoryDesign = source('../docs/superpowers/specs/2026-08-23-contact-directory-design.md')

    expect(consumerContract).toContain('settings.section')
    expect(consumerContract).not.toContain('settings.general.item')
    expect(directoryDesign).not.toContain('ArkmeRootFrame')
  })
})
