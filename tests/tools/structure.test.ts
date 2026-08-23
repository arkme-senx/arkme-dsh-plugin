import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap(name => {
    const child = join(path, name)
    if (statSync(child).isDirectory()) return sourceFiles(child)
    return child.endsWith('.ts') ? [child] : []
  })
}

describe('Arkme tool source boundaries', () => {
  it('removes the legacy central tool files', () => {
    expect(existsSync(join(root, 'src/arkme-tools.ts'))).toBe(false)
    expect(existsSync(join(root, 'src/arkme-image-tool.ts'))).toBe(false)
  })

  it('keeps leaf modules on Ports instead of concrete service or opposite tool layers', () => {
    const leafFiles = sourceFiles(join(root, 'src/tools/business'))
      .filter(file => !file.endsWith('/index.ts'))
    const violations = leafFiles.filter(file => {
      const source = readFileSync(file, 'utf8')
      return source.includes('arkme-service') || source.includes('/atomic/')
    })

    expect(violations).toEqual([])
    expect(readFileSync(join(root, 'src/tools/ports/media.ts'), 'utf8')).not.toContain('arkme-service')
    expect(readFileSync(join(root, 'src/tools/ports/outgoing-call.ts'), 'utf8')).not.toContain('arkme-service')
  })
})
