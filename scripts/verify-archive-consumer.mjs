import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, mkdtemp, copyFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const profile = process.argv[2]
if (!profile) throw new Error('Pass the fresh profile installed with dsh plugin add artifact.tgz')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('A packed public artifact is required')
const temporary = await mkdtemp(join(resolve(profile), 'archive consumer '))
try {
  const consumer = join(temporary, 'consumer.mts')
  await copyFile(fileURLToPath(new URL('../tests/consumers/archive-consumer.mts', import.meta.url)), consumer)
  const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  execFileSync(process.execPath, [compiler, '--strict', '--skipLibCheck', '--noEmit', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', consumer], { cwd: temporary, stdio: 'inherit' })
  execFileSync(process.execPath, [consumer], { cwd: temporary, stdio: 'inherit' })
} finally {
  await rm(temporary, { recursive: true, force: true })
}
