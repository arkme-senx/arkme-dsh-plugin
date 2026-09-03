import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { arkmeToolCatalog } from '../src/tools/index.js'

const root = fileURLToPath(new URL('..', import.meta.url))

function textFiles(path: string): string[] {
  return readdirSync(path).flatMap(name => {
    const child = join(path, name)
    if (statSync(child).isDirectory()) return textFiles(child)
    return /\.(?:md|ts|tsx|json|yml)$/.test(name) ? [child] : []
  })
}

function withoutInfrastructureNames(content: string): string {
  return content
    .replaceAll('https://jotmo.senguo.me', '')
    .replaceAll('https://jotmo-app.senguo.me', '')
    .replaceAll('https://jotmo-subject.senguo.me', '')
    .replaceAll('https://jotmo-record.senguo.me', '')
    .replaceAll('https://jotmo-data.senguo.me', '')
    .replaceAll('https://jotmo-chat.senguo.me', '')
    .replaceAll('https://jotmo-bot.senguo.me', '')
    .replaceAll('https://jotmo-im.senguo.me', '')
    .replaceAll('https://jotmo-webrtc.senguo.me', '')
    .replaceAll('https://jotmo-world.senguo.me', '')
    .replaceAll('https://jotmo-relation.senguo.me', '')
    .replaceAll('https://jotmo-intelligent.senguo.me', '')
    .replaceAll('https://jotmo-audio.senguo.me', '')
    .replaceAll('https://jotmo-extension-publish.senguo.me', '')
    .replaceAll('https://api.jotmo.cc', '')
    .replaceAll('https://subject.jotmo.cc', '')
    .replaceAll('https://record.jotmo.cc', '')
    .replaceAll('https://data.jotmo.cc', '')
    .replaceAll('https://chat.jotmo.cc', '')
    .replaceAll('https://bot.jotmo.cc', '')
    .replaceAll('https://im.jotmo.cc', '')
    .replaceAll('https://webrtc.jiwo.cc', '')
    .replaceAll('https://jiwo.cc', '')
    .replaceAll('https://world.jotmo.cc', '')
    .replaceAll('https://relation.jotmo.cc', '')
    .replaceAll('https://intelligent.jotmo.cc', '')
    .replaceAll('https://audio.jotmo.cc', '')
    .replaceAll('https://extension-publish.jotmo.cc', '')
    .replaceAll('https://team.jotmo.cc', '')
    .replaceAll('https://jotmo-team.senguo.me', '')
    .replaceAll('https://d.jiwo.cc', '')
    .replaceAll('jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', '')
    .replaceAll('jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', '')
    .replaceAll('jotmo-userfiles.senguo.me', '')
    .replaceAll('userfiles.jotmo.cc', '')
    .replaceAll('jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com', '')
    .replaceAll('jotmo-useraudio.oss-cn-hangzhou.aliyuncs.com', '')
    .replaceAll('X-Jotmo-Runtime-Instance-Id', '')
    .replaceAll('X-Jotmo-SSE-Identity-Version', '')
    .replaceAll('data.jotmo_id', '')
    .replaceAll('data.can_update_jotmo_id', '')
    .replaceAll('raw.jotmo_id', '')
    .replaceAll('raw.jotmoId', '')
    .replaceAll('item.jotmo_id', '')
    .replaceAll('/api/v1/auth/check-jotmo-id-available', '')
    .replaceAll('/api/v1/auth/update-jotmo-id', '')
    .replaceAll('recipient_jotmo_id', '')
    .replaceAll("'jotmo-userfiles-test'", '')
    .replaceAll("'jotmo-userfiles'", '')
    .replaceAll("'jotmo-useraudio-test'", '')
    .replaceAll("'jotmo-useraudio'", '')
    .replaceAll('dsh-worktrees/jotmo-virtual-workspace', '')
    // Frozen cross-repository protocol identifiers; these are not product UI copy.
    .replaceAll('jotmo-backend/dsh-remote', '')
    .replaceAll('jotmo-realtime/remote-channel', '')
    .replaceAll('jotmo-dsh-remote', '')
}

function withoutOpenClawProtocolNames(file: string, content: string): string {
  if (file !== join(root, 'src/openclaw/cli-adapter.ts')) return content
  // The published package, plugin id and channel key are fixed external protocol identifiers.
  return content.replace(/jotmo/gi, '')
}

function withoutDshRemoteRepositoryNames(file: string, content: string): string {
  if (!file.startsWith(join(root, 'src/dsh-remote/'))) return content
  return content.replaceAll('jotmo-realtime', 'Realtime')
}

function withoutBotOwnerProtocolNames(file: string, content: string): string {
  if (file !== join(root, 'src/services/bot-service.ts')) return content
  return content.replaceAll("'jotmo-subject'", '').replaceAll("'jotmo-chat'", '')
}

function withoutArkmeIdCompatibilityAliases(file: string, content: string): string {
  const localizedUiFiles = new Set([
    join(root, 'src/client/ArkmeLogin.tsx'),
    join(root, 'src/client/arkme-login-locales.ts'),
    join(root, 'src/client/ArkmeSettingsSurface.tsx'),
  ])
  if (localizedUiFiles.has(file)) return content.replaceAll('即我', '')
  const allowedFiles = new Set([
    join(root, 'src/tools/business/account/set-id.ts'),
    join(root, 'src/tools/business/conversation/send-direct-text.ts'),
    join(root, 'src/tools/business/contacts/index.ts'),
    join(root, 'src/tools/prompts/business.ts'),
    join(root, 'src/client/ArkmeContactAddSurface.tsx'),
    join(root, 'src/client/ArkmeCallSurface.tsx'),
    join(root, 'src/client/ArkmeCallHistorySurface.tsx'),
    join(root, 'src/client/ArkmeVirtualWorkspace.tsx'),
    join(root, 'src/services/contact-service.ts'),
  ])
  if (!allowedFiles.has(file)) return content
  return content
    .replaceAll('即我号', '')
    .replaceAll('即我id', '')
}

