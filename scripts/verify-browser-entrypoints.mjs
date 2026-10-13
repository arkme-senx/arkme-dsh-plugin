import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const browserExternals = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots',
])

export const browserEntrypoints = [
  'client.js', 'harness-session-client.js', 'harness-onboarding-client.js',
  'harness-model-client.js', 'harness-native-selection-client.js',
  'harness-trajectory-client.js', 'harness-sidebar-client.js',
]

/** Inspect the whole factory, including lazy paths that startup alone cannot exercise. */
export function verifyBrowserBundle(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const unsupported = new Set()
  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const argument = node.arguments[0]
        if (!argument || !ts.isStringLiteralLike(argument)) unsupported.add('non-literal require')
        else if (!browserExternals.has(argument.text)) unsupported.add(argument.text)
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        unsupported.add('unbundled import()')
      }
    } else if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      unsupported.add('unbundled module declaration')
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (unsupported.size > 0) {
    throw new Error(`${fileName}: dependencies unavailable in the DSH browser module table: ${[...unsupported].join(', ')}`)
  }
}

export function verifyBrowserEntrypoints(directory) {
  // Also inspect future Harness entries instead of silently limiting the gate to today's list.
  const names = new Set([...browserEntrypoints, ...readdirSync(directory).filter(name => /^harness-.*-client\.js$/.test(name))])
  for (const name of names) verifyBrowserBundle(readFileSync(join(directory, name), 'utf8'), name)
}
