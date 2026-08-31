import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'

export function derivePreReleaseVersion(baseVersion, runNumber) {
  if (typeof baseVersion !== 'string' || semver.valid(baseVersion) !== baseVersion) {
    throw new Error('package version must be a strict stable SemVer')
  }
  const parsed = semver.parse(baseVersion)
  if (parsed === null || parsed.prerelease.length !== 0 || parsed.build.length !== 0) {
    throw new Error('package version must not contain prerelease or build metadata')
  }
  const normalizedRun = typeof runNumber === 'string' && /^\d+$/.test(runNumber)
    ? Number(runNumber)
    : runNumber
  if (!Number.isSafeInteger(normalizedRun) || normalizedRun <= 0) {
    throw new Error('GitHub run number must be a positive integer')
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-pre.${normalizedRun}`
}

export async function preparePreReleaseVersion({ packagePath, runNumber }) {
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  const version = derivePreReleaseVersion(manifest.version, runNumber)
  manifest.version = version
  if (manifest.arkme?.updateNotice && typeof manifest.arkme.updateNotice === 'object') {
    manifest.arkme.updateNotice.title = `Arkme 插件 ${version} 更新`
  }
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  return version
}

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--run-number') {
    throw new Error('usage: prepare-runtime-version.mjs --run-number <positive integer>')
  }
  return { runNumber: args[1] }
}

async function main() {
  const { runNumber } = parseArgs(process.argv.slice(2))
  const version = await preparePreReleaseVersion({
    packagePath: resolve(process.cwd(), 'package.json'),
    runNumber,
  })
  process.stdout.write(`version=${version}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Arkme pre-release version preparation failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