function withoutTeamPublicProtocolNames(file: string, content: string): string {
  const allowedFiles = new Set([
    join(root, 'docs/consumer-plugin-contract.md'),
    join(root, 'src/client/redesign/contacts/TeamDetailPane.tsx'),
    join(root, 'src/openapi-capability-gateway.ts'),
    join(root, 'src/sdk/index.ts'),
    join(root, 'src/services/team-service.ts'),
  ])
  if (!allowedFiles.has(file)) return content
  // Team public IDs and the corresponding OpenAPI fields/routes are stable cross-repository protocol names.
  return content.replace(/jotmo|即我/gi, '')
}

function withoutOfficialCommunityProductCopy(file: string, content: string): string {
  if (file === join(root, 'src/client/ArkmeOfficialCommunityEntry.tsx')) {
    return content.replaceAll('即我社区', '').replaceAll('即我官方群', '')
  }
  if (file === join(root, 'src/arkme-service.ts')) {
    return content.replaceAll('即我官方群', '')
  }
  return content
}

function withoutApprovedJiwoScanLoginFeature(file: string, content: string): string {
  const allowedFiles = new Set([
    join(root, 'cordis.patch.yml'),
    join(root, 'src/arkme-service.ts'),
    join(root, 'src/client/ArkmeLogin.tsx'),
    join(root, 'src/client/ArkmeSidebar.tsx'),
    join(root, 'src/client/arkme-auth-flow.tsx'),
    join(root, 'src/client/arkme-login-locales.ts'),
    join(root, 'src/host-api.ts'),
    join(root, 'src/index.ts'),
    join(root, 'src/services/auth-service.ts'),
    join(root, 'src/services/service.ts'),
    join(root, 'src/types.ts'),
  ])
  if (!allowedFiles.has(file)) return content
  // This is an intentionally product-facing compatibility feature: Arkme can
  // authenticate against the Jiwo account domain when explicitly enabled.
  return content.replace(/jotmo|jiwo/gi, '').replaceAll('即我', '')
}

function withoutOutgoingCallAssetCompatibilityAlias(file: string, content: string): string {
  const allowedFiles = new Set([
    join(root, 'src/client/ArkmeCallSurface.tsx'),
    join(root, 'src/outgoing-call-assets.ts'),
  ])
  if (!allowedFiles.has(file)) return content
  // The already-published call icon filename is a fixed asset protocol key.
  return content.replaceAll('jotmo-video-linear.svg', '')
}

function withoutApprovedLinkMetadataCompatibilityAliases(file: string, content: string): string {
  if (file !== join(root, 'src/link-metadata.ts')) return content
  return content
    .replaceAll("'即我'", '')
    .replaceAll("'即我-对话发现自我'", '')
    .replaceAll("'即我 - 对话发现自我'", '')
    .replaceAll("'即我-进入Ta的世界'", '')
    .replaceAll("'即我 - 进入Ta的世界'", '')
    .replaceAll("'jiwo.cc'", '')
    .replaceAll("'jotmo-app.senguo.me'", '')
}

describe('Arkme plugin identity', () => {
  it('removes legacy product identity outside unchanged service infrastructure', () => {
    const files = [
      join(root, 'README.md'),
      join(root, 'cordis.patch.yml'),
      join(root, 'package.json'),
      join(root, 'tsdown.config.ts'),
      ...textFiles(join(root, 'docs')).filter(file => !file.startsWith(join(root, 'docs/superpowers/'))),
      ...textFiles(join(root, 'src')),
    ]
    const residuals = files.flatMap(file => {
      const source = withoutTeamPublicProtocolNames(
        file,
        withoutOutgoingCallAssetCompatibilityAlias(
          file,
          withoutApprovedLinkMetadataCompatibilityAliases(
            file,
            withoutApprovedJiwoScanLoginFeature(
              file,
              withoutOfficialCommunityProductCopy(
                file,
                withoutArkmeIdCompatibilityAliases(file, readFileSync(file, 'utf8')),
              ),
            ),
          ),
        ),
      )
      const content = withoutInfrastructureNames(withoutDshRemoteRepositoryNames(
        file,
        withoutOpenClawProtocolNames(file, withoutBotOwnerProtocolNames(file, source)),
      ))
      return /jotmo|jiwo|即我/i.test(content) ? [file.slice(root.length)] : []
    })

    expect(residuals).toEqual([])
  })

  it('declares the Arkme package, route, provider and tool surface', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

    expect(manifest.name).toBe('@senguoyun/dsh-arkme')
    expect(patch).toContain("name: '@senguoyun/dsh-arkme'")
    expect(patch).toContain('routePath: /arkme-self/api')
    expect(arkmeToolCatalog.toolNamesFor('business')).toEqual(expect.arrayContaining([
      'arkme_user_profile', 'arkme_id_set', 'arkme_sources_list', 'arkme_source_read', 'arkme_text_send',
    ]))
  })

  it('embeds the transparent Arkme application mark', () => {
    const source = readFileSync(join(root, 'src/client/arkme-assets.ts'), 'utf8')
    const encoded = source.match(/base64,([^']+)'/)?.[1]

    expect(encoded).toBeDefined()
    const image = Buffer.from(encoded ?? '', 'base64')
    expect(image).toHaveLength(18_781)
    expect(createHash('sha256').update(image).digest('hex'))
      .toBe('a5cb368d40afb15ca3b59259a2abb30a2f98defdacbd2cecdaf663d549ef44da')
  })
})
