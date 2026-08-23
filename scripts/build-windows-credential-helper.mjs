import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { windowsCredentialHelperSourceSha256 } from './windows-credential-helper-sources.mjs'

const execFileAsync = promisify(execFile)

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const helperSource = join(projectRoot, 'native', 'windows-credential-helper')
const assetDirectory = join(projectRoot, 'assets', 'windows')
const helperName = 'arkme-credential-helper.exe'
const helperPath = join(assetDirectory, helperName)
const temporaryHelperPath = `${helperPath}.tmp`

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.on('error', rejectRun)
    child.on('close', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} exited with code ${String(code)}`))
    })
  })
}

await mkdir(assetDirectory, { recursive: true })
await rm(temporaryHelperPath, { force: true })
await run('go', [
  'build',
  '-trimpath',
  '-ldflags',
  '-s -w -buildid=',
  '-o',
  temporaryHelperPath,
  '.',
], {
  cwd: helperSource,
  env: {
    ...process.env,
    CGO_ENABLED: '0',
    GOARCH: 'amd64',
    GOOS: 'windows',
  },
})
await rename(temporaryHelperPath, helperPath)

const sha256 = createHash('sha256').update(await readFile(helperPath)).digest('hex')
const sourceSha256 = await windowsCredentialHelperSourceSha256(projectRoot)
const { stdout: goVersionOutput } = await execFileAsync('go', ['version'], { encoding: 'utf8' })
const manifest = {
  schemaVersion: 1,
  platform: 'win32',
  arch: 'x64',
  file: helperName,
  sha256,
  sourceSha256,
  goVersion: goVersionOutput.trim(),
}
await writeFile(join(assetDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
process.stdout.write(`Built ${helperName} (${sha256})\n`)
