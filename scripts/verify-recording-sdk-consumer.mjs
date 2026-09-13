import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

const profile = process.env.ARKME_PACKED_PROFILE
if (!profile) throw new Error('ARKME_PACKED_PROFILE must name a disposable tgz profile')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) {
  throw new Error('The public consumer requires an immutable tgz installation')
}
// The consumer resolves only the installed package through its own ancestry.
// TypeScript belongs to the verification toolchain, not the installed SDK.
const root = await mkdtemp(join(profile, 'recording consumer '))
const run = promisify(execFile)
try {
  const consumer = join(root, 'consumer.mts')
  await copyFile(new URL('../tests/fixtures/recording-sdk-consumer.mts', import.meta.url), consumer)
  const compiler = createRequire(import.meta.url).resolve('typescript/lib/tsc.js')
  await run(process.execPath, [compiler, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2024',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2024,DOM', consumer], { cwd: root })
  const result = await run(process.execPath, ['--experimental-strip-types', consumer], { cwd: root })
  process.stdout.write(result.stdout)
} finally {
  await rm(root, { recursive: true, force: true })
}
