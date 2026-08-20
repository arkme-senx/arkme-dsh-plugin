import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDirectory = join(projectRoot, 'lib')

let entries = []
try {
  entries = await readdir(outputDirectory, { withFileTypes: true })
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

await Promise.all(entries
  .filter(entry => entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')))
  .map(entry => rm(join(outputDirectory, entry.name), { force: true })))
