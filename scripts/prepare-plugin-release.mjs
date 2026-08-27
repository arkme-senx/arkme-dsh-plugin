import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RELEASE_NOTES_BASE_URL = 'https://github.com/arkme-senx/arkme-dsh-plugin/releases/tag'
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function parsePluginVersion(version) {
  const match = VERSION_PATTERN.exec(version)
  if (match === null) throw new Error(`当前版本不是稳定的语义化版本：${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function bumpPluginVersion(version, bump) {
  const [major, minor, patch] = parsePluginVersion(version)
  if (bump === 'major') return `${String(major + 1)}.0.0`
  if (bump === 'minor') return `${String(major)}.${String(minor + 1)}.0`
  if (bump === 'patch') return `${String(major)}.${String(minor)}.${String(patch + 1)}`
  throw new Error(`不支持的发版级别：${bump}`)
}

export function determineAutomaticReleaseVersion(masterVersion, publishedVersion) {
  const masterParts = parsePluginVersion(masterVersion)
  const publishedParts = parsePluginVersion(publishedVersion)
  const comparison = masterParts.findIndex((part, index) => part !== publishedParts[index])
  const order = comparison < 0 ? 0 : Math.sign(masterParts[comparison] - publishedParts[comparison])
  if (order < 0) {
    throw new Error(`master 版本 ${masterVersion} 低于 npm latest ${publishedVersion}，拒绝自动发布`)
  }
  if (order > 0) {
    return { version: masterVersion, versionChanged: false, reason: 'master-ahead' }
  }
  return { version: bumpPluginVersion(masterVersion, 'patch'), versionChanged: true, reason: 'auto-patch' }
}

async function writePluginRelease({ cwd, version, summary, now }) {
  const nextSummary = summary.trim()
  if (nextSummary === '') throw new Error('请填写本次更新说明')
  if (nextSummary.length > 120) throw new Error('更新说明不能超过 120 个字符')

  const packagePath = resolve(cwd, 'package.json')
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  if (manifest.arkme?.updateNotice === undefined) throw new Error('package.json 缺少 arkme.updateNotice')

  manifest.version = version
  manifest.arkme.updateNotice.title = `Arkme 插件 ${version} 更新`
  manifest.arkme.updateNotice.summary = nextSummary
  manifest.arkme.updateNotice.publishedAt = now.toISOString()
  manifest.arkme.updateNotice.releaseNotesUrl = `${RELEASE_NOTES_BASE_URL}/v${version}`
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  return version
}

export async function preparePluginRelease({ cwd = process.cwd(), bump, summary, now = new Date() }) {
  const manifest = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'))
  const version = bumpPluginVersion(manifest.version, bump)
  return await writePluginRelease({ cwd, version, summary, now })
}

export async function prepareAutomaticPluginRelease({
  cwd = process.cwd(), publishedVersion, summary, now = new Date(),
}) {
  const manifest = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'))
  const decision = determineAutomaticReleaseVersion(manifest.version, publishedVersion)
  await writePluginRelease({ cwd, version: decision.version, summary, now })
  return decision
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

async function main() {
  const bump = readOption('bump')
  const publishedVersion = readOption('published-version')
  const summary = readOption('summary')
  if (summary === undefined || (bump === undefined) === (publishedVersion === undefined)) {
    throw new Error('用法：node scripts/prepare-plugin-release.mjs (--bump <patch|minor|major> | --published-version <npm latest>) --summary <更新说明>')
  }
  if (publishedVersion !== undefined) {
    const decision = await prepareAutomaticPluginRelease({ publishedVersion, summary })
    process.stdout.write(`next_version=${decision.version}\n`)
    process.stdout.write(`version_changed=${String(decision.versionChanged)}\n`)
    process.stdout.write(`version_reason=${decision.reason}\n`)
    return
  }
  const version = await preparePluginRelease({ bump, summary })
  process.stdout.write(`next_version=${version}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
