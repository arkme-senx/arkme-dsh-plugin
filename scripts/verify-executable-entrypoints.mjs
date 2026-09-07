import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import ts from 'typescript'

const clientPath = join(process.cwd(), 'lib', 'client.js')
const client = ts.createSourceFile(clientPath, readFileSync(clientPath, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
const unsupportedClientModules = new Set()

function inspectClientRequires(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    const argument = node.arguments[0]
    if (argument && ts.isStringLiteral(argument)) {
      const name = argument.text
      if (name.startsWith('node:') || nodeBuiltins.has(name)) unsupportedClientModules.add(name)
    }
  }
  ts.forEachChild(node, inspectClientRequires)
}

inspectClientRequires(client)
if (unsupportedClientModules.size > 0) {
  throw new Error(`built browser plugin requires Node modules unavailable in Harness: ${[...unsupportedClientModules].join(', ')}`)
}

const helperPath = join(process.cwd(), 'lib', 'plugin-updater-helper.js')
const result = spawnSync(process.execPath, [helperPath], {
  encoding: 'utf8',
  timeout: 10_000,
})
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

if (result.status === 0 || !output.includes('updater plan path is required')) {
  throw new Error('built plugin updater helper is not an executable entrypoint')
}
