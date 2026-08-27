import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bumpPluginVersion,
  determineAutomaticReleaseVersion,
  prepareAutomaticPluginRelease,
  preparePluginRelease,
} from '../scripts/prepare-plugin-release.mjs'

describe('prepare plugin release', () => {
  it('bumps stable semantic versions by the requested release level', () => {
    expect(bumpPluginVersion('0.1.19', 'patch')).toBe('0.1.20')
    expect(bumpPluginVersion('0.1.19', 'minor')).toBe('0.2.0')
    expect(bumpPluginVersion('0.1.19', 'major')).toBe('1.0.0')
  })

  it('writes the version and update notice as one release unit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-release-'))
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        name: '@senguoyun/dsh-arkme', version: '0.1.19', arkme: { updateNotice: { schemaVersion: 1 } },
      }))
      await expect(preparePluginRelease({
        cwd: directory, bump: 'patch', summary: '修复群成员侧栏收起体验', now: new Date('2026-08-23T11:15:45.000Z'),
      })).resolves.toBe('0.1.20')
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      expect(manifest).toMatchObject({
        version: '0.1.20',
        arkme: { updateNotice: {
          title: 'Arkme 插件 0.1.20 更新',
          summary: '修复群成员侧栏收起体验',
          publishedAt: '2026-08-23T11:15:45.000Z',
          releaseNotesUrl: 'https://github.com/arkme-senx/arkme-dsh-plugin/releases/tag/v0.1.20',
        } },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('auto-increments patch only when master still equals npm latest', () => {
    expect(determineAutomaticReleaseVersion('0.1.22', '0.1.22')).toEqual({
      version: '0.1.23', versionChanged: true, reason: 'auto-patch',
    })
  })

  it('keeps an explicit version increment already merged into master', () => {
    expect(determineAutomaticReleaseVersion('0.2.0', '0.1.22')).toEqual({
      version: '0.2.0', versionChanged: false, reason: 'master-ahead',
    })
  })

  it('rejects a master version behind npm latest', () => {
    expect(() => determineAutomaticReleaseVersion('0.1.21', '0.1.22'))
      .toThrow('master 版本 0.1.21 低于 npm latest 0.1.22')
  })

  it('keeps a pre-incremented version while refreshing its release metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-auto-release-'))
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        name: '@senguoyun/dsh-arkme', version: '0.1.23', arkme: { updateNotice: { schemaVersion: 1 } },
      }))
      await expect(prepareAutomaticPluginRelease({
        cwd: directory,
        publishedVersion: '0.1.22',
        summary: '合并内容已经显式递增版本',
        now: new Date('2026-08-26T08:00:00.000Z'),
      })).resolves.toEqual({ version: '0.1.23', versionChanged: false, reason: 'master-ahead' })
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      expect(manifest).toMatchObject({
        version: '0.1.23',
        arkme: { updateNotice: {
          title: 'Arkme 插件 0.1.23 更新',
          summary: '合并内容已经显式递增版本',
          releaseNotesUrl: 'https://github.com/arkme-senx/arkme-dsh-plugin/releases/tag/v0.1.23',
        } },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
