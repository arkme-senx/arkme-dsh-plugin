import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function publicOperations(source: string, imports: Record<string, string> = {}, aliasName = 'ArkmePluginOperation', resolving = new Set<string>()): string[] {
  const file = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === aliasName)
  if (alias === undefined || !ts.isTypeAliasDeclaration(alias)) throw new Error(`${aliasName} not found`)
  const operations: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteral(node.argument.literal)
        || node.qualifier === undefined || !ts.isIdentifier(node.qualifier)) throw new Error('Unsupported imported operation contract')
      const moduleName = node.argument.literal.text, importedSource = imports[moduleName]
      if (importedSource === undefined) throw new Error(`Imported operation contract unavailable: ${moduleName}`)
      const key = `${moduleName}:${node.qualifier.text}`
      if (resolving.has(key)) throw new Error(`Circular imported operation contract: ${key}`)
      const nested = new Set(resolving); nested.add(key)
      operations.push(...publicOperations(importedSource, imports, node.qualifier.text, nested))
    } else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) operations.push(node.literal.text)
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

function missingHostOperations(typesSource: string, hostSource: string, imports: Record<string, string> = {}): string[] {
  const cases = hostCases(hostSource)
  return publicOperations(typesSource, imports).filter(operation => !cases.has(operation))
}

function callsImportedDispatcher(source: string, moduleName: string, functionName: string): boolean {
  const file = ts.createSourceFile('host-api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imported = file.statements.some(node => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === moduleName
    && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(item => item.name.text === functionName))
  let called = false
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === functionName
      && node.arguments.some(argument => argument.getText(file) === 'request.operation')) called = true
    node.forEachChild(visit)
  }
  visit(file)
  return imported && called
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

  it('checks imported union members and still detects a missing delegated operation', () => {
    expect(missingHostOperations(
      "export type ArkmePluginOperation = import('./recorder.js').RecorderOperation | 'world.feed'",
      "switch (operation) { case 'world.feed': break; case 'recorders.local.snapshot': break }",
      { './recorder.js': "export type RecorderOperation = 'recorders.local.snapshot' | 'recorders.local.stop'" },
    )).toEqual(['recorders.local.stop'])
  })

  it('rejects an unresolved imported contract instead of silently dropping operations', () => {
    expect(() => publicOperations("export type ArkmePluginOperation = import('./missing.js').Operation"))
      .toThrow('Imported operation contract unavailable: ./missing.js')
  })

  it('requires the delegated dispatcher to be imported and receive the requested operation', () => {
    const imported = "import { delegate } from './routes.js';"
    expect(callsImportedDispatcher(imported, './routes.js', 'delegate')).toBe(false)
    expect(callsImportedDispatcher("delegate(request.operation)", './routes.js', 'delegate')).toBe(false)
    expect(callsImportedDispatcher(`${imported} delegate(request.operation)`, './routes.js', 'delegate')).toBe(true)
  })

  it('dispatches every public Provider operation instead of failing at runtime', () => {
    const types = readFileSync(`${root}/src/types.ts`, 'utf8')
    const host = readFileSync(`${root}/src/host-api.ts`, 'utf8')
    const recorderRoutes = readFileSync(`${root}/src/local-recorder/routes.ts`, 'utf8')
    const recorderContract = readFileSync(`${root}/src/local-recorder/contract.ts`, 'utf8')

    expect(callsImportedDispatcher(host, './local-recorder/routes.js', 'callLocalRecorder')).toBe(true)
    expect(missingHostOperations(types, `${host}\n${recorderRoutes}`, {
      './local-recorder/contract.js': recorderContract,
    })).toEqual([])
  })
})
