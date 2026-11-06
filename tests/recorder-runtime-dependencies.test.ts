import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertRecorderRuntimeDependencies } from '../scripts/recorder-runtime-dependencies.mjs'

let root: string
let packed: string
let manifest: Record<string, unknown>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'arkme-packed-recorder-'))
  const source = JSON.parse(await readFile('package.json', 'utf8'))
  const output = join(root, 'pack')
  execFileSync('pnpm', ['--config.verifyDepsBeforeRun=warn', 'pack', '--pack-destination', output], {
    env: { ...process.env, ARKME_SKIP_PREPARE_BUILD: 'true' }, stdio: 'pipe', timeout: 30000,
  })
  execFileSync('tar', ['-xzf', join(output, `senguoyun-dsh-arkme-${source.version}.tgz`), '-C', root])
  packed = join(root, 'package')
  manifest = JSON.parse(await readFile(join(packed, 'package.json'), 'utf8'))
}, 40000)

afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

async function copyCase(name: string) {
  const directory = join(root, name)
  await mkdir(directory)
  await cp(join(packed, 'package.json'), join(directory, 'package.json'))
  await cp(join(packed, 'node_modules'), join(directory, 'node_modules'), { recursive: true })
  return directory
}
const binding = 'node_modules/@serialport/bindings-cpp'

describe('serial recorder dependencies in the actual npm/runtime payload', () => {
  it('loads the isolated dependency closure and includes both supported OS native binaries', async () => {
    await expect(assertRecorderRuntimeDependencies(packed, manifest)).resolves.toBeUndefined()
  })

  it('rejects the old package shape that declares serialport but does not bundle it', async () => {
    const old = { ...manifest, bundledDependencies: undefined, bundleDependencies: undefined }
    await expect(assertRecorderRuntimeDependencies(packed, old)).rejects.toThrow('must bundle serialport')
  })

  it('rejects a missing serialport package instead of accepting an installed dependency elsewhere', async () => {
    const directory = await copyCase('missing-serialport')
    await rm(join(directory, 'node_modules/serialport'), { recursive: true })
    await expect(assertRecorderRuntimeDependencies(directory, manifest)).rejects.toThrow()
  })

  it('rejects an incomplete transitive dependency closure', async () => {
    const directory = await copyCase('missing-dependency')
    await rm(join(directory, 'node_modules/node-gyp-build'), { recursive: true })
    await expect(assertRecorderRuntimeDependencies(directory, manifest)).rejects.toThrow()
  })

  it('rejects a missing Windows prebuild even when building on macOS/Linux', async () => {
    const directory = await copyCase('missing-windows')
    await rm(join(directory, binding, 'prebuilds/win32-x64/@serialport+bindings-cpp.node'))
    await expect(assertRecorderRuntimeDependencies(directory, manifest)).rejects.toThrow()
  })

  it('rejects a malformed Universal native module', async () => {
    const directory = await copyCase('invalid-macos')
    await writeFile(join(directory, binding, 'prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node'), 'not a native binary')
    await expect(assertRecorderRuntimeDependencies(directory, manifest)).rejects.toThrow('Universal Mach-O')
  })

  it('rejects host build outputs that take precedence over portable N-API prebuilds', async () => {
    const directory = await copyCase('host-output')
    await mkdir(join(directory, binding, 'build/Release'), { recursive: true })
    await writeFile(join(directory, binding, 'build/Release/bindings.node'), 'host-specific')
    await expect(assertRecorderRuntimeDependencies(directory, manifest)).rejects.toThrow('host-specific compiled bindings')
  })
})
