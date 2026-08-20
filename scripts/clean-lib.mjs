import { rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(process.argv[2] ?? resolve(repositoryRoot, 'lib'))

if (basename(target) !== 'lib' || target === repositoryRoot || dirname(target) === target) {
  throw new Error(`refusing to clean unsafe build target: ${target}`)
}

rmSync(target, { recursive: true, force: true })
