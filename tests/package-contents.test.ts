import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('published package contents', () => {
  it('ships public docs without internal planning artifacts', () => {
    const pnpmCli = process.env.npm_execpath
    expect(pnpmCli).toBeTruthy()

    const output = execFileSync(process.execPath, [
      pnpmCli!,
      'pack',
      '--dry-run',
      '--json',
      '--config.ignore-scripts=true',
    ], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    })
    const result = JSON.parse(output) as {
      files: Array<{ path: string }>
    }
    const paths = result.files.map(file => file.path)

    expect(paths).toContain('docs/consumer-plugin-contract.md')
    expect(paths.some(path => path.startsWith('docs/superpowers/'))).toBe(false)
  })
})
