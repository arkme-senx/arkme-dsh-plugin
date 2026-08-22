import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function publicOperations(source: string): string[] {
  const file = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'ArkmePluginOperation')
  if (alias === undefined || !ts.isTypeAliasDeclaration(alias)) throw new Error('ArkmePluginOperation not found')
  const operations: string[] = []
  const visit = (node: ts.Node): void => {
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
    node.forEachChild(visit)
  }
  visit(file)
  return operations
}

function missingHostOperations(typesSource: string, hostSource: string): string[] {
  const cases = hostCases(hostSource)
  return publicOperations(typesSource).filter(operation => !cases.has(operation))
}

describe('Host operation contract', () => {
  it('detects a public operation that has no Host dispatcher', () => {
    expect(missingHostOperations(
      "export type ArkmePluginOperation = 'world.feed' | 'world.publish-text'",
      "switch (operation) { case 'world.feed': break }",
    )).toEqual(['world.publish-text'])
  })

  it('dispatches every public Provider operation instead of failing at runtime', () => {
    const types = readFileSync(`${root}/src/types.ts`, 'utf8')
    const host = readFileSync(`${root}/src/host-api.ts`, 'utf8')

    expect(missingHostOperations(types, host)).toEqual([])
  })
})
