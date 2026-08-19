import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arkmeSettingsTitle } from '../src/client/ArkmeSettingsRow.js'

describe('ArkmeSettingsRow', () => {
  it('folds the installed version into the single account-row title', () => {
    expect(arkmeSettingsTitle('0.1.2')).toBe('Arkme v0.1.2')
    expect(arkmeSettingsTitle(undefined)).toBe('Arkme v…')
  })

  it('does not keep a second plugin settings row or update actions', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsRow.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('Arkme 插件')
    expect(source).not.toContain('立即更新并重启')
    expect(source).not.toContain('复制更新命令')
    expect(source).not.toContain('检查更新')
  })
})
