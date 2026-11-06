import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function publicOperations(source: string, modules: Record<string, string> = {}, aliasName = 'ArkmePluginOperation'): string[] {
  const file = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === aliasName)
  if (alias === undefined || !ts.isTypeAliasDeclaration(alias)) throw new Error(`${aliasName} not found`)
  const operations: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteral(node.argument.literal) || !node.qualifier) {
        throw new Error('Unsupported operation type import')
      }
      const imported = modules[node.argument.literal.text]
      if (imported === undefined) throw new Error(`Operation type module not provided: ${node.argument.literal.text}`)
      operations.push(...publicOperations(imported, modules, node.qualifier.getText(file)))
      return
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) operations.push(node.literal.text)
    else node.forEachChild(visit)
  }
  visit(alias.type)
  return [...new Set(operations)]
}

function hostCases(source: string): Set<string> {
  const file = ts.createSourceFile('host-api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const operations = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) operations.add(node.expression.text)
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ['request.operation', 'operation'].includes(node.left.getText(file)) &&
        ts.isStringLiteral(node.right)) operations.add(node.right.text)
    node.forEachChild(visit)
  }
  visit(file)
  return operations
}

function missingHostOperations(typesSource: string, hostSource: string, modules: Record<string, string> = {}): string[] {
  const cases = hostCases(hostSource)
  return publicOperations(typesSource, modules).filter(operation => !cases.has(operation))
}

describe('Host operation contract', () => {
  it('detects a public operation that has no Host dispatcher', () => {
    expect(missingHostOperations(
      "export type ArkmePluginOperation = 'world.feed' | 'world.publish-text'",
      "switch (operation) { case 'world.feed': break }",
    )).toEqual(['world.publish-text'])
  })

  it('recognizes the HTTP streaming dispatcher', () => {
    expect(missingHostOperations("export type ArkmePluginOperation = 'remote.session.observe'",
      "if (request.operation === 'remote.session.observe' || request.operation === 'remote.sessions.observe') { stream(); return }")).toEqual([])
  })

  it('recognizes direct operation guards as Host dispatchers', () => {
    expect(missingHostOperations("export type ArkmePluginOperation = 'explore.list'",
      "if (operation === 'explore.list') return service.explorePage(params)")).toEqual([])
  })

  it('checks imported operation members rather than treating their module path as an operation', () => {
    const types = "export type ArkmePluginOperation = import('./device.js').DeviceOperation | 'world.feed'"
    const modules = { './device.js': "export type DeviceOperation = 'device.read' | 'device.write'" }
    expect(missingHostOperations(types, "switch (operation) { case 'world.feed': case 'device.read': break }", modules))
      .toEqual(['device.write'])
    expect(() => missingHostOperations(types, '')).toThrow('Operation type module not provided')
  })

  it('dispatches every public Provider operation instead of failing at runtime', () => {
    const types = readFileSync(`${root}/src/types.ts`, 'utf8')
    const host = readFileSync(`${root}/src/host-api.ts`, 'utf8')
    const recorder = readFileSync(`${root}/src/local-recorder/routes.ts`, 'utf8')
    const modules = { './local-recorder/contract.js': readFileSync(`${root}/src/local-recorder/contract.ts`, 'utf8') }

    // The delegated dispatcher is also exercised through real HTTP in local-recorder-routes.test.ts.
    expect(host).toContain('callLocalRecorder(options.localRecorder, request.operation, params, controller.signal)')
    expect(missingHostOperations(types, `${host}\n${recorder}`, modules)).toEqual([])
  })
})
