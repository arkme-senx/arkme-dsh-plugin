import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LocalSessionOwnership } from '../src/local-session-ownership.js'

it('serializes two connections, retains identity, rejects stale owners and isolates accounts', () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme takeover '))
  const scope = { environment: 'test' as const, accountId: '3016' }
  const a = new LocalSessionOwnership(root, scope)
  const b = new LocalSessionOwnership(root, scope)
  try {
    const initial = b.register('session-1', 'B')
    const prepared = b.prepare(initial, 'A')
    expect(() => a.prepare(initial, 'C')).toThrow('执行权已改变')
    expect(() => a.acquired(prepared, 'A')).toThrow('执行权已改变')
    const released = b.released(prepared)
    const active = a.acquired(released, 'A')
    expect(active).toMatchObject({ owner: 'A', epoch: 2, conversationRef: initial.conversationRef, phase: 'active' })
    expect(b.read('session-1')).toEqual(active)
    expect(() => b.recovered(initial, 'B')).toThrow('执行权已改变')
    expect(() => b.released(prepared)).toThrow('执行权已改变')
    const back = a.prepare(active, 'B')
    a.cancel(back)
    expect(b.read('session-1')).toMatchObject({ owner: 'A', epoch: 2, phase: 'active', transfer: null, target: null })
    expect(() => new LocalSessionOwnership(root, { ...scope, accountId: '3017' })).toThrow('其他账号或环境')
    expect(() => new LocalSessionOwnership(root, { ...scope, environment: 'prod' })).toThrow('其他账号或环境')
    expect(() => a.read('../../session')).toThrow('引用无效')
    expect(() => a.assertScope({ ...scope, accountId: '3017' })).toThrow('其他账号或环境')
  } finally { a.close(); b.close(); rmSync(root, { recursive: true }) }
})
