import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
// These launch the real bundler/package manager; assertions cover artifact contents,
// not a wall-clock SLA. Bound the child below the test deadline on loaded CI hosts.
const packageCommandTimeout = 90_000
const packageTestTimeout = 120_000

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
    timeout: packageCommandTimeout,
  })
}

describe('published package contents', () => {
  it('uses the consuming Harness Agent registry and scope identity for local takeover', () => {
    runPnpm(['run', 'bundle'])
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { AgentRegistry } from '@deepseek-ai/dsh-agent';
      import LocalSessionRegistry from './lib/local-session-registry.js';
      if (Object.getPrototypeOf(LocalSessionRegistry) !== AgentRegistry) {
        throw new Error('Local takeover must share the Harness Agent registry and its scope routing');
      }
      console.log('shared-agent-registry');
    `], { cwd: projectRoot, encoding: 'utf8', timeout: packageCommandTimeout })
    expect(output.trim()).toBe('shared-agent-registry')
  }, packageTestTimeout)

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
  }, packageTestTimeout)

  it('builds a Release Set plugin without an external pinyin-pro runtime dependency', () => {
    runPnpm(['run', 'bundle'])

    const libDirectory = join(projectRoot, 'lib')
    const javascript = readdirSync(libDirectory)
      .filter(path => path.endsWith('.js'))
      .map(path => readFileSync(join(libDirectory, path), 'utf8'))
      .join('\n')

    expect(javascript).not.toMatch(/(?:from\s+|import\s*\()(["'])pinyin-pro\1/)
  }, packageTestTimeout)

  it('builds a Release Set plugin without an external mediabunny runtime dependency', () => {
    runPnpm(['run', 'bundle'])

    const libDirectory = join(projectRoot, 'lib')
    const javascript = readdirSync(libDirectory)
      .filter(path => path.endsWith('.js'))
      .map(path => readFileSync(join(libDirectory, path), 'utf8'))
      .join('\n')

    expect(javascript).not.toMatch(/(?:from\s+|import\s*\()(["'])mediabunny\1/)
  }, packageTestTimeout)

  it('bundles yazl and its checksum dependency into the Release Set plugin', () => {
    runPnpm(['run', 'bundle'])

    const libDirectory = join(projectRoot, 'lib')
    const javascript = readdirSync(libDirectory)
      .filter(path => path.endsWith('.js'))
      .map(path => readFileSync(join(libDirectory, path), 'utf8'))
      .join('\n')

    expect(javascript).not.toMatch(/(?:from\s+|(?:import|require)\s*\()(["'])(?:yazl|buffer-crc32)(?:\/[^"']*)?\1/)
  }, packageTestTimeout)

  it('ships browser factories without unresolved local chunk requires', () => {
    runPnpm(['run', 'bundle'])
    const libDirectory = join(projectRoot, 'lib')
    const gatewayManifestUrl = import.meta.resolve('@deepseek-ai/dsh-api-gateway/package.json')
    const gatewayManifest = JSON.parse(readFileSync(new URL(gatewayManifestUrl), 'utf8'))
    const browserCarrier = readFileSync(join(libDirectory, 'local-session/gateway-browser/client.js'), 'utf8')
    expect(browserCarrier).toBe(readFileSync(new URL(gatewayManifest.exports['./client'].browser, gatewayManifestUrl), 'utf8'))
    expect(browserCarrier).toContain('window.__ModuleLoader__.load(')
    const factories = readdirSync(libDirectory)
      .filter(path => path === 'client.js' || /^harness-.*-client\.js$/.test(path))
    expect(factories.length).toBeGreaterThanOrEqual(7)
    for (const file of factories) {
      const source = readFileSync(join(libDirectory, file), 'utf8')
      expect(source, file).toContain('window.__ModuleLoader__.load(')
      const localModules: string[] = []
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)
          && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
          && /^\.\.?\//.test(node.arguments[0].text)) localModules.push(node.arguments[0].text)
        ts.forEachChild(node, visit)
      }
      visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS))
      expect(localModules, file).toEqual([])
    }
  }, packageTestTimeout)

  it('loads cloud history validators from the consuming Harness instead of bundling the development DSH', () => {
    runPnpm(['run', 'bundle'])

    const javascript = readFileSync(join(projectRoot, 'lib/index.js'), 'utf8')
    expect(javascript).toMatch(/from\s+["']@deepseek-ai\/dsh-session\/surface["']/)
    expect(javascript).not.toContain('node_modules/@deepseek-ai/dsh-session/')
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    expect(manifest.peerDependencies).toHaveProperty('@deepseek-ai/dsh-session')
  }, packageTestTimeout)
})
