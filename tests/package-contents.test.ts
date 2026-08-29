import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function runPnpm(args: string[]) {
  const pnpmCli = process.env.npm_execpath
  const command = pnpmCli === undefined ? 'pnpm' : process.execPath
  return execFileSync(command, [
    ...(pnpmCli === undefined ? [] : [pnpmCli]),
    '--config.verifyDepsBeforeRun=warn',
    ...args,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
}

describe('published package contents', () => {
  it('ships public docs without internal planning artifacts', () => {
    const output = runPnpm([
      'pack',
      '--dry-run',
      '--json',
      '--config.ignore-scripts=true',
    ])
    const result = JSON.parse(output) as {
      files: Array<{ path: string }>
    }
    const paths = result.files.map(file => file.path)

    expect(paths).toContain('docs/consumer-plugin-contract.md')
    expect(paths.some(path => path.startsWith('docs/superpowers/'))).toBe(false)
  })

  it('builds a Release Set plugin without an external pinyin-pro runtime dependency', () => {
    runPnpm(['run', 'bundle'])

    const libDirectory = join(projectRoot, 'lib')
    const javascript = readdirSync(libDirectory)
      .filter(path => path.endsWith('.js'))
      .map(path => readFileSync(join(libDirectory, path), 'utf8'))
      .join('\n')

    expect(javascript).not.toMatch(/(?:from\s+|import\s*\()(["'])pinyin-pro\1/)
  })
})
