import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RELEASE_NOTES_BASE_URL = 'https://github.com/arkme-senx/arkme-dsh-plugin/releases/tag'
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function bumpPluginVersion(version, bump) {
  const match = VERSION_PATTERN.exec(version)
  if (match === null) throw new Error(`当前版本不是稳定的语义化版本：${version}`)
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (bump === 'major') return `${String(major + 1)}.0.0`
  if (bump === 'minor') return `${String(major)}.${String(minor + 1)}.0`
  if (bump === 'patch') return `${String(major)}.${String(minor)}.${String(patch + 1)}`
  throw new Error(`不支持的发版级别：${bump}`)
}

export async function preparePluginRelease({ cwd = process.cwd(), bump, summary, now = new Date() }) {
  const nextSummary = summary.trim()
  if (nextSummary === '') throw new Error('请填写本次更新说明')
  if (nextSummary.length > 120) throw new Error('更新说明不能超过 120 个字符')

  const packagePath = resolve(cwd, 'package.json')
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  const version = bumpPluginVersion(manifest.version, bump)
  if (manifest.arkme?.updateNotice === undefined) throw new Error('package.json 缺少 arkme.updateNotice')

  manifest.version = version
  manifest.arkme.updateNotice.title = `Arkme 插件 ${version} 更新`
  manifest.arkme.updateNotice.summary = nextSummary
  manifest.arkme.updateNotice.publishedAt = now.toISOString()
  manifest.arkme.updateNotice.releaseNotesUrl = `${RELEASE_NOTES_BASE_URL}/v${version}`
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  return version
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

async function main() {
  const bump = readOption('bump')
  const summary = readOption('summary')
  if (bump === undefined || summary === undefined) {
    throw new Error('用法：node scripts/prepare-plugin-release.mjs --bump <patch|minor|major> --summary <更新说明>')
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
