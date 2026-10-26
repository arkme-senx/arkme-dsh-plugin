import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSourceItem } from './types.js'
import { ArkmePluginError } from './services/service.js'

export interface PersonRecordSource { source: ArkmeSourceItem; memberRef: string }
export interface PersonRecordSourcesPage {
  items: PersonRecordSource[]
  hasMore: boolean
  nextCursor?: string
}
export interface PersonSourcesCursor {
  scope: string
  target: number
  entry: string
  phase: 'groups' | 'private'
  after?: string
  directory?: Record<string, unknown>
  at: number
}
const invalid = () => new ArkmePluginError('person-sources-cursor-invalid', '共同对话分页已失效，请重新打开', false, 409)
export function sealPersonSourcesCursor(value: PersonSourcesCursor, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `arkme-person-sources-v1.${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`
}
export function openPersonSourcesCursor(cursor: string, secret: string, context: Pick<PersonSourcesCursor, 'scope' | 'target' | 'entry'>, now = Date.now()): PersonSourcesCursor {
  const [prefix, encoded, signature, extra] = cursor.split('.')
  if (cursor.length > 8192 || prefix !== 'arkme-person-sources-v1' || !encoded || !signature || extra !== undefined) throw invalid()
  const supplied = Buffer.from(signature, 'base64url')
  const expected = createHmac('sha256', secret).update(encoded).digest()
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalid()
  let value: PersonSourcesCursor
  try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as PersonSourcesCursor } catch { throw invalid() }
  if (value.scope !== context.scope || value.target !== context.target || value.entry !== context.entry
    || !['groups', 'private'].includes(value.phase) || !Number.isFinite(value.at) || value.at > now || now - value.at > 30 * 60_000
    || (value.after !== undefined && (typeof value.after !== 'string' || value.after.length > 128))
    || (value.directory !== undefined && (!value.directory || typeof value.directory !== 'object' || Array.isArray(value.directory)))) throw invalid()
  return value
}
