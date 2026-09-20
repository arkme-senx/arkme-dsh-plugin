import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HARNESS_LAYOUT_MODULES, type HarnessLayoutPart } from './harness-conversation-layout-contract.js'

/**
 * Add exports, not a fork of native implementation/CSS. The factory remains
 * byte-for-byte native except for its private module id and return value. It is
 * imported lazily, NEVER applied as a plugin (no extra stores/slots/sessions).
 * All private symbol assumptions are deliberately here, not in Arkme views.
 * A changed upstream contract disables only this optional enhancement.
 */
export function exposeHarnessConversationLayout(source: string, part: HarnessLayoutPart): string {
  const spec = HARNESS_LAYOUT_MODULES[part]
  const id = `id: ${JSON.stringify(spec.package)}`
  const tail = /return module\.exports;\s*\}\s*\}\);\s*(?:\/\/# sourceMappingURL=[^\n]*)?\s*$/
  const required = part === 'width'
    ? ['function WidthHandle(', 'function resolveContentWidth(', 'var ConversationRoot_module_css_default =']
    // Previews must still be rendered as React children, not parsed as strings.
    : ['const TurnNavigator =', 'var TurnNavigator_module_css_default =', 'children: preview.prompt || t(', 'children: preview.response']
  if (!source.startsWith('window.__ModuleLoader__.load({') || source.split(id).length !== 2
    || !tail.test(source) || required.some(symbol => !source.includes(symbol))) {
    throw new Error(`Unsupported Harness ${part} export contract`)
  }
  const exported = part === 'width'
    ? '{ version: 1, WidthHandle, resolveContentWidth, classes: ConversationRoot_module_css_default }'
    : '{ version: 1, TurnNavigator, classes: TurnNavigator_module_css_default }'
  return source.replace(id, `id: ${JSON.stringify(spec.id)}`)
    .replace(tail, `return Object.freeze(${exported});\n\t}\n});\n`)
}

export function readHarnessConversationLayout(dshBinPath: string, part: HarnessLayoutPart): string {
  // Resolve from the running CLI, never the plugin's older build-time peers.
  const runtime = createRequire(realpathSync(dshBinPath))
  const entry = runtime.resolve(`${HARNESS_LAYOUT_MODULES[part].package}/client`)
  return exposeHarnessConversationLayout(readFileSync(entry, 'utf8'), part)
}

export function harnessConversationLayoutAsset(source: string | undefined) {
  const etag = source === undefined ? undefined : `"${createHash('sha256').update(source).digest('hex')}"`
  return (request: IncomingMessage, response: ServerResponse): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return
    }
    if (source === undefined) {
      response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return
    }
    const headers = { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag! }
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers).end(); return }
    response.writeHead(200, headers).end(request.method === 'HEAD' ? undefined : source)
  }
}
