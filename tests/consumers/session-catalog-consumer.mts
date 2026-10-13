import assert from 'node:assert/strict'
import { ArkmeSdk, type DshAccountSessionPage, type DshAccountSessionSource } from '@senguoyun/dsh-arkme/sdk'

const source: DshAccountSessionSource = { runtimeRef: 'source', sessionRef: 'same', workspaceRef: '', workspaceName: '未分组', title: 'copy', updatedAt: 1, capabilities: [], running: false, blank: false, archived: false, origin: '', desktopName: 'test', sameDesktop: false, runtimeName: 'web', presence: 'offline', local: false }
const page: DshAccountSessionPage = { contractVersion: 1, catalogVersion: 2, items: [{ ...source, logicalSessionRef: 'same', sources: [source, { ...source, runtimeRef: 'other-source' }] }] }
let response: unknown = page
const sdk = new ArkmeSdk({ fetchImpl: async () => Response.json({ ok: true, value: response }) })
const value = await sdk.listDshAccountSessions()
assert.equal(value.catalogVersion, 2)
assert.equal(value.items.length, 1)
assert.equal(value.items[0]?.sources?.length, 2)
response = { contractVersion: 999, items: [] }
await assert.rejects(sdk.listDshAccountSessions(), /版本/)
console.log('public SDK catalog consumer passed')
